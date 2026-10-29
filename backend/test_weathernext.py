from contextlib import redirect_stderr
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
import io
import json
import os
import threading
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.weathernext import (
    BANDS,
    DEFAULT_ASSET,
    ForecastService,
    RateLimited,
    Unavailable,
    coordinates,
    fetch_ee_rows,
    google_settings,
    handler_for,
    iso,
    latest_init_time,
    normalize,
    rows_from_features,
    validate_asset,
)
from backend.verify_weathernext import main, verify


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 8, 12, 30, tzinfo=timezone.utc)
        self.init_dt = self.now.replace(minute=0) - timedelta(hours=6)
        self.rows = [
            dict(
                init_time=self.init_dt,
                latitude=52.2,
                longitude=21.0,
                time=self.now.replace(minute=0) + timedelta(hours=i),
                temperatureC=10,
                precipitationMm=2,
                precipitationP10Mm=0,
                precipitationP90Mm=5,
                windSpeedKmh=18,
            )
            for i in range(1, 49)
        ]
        self.feature_collection = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": None,
                    "properties": {
                        "init_time": iso(self.init_dt),
                        "time": iso(self.now.replace(minute=0) + timedelta(hours=i)),
                        "latitude": 52.2,
                        "longitude": 21.0,
                        "temperature_2m_mean": 283.15,
                        "temperature_2m_p10": 281.15,
                        "temperature_2m_p90": 285.15,
                        "dewpoint_temperature_2m_mean": 279.15,
                        "total_precipitation_1hr_mean": 0.002,
                        "total_precipitation_1hr_p10": 0.0,
                        "total_precipitation_1hr_p25": 0.0005,
                        "total_precipitation_1hr_p50": 0.0015,
                        "total_precipitation_1hr_p75": 0.003,
                        "total_precipitation_1hr_p90": 0.005,
                        "imerg_tp_1hr_mean": 0.0018,
                        "wind_speed_10m_mean": 5.0,
                        "wind_speed_10m_p10": 3.0,
                        "wind_speed_10m_p90": 8.0,
                        "wind_speed_100m_mean": 9.0,
                        "total_cloud_cover_mean": 0.65,
                        "mean_sea_level_pressure_mean": 101325.0,
                        "surface_solar_radiation_downwards_1hr_mean": 720000.0,
                    },
                }
                for i in range(1, 49)
            ],
        }

    def mock_ee(self, init_candidates=None, feature_collection=None):
        ee = MagicMock()
        collection = MagicMock()
        ee.ImageCollection.return_value = collection
        collection.filterDate.return_value = collection
        collection.filterBounds.return_value = collection
        collection.filter.return_value = collection
        collection.sort.return_value = collection
        agg = MagicMock()
        agg.getInfo.return_value = (
            [iso(self.init_dt - timedelta(hours=6)), iso(self.init_dt)]
            if init_candidates is None
            else init_candidates
        )
        collection.aggregate_array.return_value = agg

        fc = MagicMock()
        fc.getInfo.return_value = (
            self.feature_collection if feature_collection is None else feature_collection
        )
        ee.FeatureCollection.return_value = fc
        return ee, collection, fc

    def test_coordinates(self):
        self.assertEqual(coordinates("latitude=90&longitude=-180"), (90, -180))
        for query in (
            "latitude=nan&longitude=0",
            "latitude=91&longitude=0",
            "latitude=1&longitude=inf",
            "latitude=0&latitude=1&longitude=0",
            "latitude=0",
            "latitude=&longitude=0",
            "latitude=0&longitude=0&table=evil",
        ):
            with self.assertRaises(ValueError):
                coordinates(query)

    def test_asset_validation_and_settings(self):
        self.assertEqual(validate_asset(DEFAULT_ASSET), DEFAULT_ASSET)
        with self.assertRaises(ValueError):
            validate_asset("projects/bad/assets/other_collection")
        with patch.dict(os.environ, {"GOOGLE_CLOUD_PROJECT": "stormwatch-ee"}, clear=True):
            project, asset, timeout_ms = google_settings()
            self.assertEqual(project, "stormwatch-ee")
            self.assertEqual(asset, DEFAULT_ASSET)
            self.assertEqual(timeout_ms, 30000)
        with patch.dict(os.environ, {"GOOGLE_CLOUD_PROJECT": "BAD_PROJECT"}, clear=True):
            with self.assertRaises(ValueError):
                google_settings()

    def test_earthengine_query_selects_latest_48h_run_and_converts_units(self):
        ee, collection, _ = self.mock_ee()
        selected_init = latest_init_time(ee, DEFAULT_ASSET, self.now)
        self.assertEqual(selected_init, iso(self.init_dt))
        rows = fetch_ee_rows(ee, DEFAULT_ASSET, selected_init, 52.23, 21.01, self.now)
        self.assertEqual(len(rows), 48)
        self.assertAlmostEqual(rows[0]["temperatureC"], 10.0)
        self.assertAlmostEqual(rows[0]["temperatureP10C"], 8.0)
        self.assertAlmostEqual(rows[0]["temperatureP90C"], 12.0)
        self.assertAlmostEqual(rows[0]["dewpointC"], 6.0)
        self.assertAlmostEqual(rows[0]["precipitationMm"], 2.0)
        self.assertAlmostEqual(rows[0]["precipitationP10Mm"], 0.0)
        self.assertAlmostEqual(rows[0]["precipitationP25Mm"], 0.5)
        self.assertAlmostEqual(rows[0]["precipitationP50Mm"], 1.5)
        self.assertAlmostEqual(rows[0]["precipitationP75Mm"], 3.0)
        self.assertAlmostEqual(rows[0]["precipitationP90Mm"], 5.0)
        self.assertAlmostEqual(rows[0]["imergPrecipitationMm"], 1.8)
        self.assertAlmostEqual(rows[0]["windSpeedKmh"], 18.0)
        self.assertAlmostEqual(rows[0]["windSpeedP10Kmh"], 10.8)
        self.assertAlmostEqual(rows[0]["windSpeedP90Kmh"], 28.8)
        self.assertAlmostEqual(rows[0]["windSpeed100mKmh"], 32.4)
        self.assertAlmostEqual(rows[0]["cloudCoverPct"], 65.0)
        self.assertAlmostEqual(rows[0]["pressureHpa"], 1013.25)
        self.assertAlmostEqual(rows[0]["solarRadiationWm2"], 200.0)
        collection.filterBounds.assert_called_once()

        # Verify that sample_image selects the documented bands and pixelLonLat.
        mapper = collection.map.call_args.args[0]
        fake_image = MagicMock()
        mapper(fake_image)
        fake_image.select.assert_called_once_with(list(BANDS))

        # Reject grid cells farther than 20 km from the requested point.
        with self.assertRaises(Unavailable):
            rows_from_features(self.feature_collection, req_latitude=0.0, req_longitude=0.0)

    def test_normalize_complete_single_run(self):
        result = normalize(self.rows, self.now)
        self.assertEqual(result["model"], "WeatherNext 3")
        self.assertEqual(len(result["hours"]), 48)
        self.assertTrue(result["initializedAt"].endswith("Z"))
        self.assertNotIn("precipProb", result["hours"][0])

    def test_reject_missing_duplicate_stale_or_invalid_data(self):
        for change in (
            lambda r: r.pop(),
            lambda r: r[1].update(time=r[0]["time"]),
            lambda r: r[1].update(precipitationMm=None),
            lambda r: r[1].update(init_time=self.now - timedelta(hours=7)),
            lambda r: r[1].update(longitude=20),
            lambda r: r[1].update(precipitationP90Mm=-1),
            lambda r: r[1].update(temperatureC=float("nan")),
            lambda r: [row.update(time=row["time"] + timedelta(minutes=1)) for row in r],
        ):
            rows = [dict(r) for r in self.rows]
            change(rows)
            with self.assertRaises(Unavailable):
                normalize(rows, self.now)

    def test_cache_expiry_budget_and_failed_queries(self):
        calls = []
        ticks = [0]
        service = ForecastService(
            lambda lat, lon: calls.append((lat, lon)) or {"hours": []},
            ttl=10,
            query_limit=2,
            clock=lambda: ticks[0],
        )
        service.get(1, 2)
        service.get(1, 2)
        self.assertEqual(len(calls), 1)
        ticks[0] = 11
        service.get(1, 2)
        with self.assertRaises(RateLimited):
            service.get(3, 4)
        ticks[0] = 3601
        service.get(3, 4)
        self.assertEqual(len(calls), 3)

    def test_api_contract_cors_and_unavailable_errors(self):
        service = ForecastService(lambda *_: normalize(self.rows, self.now), query_limit=1)
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), handler_for(service, "http://localhost:3000")
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(
                Request(
                    base + "/api/weathernext?latitude=52.2&longitude=21",
                    headers={"Origin": "http://localhost:3000"},
                )
            ) as response:
                self.assertEqual(
                    response.headers["Access-Control-Allow-Origin"],
                    "http://localhost:3000",
                )
                self.assertEqual(len(json.load(response)["hours"]), 48)
            for path, origin, code in (
                ("/api/weathernext?latitude=nan&longitude=21", None, 400),
                ("/api/weathernext?latitude=0&longitude=0", "http://evil.test", 403),
                ("/api/weathernext?latitude=0&longitude=0", None, 429),
                ("/unknown", None, 404),
            ):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(
                        Request(
                            base + path, headers={"Origin": origin} if origin else {}
                        )
                    )
                self.assertEqual(caught.exception.code, code)
                caught.exception.close()
            service.loader = lambda *_: (_ for _ in ()).throw(
                RuntimeError("secret credential details")
            )
            service.requests.clear()
            with self.assertLogs(level="ERROR"), self.assertRaises(HTTPError) as caught:
                urlopen(base + "/api/weathernext?latitude=0&longitude=0")
            self.assertEqual(caught.exception.code, 503)
            self.assertNotIn("secret", caught.exception.read().decode())
            caught.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_verification_dry_run_checks_metadata_without_point_reduction(self):
        ee, _, fc = self.mock_ee()
        with patch("backend.verify_weathernext.datetime") as clock:
            clock.now.return_value = self.now
            report = verify(ee, "stormwatch-ee", DEFAULT_ASSET, 30000, 52.2, 21.0)
        self.assertEqual(report["mode"], "dry-run")
        self.assertEqual(report["backend"], "earthengine")
        self.assertEqual(report["initializedAt"], iso(self.init_dt))
        ee.data.setDeadline.assert_called_once_with(30000)
        fc.getInfo.assert_not_called()

    def test_verification_refuses_missing_runs_and_unconfigured_projects(self):
        ee, _, fc = self.mock_ee(init_candidates=[])
        with patch("backend.verify_weathernext.datetime") as clock:
            clock.now.return_value = self.now
            with self.assertRaises(Unavailable):
                verify(ee, "stormwatch-ee", DEFAULT_ASSET, 30000, 52.2, 21.0, execute=True)
        fc.getInfo.assert_not_called()
        with patch.dict(os.environ, {}, clear=True), redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(main(["--latitude", "52.2", "--longitude", "21"]), 1)
        self.assertIn("Set GOOGLE_CLOUD_PROJECT", errors.getvalue())

    def test_verification_live_result_uses_api_normalizer(self):
        ee, _, fc = self.mock_ee()
        with patch("backend.verify_weathernext.datetime") as clock:
            clock.now.return_value = self.now
            report = verify(
                ee, "stormwatch-ee", DEFAULT_ASSET, 30000, 52.2, 21.0, execute=True
            )
        self.assertEqual(report["mode"], "live")
        self.assertEqual(len(report["forecast"]["hours"]), 48)
        fc.getInfo.assert_called_once()

        truncated = {
            "type": "FeatureCollection",
            "features": self.feature_collection["features"][:-1],
        }
        ee_bad, _, _ = self.mock_ee(feature_collection=truncated)
        with patch("backend.verify_weathernext.datetime") as clock:
            clock.now.return_value = self.now
            with self.assertRaises(Unavailable):
                verify(
                    ee_bad,
                    "stormwatch-ee",
                    DEFAULT_ASSET,
                    30000,
                    52.2,
                    21.0,
                    execute=True,
                )


if __name__ == "__main__":
    unittest.main()
