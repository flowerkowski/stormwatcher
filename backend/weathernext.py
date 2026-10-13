"""Read-only WeatherNext 3 point-forecast API. Credentials remain on the server."""
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


def query_sql(table):
    # Identifiers cannot be bound query parameters. Accept only the documented table.
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\.[A-Za-z_][A-Za-z0-9_]*\.weathernext_3_0_0_0p1deg", table):
        raise ValueError("WEATHERNEXT_TABLE must be project.dataset.weathernext_3_0_0_0p1deg")
    return f"""WITH point AS (
  SELECT init_time, geography, forecast
  FROM `{table}`
  WHERE init_time BETWEEN TIMESTAMP_SUB(@now, INTERVAL 24 HOUR) AND @now
    AND ST_DWITHIN(geography, ST_GEOGPOINT(@longitude, @latitude), 20000)
    -- Choose the latest run with enough horizon for the full next 48 hours.
    -- Interim runs cover only 48 hours from initialization, so delayed runs
    -- typically yield to a recent synoptic cycle. Never mix initialization runs.
    AND EXISTS (SELECT 1 FROM UNNEST(forecast) f
                WHERE f.time >= TIMESTAMP_ADD(@now, INTERVAL 48 HOUR))
  ORDER BY init_time DESC,
    ST_DISTANCE(geography, ST_GEOGPOINT(@longitude, @latitude)),
    ST_X(geography), ST_Y(geography)
  LIMIT 1
)
SELECT init_time, ST_Y(geography) AS latitude, ST_X(geography) AS longitude,
  f.time, f.temperature_2m_mean - 273.15 AS temperatureC,
  f.total_precipitation_1hr_mean * 1000 AS precipitationMm,
  f.total_precipitation_1hr_p10 * 1000 AS precipitationP10Mm,
  f.total_precipitation_1hr_p90 * 1000 AS precipitationP90Mm,
  f.wind_speed_10m_mean * 3.6 AS windSpeedKmh
FROM point CROSS JOIN UNNEST(forecast) f
WHERE f.time > @now AND f.time <= TIMESTAMP_ADD(@now, INTERVAL 48 HOUR)
ORDER BY f.time
"""


def iso(value):
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise Unavailable("Missing UTC timestamp")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize(rows, now):
    rows = list(rows)
    if len(rows) != 48:
        raise Unavailable("No complete 48-hour forecast available")
    first = rows[0]
    init = first["init_time"]
    iso(init)
    if not now - timedelta(hours=24) <= init <= now:
        raise Unavailable("No recent model run available")
    if init.astimezone(timezone.utc) != init.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0):
        raise Unavailable("Model initialization is not an hourly cycle")
    grid = {"latitude": first["latitude"], "longitude": first["longitude"], "resolutionDegrees": 0.1}
    for name, bound in (("latitude", 90), ("longitude", 180)):
        if grid[name] is None or not math.isfinite(grid[name]) or abs(grid[name]) > bound:
            raise Unavailable("Invalid grid location")
    hours = []
    for row in rows:
        if row["init_time"] != init or row["latitude"] != grid["latitude"] or row["longitude"] != grid["longitude"]:
            raise Unavailable("Mixed model runs or grid cells")
        valid = row["time"]
        iso(valid)
        if valid <= now or valid > now + timedelta(hours=48):
            raise Unavailable("Invalid forecast horizon")
        expected = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0) + timedelta(hours=len(hours) + 1)
        if valid != expected:
            raise Unavailable("Forecast is not aligned to hourly UTC steps")
        if hours and valid != rows[len(hours) - 1]["time"] + timedelta(hours=1):
            raise Unavailable("Missing or duplicated hourly step")
        hour = {"time": iso(valid)}
        for key in ("temperatureC", "precipitationMm", "precipitationP10Mm", "precipitationP90Mm", "windSpeedKmh"):
            value = row[key]
            if value is None or not math.isfinite(value) or (key != "temperatureC" and value < 0):
                raise Unavailable("Missing or invalid forecast statistic")
            hour[key] = float(value)
        if hour["precipitationP10Mm"] > hour["precipitationP90Mm"]:
            raise Unavailable("Invalid percentile order")
        hours.append(hour)
    return {"model": "WeatherNext 3", "initializedAt": iso(init), "fetchedAt": iso(now), "grid": grid, "hours": hours}


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


def query_config(bigquery, latitude, longitude, now, cap, dry_run=False):
    return bigquery.QueryJobConfig(
        maximum_bytes_billed=cap, job_timeout_ms=30000, use_legacy_sql=False,
        dry_run=dry_run, use_query_cache=not dry_run,
        query_parameters=[
            bigquery.ScalarQueryParameter("latitude", "FLOAT64", latitude),
            bigquery.ScalarQueryParameter("longitude", "FLOAT64", longitude),
            bigquery.ScalarQueryParameter("now", "TIMESTAMP", now),
        ],
    )


def google_settings():
    table = os.getenv("WEATHERNEXT_TABLE", "")
    project = os.getenv("GOOGLE_CLOUD_PROJECT", "")
    if not table or not project:
        raise Unavailable("Set GOOGLE_CLOUD_PROJECT and WEATHERNEXT_TABLE after linking the approved dataset")
    sql = query_sql(table)
    cap = int(os.getenv("WEATHERNEXT_MAX_BYTES_BILLED", str(1024**3)))
    if cap <= 0:
        raise ValueError("WEATHERNEXT_MAX_BYTES_BILLED must be positive")
    return project, sql, cap, os.getenv("BIGQUERY_LOCATION", "US")


def bigquery_loader():
    try:
        project, sql, cap, location = google_settings()
    except Unavailable:
        def missing(*_):
            raise Unavailable("WeatherNext is not configured")
        return missing
    # Lazy import allows health checks and offline tests without Google packages.
    from google.cloud import bigquery
    client = bigquery.Client(project=project)

    def load(latitude, longitude):
        now = datetime.now(timezone.utc)
        config = query_config(bigquery, latitude, longitude, now, cap)
        job = client.query(sql, job_config=config, location=location, timeout=10)
        try:
            rows = job.result(timeout=30)
        except TimeoutError:
            try:
                job.cancel()
            except Exception:
                logging.exception("Unable to cancel timed-out WeatherNext query")
            raise
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
                self.reply(400, {"error": "Provide one finite latitude (-90 to 90) and longitude (-180 to 180)"})
                return
            try:
                self.reply(200, service.get(latitude, longitude))
            except RateLimited:
                self.reply(429, {"error": "WeatherNext hourly query limit reached"})
            except Exception:
                logging.exception("WeatherNext query unavailable")
                self.reply(503, {"error": "WeatherNext is unavailable. Check server configuration and approved data access."})

    return Handler


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    service = ForecastService(bigquery_loader(), query_limit=int(os.getenv("WEATHERNEXT_QUERIES_PER_HOUR", "60")))
    server = ThreadingHTTPServer((os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "8080"))),
                                 handler_for(service, os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")))
    logging.info("WeatherNext API listening on %s:%s", *server.server_address)
    server.serve_forever()
