"""Read-only WeatherNext 3 point-forecast API via Google Earth Engine. Credentials remain on the server."""
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
import os
import re
import threading
import time
from urllib.parse import parse_qs, urlsplit


DEFAULT_ASSET = "projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg"
CORE_BANDS = (
    "temperature_2m_mean",
    "total_precipitation_1hr_mean",
    "total_precipitation_1hr_p10",
    "total_precipitation_1hr_p90",
    "wind_speed_10m_mean",
)
EXTENDED_BANDS = (
    "temperature_2m_p10",
    "temperature_2m_p90",
    "dewpoint_temperature_2m_mean",
    "total_precipitation_1hr_p25",
    "total_precipitation_1hr_p50",
    "total_precipitation_1hr_p75",
    "imerg_tp_1hr_mean",
    "wind_speed_10m_p10",
    "wind_speed_10m_p90",
    "wind_speed_100m_mean",
    "total_cloud_cover_mean",
    "mean_sea_level_pressure_mean",
    "surface_solar_radiation_downwards_1hr_mean",
)
BANDS = CORE_BANDS + EXTENDED_BANDS
SCALE_METERS = 10000
MAX_DISTANCE_METERS = 20000
INIT_CACHE_TTL_SECONDS = 300

_init_cache_lock = threading.Lock()
_init_cache = {}


class Unavailable(Exception):
    pass


class RateLimited(Exception):
    pass


def coordinates(query):
    values = parse_qs(query, keep_blank_values=True)
    if set(values) != {"latitude", "longitude"}:
        raise ValueError("Provide latitude and longitude only")
    result = []
    for key, bound in (("latitude", 90), ("longitude", 180)):
        if len(values[key]) != 1:
            raise ValueError("Coordinates must occur once")
        number = float(values[key][0])
        if not math.isfinite(number) or abs(number) > bound:
            raise ValueError("Coordinates are outside their valid range")
        result.append(number)
    return tuple(result)


def validate_asset(asset):
    if not re.fullmatch(
        r"projects/[a-z][a-z0-9-]{4,61}[a-z0-9]/assets/weathernext_3_0_0_0p1deg",
        asset,
    ):
        raise ValueError(
            "WEATHERNEXT_ASSET must be projects/<project>/assets/weathernext_3_0_0_0p1deg"
        )
    return asset


def iso(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Unavailable("Missing UTC timestamp")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_iso(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise Unavailable("Missing UTC timestamp")
        return value.astimezone(timezone.utc)
    if not isinstance(value, str) or not value.endswith("Z"):
        raise Unavailable("Missing UTC timestamp")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00").astimezone(timezone.utc)
    except ValueError as err:
        raise Unavailable("Invalid UTC timestamp") from err


def distance_meters(lat1, lon1, lat2, lon2):
    rad = math.pi / 180.0
    dlat = (lat2 - lat1) * rad
    dlon = (lon2 - lon1) * rad
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2
    )
    return 2 * 6371000.0 * math.asin(min(1.0, math.sqrt(a)))


def forecast_window(now):
    iso(now)
    utc_now = now.astimezone(timezone.utc)
    first_valid = utc_now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    last_valid = first_valid + timedelta(hours=47)
    min_init = (utc_now - timedelta(hours=24)).replace(microsecond=0)
    max_init = utc_now.replace(microsecond=0)
    window_end = last_valid + timedelta(hours=1)
    return (
        iso(min_init),
        iso(max_init),
        iso(first_valid),
        iso(last_valid),
        iso(window_end),
    )


def latest_init_time(ee, asset, now, use_cache=False):
    validate_asset(asset)
    min_init_iso, max_init_iso, _, last_valid_iso, window_end_iso = forecast_window(now)
    cache_key = (asset, last_valid_iso)
    if use_cache:
        with _init_cache_lock:
            cached = _init_cache.get(cache_key)
            if cached and time.monotonic() - cached[0] < INIT_CACHE_TTL_SECONDS:
                cached_dt = parse_iso(cached[1])
                if now - timedelta(hours=24) <= cached_dt <= now:
                    return cached[1]

    # Choose the latest run initialized within the last 24h that covers the full 48h horizon.
    # Interim runs cover only 48 hours from initialization, so delayed runs yield to a recent
    # synoptic cycle when their horizon no longer reaches last_valid_iso.
    candidates = (
        ee.ImageCollection(asset)
        .filterDate(min_init_iso, window_end_iso)
        .filter(ee.Filter.gte("start_time", min_init_iso))
        .filter(ee.Filter.lte("start_time", max_init_iso))
        .filter(ee.Filter.eq("end_time", last_valid_iso))
        .sort("start_time", False)
        .aggregate_array("start_time")
        .getInfo()
    )
    valid = [item for item in (candidates or []) if isinstance(item, str)]
    if not valid:
        raise Unavailable("No recent model run available")
    init_dt = parse_iso(max(valid))
    if not now - timedelta(hours=24) <= init_dt <= now:
        raise Unavailable("No recent model run available")
    if init_dt != init_dt.replace(minute=0, second=0, microsecond=0):
        raise Unavailable("Model initialization is not an hourly cycle")
    resolved = iso(init_dt)
    if use_cache:
        with _init_cache_lock:
            _init_cache[cache_key] = (time.monotonic(), resolved)
    return resolved


def _clamp_non_negative(val):
    if val is None:
        return None
    if -1e-6 < val < 0.0:
        return 0.0
    return val


def rows_from_features(feature_collection, req_latitude=None, req_longitude=None):
    if not isinstance(feature_collection, dict) or not isinstance(
        feature_collection.get("features"), list
    ):
        raise Unavailable("Earth Engine did not return a valid feature collection")
    rows = []
    for feature in feature_collection["features"]:
        props = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            raise Unavailable("Missing feature properties in Earth Engine response")
        init_dt = parse_iso(props.get("init_time"))
        valid_dt = parse_iso(props.get("time"))
        grid_lat = props.get("latitude")
        grid_lon = props.get("longitude")
        if (
            grid_lat is None
            or grid_lon is None
            or isinstance(grid_lat, bool)
            or isinstance(grid_lon, bool)
            or not isinstance(grid_lat, (int, float))
            or not isinstance(grid_lon, (int, float))
            or not math.isfinite(grid_lat)
            or not math.isfinite(grid_lon)
        ):
            raise Unavailable("Invalid grid location")
        if req_latitude is not None and req_longitude is not None:
            if (
                distance_meters(req_latitude, req_longitude, float(grid_lat), float(grid_lon))
                > MAX_DISTANCE_METERS
            ):
                raise Unavailable("Nearest grid cell is outside the 20 km search radius")

        def finite_band(name):
            val = props.get(name)
            if (
                val is None
                or isinstance(val, bool)
                or not isinstance(val, (int, float))
                or not math.isfinite(val)
            ):
                return None
            return float(val)

        temp_k = finite_band("temperature_2m_mean")
        precip_m = _clamp_non_negative(finite_band("total_precipitation_1hr_mean"))
        p10_m = _clamp_non_negative(finite_band("total_precipitation_1hr_p10"))
        p90_m = _clamp_non_negative(finite_band("total_precipitation_1hr_p90"))
        wind_ms = _clamp_non_negative(finite_band("wind_speed_10m_mean"))

        row = {
            "init_time": init_dt,
            "latitude": round(float(grid_lat), 4),
            "longitude": round(float(grid_lon), 4),
            "time": valid_dt,
            "temperatureC": None if temp_k is None else temp_k - 273.15,
            "precipitationMm": None if precip_m is None else precip_m * 1000.0,
            "precipitationP10Mm": None if p10_m is None else p10_m * 1000.0,
            "precipitationP90Mm": None if p90_m is None else p90_m * 1000.0,
            "windSpeedKmh": None if wind_ms is None else wind_ms * 3.6,
        }

        # Optional extended ensemble statistics from the same 0.1° image reduction.
        temp_p10_k = finite_band("temperature_2m_p10")
        temp_p90_k = finite_band("temperature_2m_p90")
        dew_k = finite_band("dewpoint_temperature_2m_mean")
        p25_m = _clamp_non_negative(finite_band("total_precipitation_1hr_p25"))
        p50_m = _clamp_non_negative(finite_band("total_precipitation_1hr_p50"))
        p75_m = _clamp_non_negative(finite_band("total_precipitation_1hr_p75"))
        imerg_m = _clamp_non_negative(finite_band("imerg_tp_1hr_mean"))
        wind_p10_ms = _clamp_non_negative(finite_band("wind_speed_10m_p10"))
        wind_p90_ms = _clamp_non_negative(finite_band("wind_speed_10m_p90"))
        wind_100m_ms = _clamp_non_negative(finite_band("wind_speed_100m_mean"))
        cloud_frac = _clamp_non_negative(finite_band("total_cloud_cover_mean"))
        mslp_pa = _clamp_non_negative(finite_band("mean_sea_level_pressure_mean"))
        ssrd_jm2 = _clamp_non_negative(
            finite_band("surface_solar_radiation_downwards_1hr_mean")
        )

        if temp_p10_k is not None and temp_p90_k is not None:
            t10, t90 = temp_p10_k - 273.15, temp_p90_k - 273.15
            row["temperatureP10C"] = min(t10, t90)
            row["temperatureP90C"] = max(t10, t90)
        if dew_k is not None:
            row["dewpointC"] = dew_k - 273.15
        if p25_m is not None:
            row["precipitationP25Mm"] = max(0.0, p25_m * 1000.0)
        if p50_m is not None:
            row["precipitationP50Mm"] = max(0.0, p50_m * 1000.0)
        if p75_m is not None:
            row["precipitationP75Mm"] = max(0.0, p75_m * 1000.0)
        if imerg_m is not None and imerg_m >= 0:
            row["imergPrecipitationMm"] = imerg_m * 1000.0
        if wind_p10_ms is not None and wind_p90_ms is not None and wind_p10_ms >= 0 and wind_p90_ms >= 0:
            w10, w90 = wind_p10_ms * 3.6, wind_p90_ms * 3.6
            row["windSpeedP10Kmh"] = min(w10, w90)
            row["windSpeedP90Kmh"] = max(w10, w90)
        if wind_100m_ms is not None and wind_100m_ms >= 0:
            row["windSpeed100mKmh"] = wind_100m_ms * 3.6
        if cloud_frac is not None and cloud_frac >= 0:
            row["cloudCoverPct"] = min(100.0, max(0.0, cloud_frac * 100.0))
        if mslp_pa is not None and mslp_pa > 0:
            row["pressureHpa"] = mslp_pa / 100.0
        if ssrd_jm2 is not None and ssrd_jm2 >= 0:
            row["solarRadiationWm2"] = ssrd_jm2 / 3600.0

        rows.append(row)
    return rows


def fetch_ee_rows(ee, asset, init_time_iso, latitude, longitude, now):
    validate_asset(asset)
    min_init_iso, _, first_valid_iso, last_valid_iso, window_end_iso = forecast_window(now)
    point = ee.Geometry.Point([longitude, latitude])
    # Filter by spatial bounds and literal start_time/end_time metadata before reducing.
    run_images = (
        ee.ImageCollection(asset)
        .filterDate(min_init_iso, window_end_iso)
        .filterBounds(point)
        .filter(ee.Filter.eq("start_time", init_time_iso))
        .filter(ee.Filter.gte("end_time", first_valid_iso))
        .filter(ee.Filter.lte("end_time", last_valid_iso))
        .sort("end_time")
    )

    def sample_image(image):
        stats = (
            image.select(list(BANDS))
            .addBands(ee.Image.pixelLonLat())
            .reduceRegion(
                reducer=ee.Reducer.first(),
                geometry=point,
                scale=SCALE_METERS,
            )
        )
        return ee.Feature(
            None,
            stats.combine(
                {
                    "init_time": image.get("start_time"),
                    "time": image.get("end_time"),
                },
                overwrite=True,
            ),
        )

    feature_collection = ee.FeatureCollection(run_images.map(sample_image)).getInfo()
    return rows_from_features(feature_collection, latitude, longitude)


OPTIONAL_HOUR_KEYS = (
    "temperatureP10C",
    "temperatureP90C",
    "dewpointC",
    "precipitationP25Mm",
    "precipitationP50Mm",
    "precipitationP75Mm",
    "imergPrecipitationMm",
    "windSpeedP10Kmh",
    "windSpeedP90Kmh",
    "windSpeed100mKmh",
    "cloudCoverPct",
    "pressureHpa",
    "solarRadiationWm2",
)


def normalize(rows, now):
    rows = list(rows)
    if len(rows) != 48:
        raise Unavailable("No complete 48-hour forecast available")
    first = rows[0]
    init = first["init_time"]
    iso(init)
    if not now - timedelta(hours=24) <= init <= now:
        raise Unavailable("No recent model run available")
    if init.astimezone(timezone.utc) != init.astimezone(timezone.utc).replace(
        minute=0, second=0, microsecond=0
    ):
        raise Unavailable("Model initialization is not an hourly cycle")
    grid = {
        "latitude": first["latitude"],
        "longitude": first["longitude"],
        "resolutionDegrees": 0.1,
    }
    for name, bound in (("latitude", 90), ("longitude", 180)):
        if grid[name] is None or not math.isfinite(grid[name]) or abs(grid[name]) > bound:
            raise Unavailable("Invalid grid location")
    hours = []
    for row in rows:
        if (
            row["init_time"] != init
            or row["latitude"] != grid["latitude"]
            or row["longitude"] != grid["longitude"]
        ):
            raise Unavailable("Mixed model runs or grid cells")
        valid = row["time"]
        iso(valid)
        if valid <= now or valid > now + timedelta(hours=48):
            raise Unavailable("Invalid forecast horizon")
        expected = now.astimezone(timezone.utc).replace(
            minute=0, second=0, microsecond=0
        ) + timedelta(hours=len(hours) + 1)
        if valid != expected:
            raise Unavailable("Forecast is not aligned to hourly UTC steps")
        if hours and valid != rows[len(hours) - 1]["time"] + timedelta(hours=1):
            raise Unavailable("Missing or duplicated hourly step")
        hour = {"time": iso(valid)}
        for key in (
            "temperatureC",
            "precipitationMm",
            "precipitationP10Mm",
            "precipitationP90Mm",
            "windSpeedKmh",
        ):
            value = row[key]
            if value is None or not math.isfinite(value) or (key != "temperatureC" and value < 0):
                raise Unavailable("Missing or invalid forecast statistic")
            hour[key] = float(value)
        if hour["precipitationP10Mm"] > hour["precipitationP90Mm"]:
            raise Unavailable("Invalid percentile order")
        for opt_key in OPTIONAL_HOUR_KEYS:
            if opt_key in row and row[opt_key] is not None:
                opt_val = row[opt_key]
                if math.isfinite(opt_val):
                    hour[opt_key] = float(opt_val)
        hours.append(hour)
    return {
        "model": "WeatherNext 3",
        "initializedAt": iso(init),
        "fetchedAt": iso(now),
        "grid": grid,
        "hours": hours,
    }


class ForecastService:
    def __init__(self, loader, ttl=900, query_limit=60, clock=time.monotonic):
        self.loader, self.ttl, self.query_limit, self.clock = loader, ttl, query_limit, clock
        self.cache = OrderedDict()
        self.requests = deque()
        self.lock = threading.Lock()

    def get(self, latitude, longitude):
        # Coalesce concurrent cache misses and cap queries across all users.
        with self.lock:
            now = self.clock()
            key = (latitude, longitude)
            cached = self.cache.get(key)
            if cached and now - cached[0] < self.ttl:
                self.cache.move_to_end(key)
                return cached[1]
            while self.requests and now - self.requests[0] >= 3600:
                self.requests.popleft()
            if len(self.requests) >= self.query_limit:
                raise RateLimited()
            self.requests.append(now)
            data = self.loader(latitude, longitude)
            self.cache[key] = (self.clock(), data)
            self.cache.move_to_end(key)
            while len(self.cache) > 128:
                self.cache.popitem(last=False)
            return data


def google_settings():
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()
    if not project:
        raise Unavailable(
            "Set GOOGLE_CLOUD_PROJECT to your Earth Engine enabled Google Cloud project"
        )
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project):
        raise ValueError("GOOGLE_CLOUD_PROJECT must be a valid Google Cloud project ID")
    asset = validate_asset(os.getenv("WEATHERNEXT_ASSET", DEFAULT_ASSET).strip())
    timeout_ms = int(os.getenv("WEATHERNEXT_TIMEOUT_MS", "30000"))
    if timeout_ms <= 0:
        raise ValueError("WEATHERNEXT_TIMEOUT_MS must be positive")
    return project, asset, timeout_ms


def earthengine_loader():
    try:
        project, asset, timeout_ms = google_settings()
    except Unavailable:
        def missing(*_):
            raise Unavailable("WeatherNext is not configured")

        return missing
    # Lazy import allows health checks and offline tests without Google packages.
    import ee

    ee.Initialize(project=project)
    if hasattr(ee, "data") and hasattr(ee.data, "setDeadline"):
        ee.data.setDeadline(timeout_ms)

    def load(latitude, longitude):
        now = datetime.now(timezone.utc)
        init_iso = latest_init_time(ee, asset, now, use_cache=True)
        rows = fetch_ee_rows(ee, asset, init_iso, latitude, longitude, now)
        return normalize(rows, now)

    return load


def handler_for(service, allowed_origin):
    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, body):
            payload = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Vary", "Origin")
            if self.headers.get("Origin") == allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            path = urlsplit(self.path)
            if path.path == "/health":
                self.reply(200, {"status": "ok"})
                return
            if path.path != "/api/weathernext":
                self.reply(404, {"error": "Not found"})
                return
            origin = self.headers.get("Origin")
            if origin and origin != allowed_origin:
                self.reply(403, {"error": "Origin is not allowed"})
                return
            try:
                latitude, longitude = coordinates(path.query)
            except (ValueError, OverflowError):
                self.reply(
                    400,
                    {"error": "Provide one finite latitude (-90 to 90) and longitude (-180 to 180)"},
                )
                return
            try:
                self.reply(200, service.get(latitude, longitude))
            except RateLimited:
                self.reply(429, {"error": "WeatherNext hourly query limit reached"})
            except Exception:
                logging.exception("WeatherNext query unavailable")
                self.reply(
                    503,
                    {
                        "error": "WeatherNext is unavailable. Check server configuration and approved data access."
                    },
                )

    return Handler


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    service = ForecastService(
        earthengine_loader(),
        query_limit=int(os.getenv("WEATHERNEXT_QUERIES_PER_HOUR", "60")),
    )
    server = ThreadingHTTPServer(
        (os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "8080"))),
        handler_for(service, os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")),
    )
    logging.info("WeatherNext API listening on %s:%s", *server.server_address)
    server.serve_forever()
