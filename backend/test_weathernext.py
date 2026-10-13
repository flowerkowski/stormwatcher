from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from contextlib import redirect_stderr
import io
import json
import os
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from backend.weathernext import coordinates, query_sql, normalize, ForecastService, Unavailable, RateLimited, handler_for
from backend.verify_weathernext import main, verify


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 8, 12, 30, tzinfo=timezone.utc)
        self.rows = [dict(init_time=self.now.replace(minute=0) - timedelta(hours=6), latitude=52.2, longitude=21.0,
                          time=self.now.replace(minute=0) + timedelta(hours=i), temperatureC=10,
                          precipitationMm=2, precipitationP10Mm=0, precipitationP90Mm=5,
                          windSpeedKmh=18) for i in range(1, 49)]

    def test_coordinates(self):
        self.assertEqual(coordinates('latitude=90&longitude=-180'), (90, -180))
        for query in ('latitude=nan&longitude=0', 'latitude=91&longitude=0', 'latitude=1&longitude=inf',
                      'latitude=0&latitude=1&longitude=0', 'latitude=0', 'latitude=&longitude=0',
                      'latitude=0&longitude=0&table=evil'):
            with self.assertRaises(ValueError):
                coordinates(query)

    def test_query_uses_documented_schema_parameters_partition_and_single_run(self):
        sql = query_sql('sample-project.weather.weathernext_3_0_0_0p1deg')
        self.assertTrue(sql.startswith('WITH'))
        for text in ('init_time BETWEEN', '@latitude', '@longitude', 'LIMIT 1', 'total_precipitation_1hr_mean * 1000',
                     'temperature_2m_mean - 273.15', 'wind_speed_10m_mean * 3.6', 'INTERVAL 48 HOUR'):
            self.assertIn(text, sql)
        with self.assertRaises(ValueError):
            query_sql('bad`; DROP TABLE test')

    def test_normalize_complete_single_run(self):
        result = normalize(self.rows, self.now)
        self.assertEqual(result['model'], 'WeatherNext 3')
        self.assertEqual(len(result['hours']), 48)
        self.assertTrue(result['initializedAt'].endswith('Z'))
        self.assertNotIn('precipProb', result['hours'][0])

    def test_reject_missing_duplicate_stale_or_invalid_data(self):
        for change in (
            lambda r: r.pop(),
            lambda r: r[1].update(time=r[0]['time']),
            lambda r: r[1].update(precipitationMm=None),
            lambda r: r[1].update(init_time=self.now - timedelta(hours=7)),
            lambda r: r[1].update(longitude=20),
            lambda r: r[1].update(precipitationP90Mm=-1),
            lambda r: r[1].update(temperatureC=float('nan')),
            lambda r: [row.update(time=row['time'] + timedelta(minutes=1)) for row in r],
        ):
            rows = [dict(r) for r in self.rows]
            change(rows)
            with self.assertRaises(Unavailable):
                normalize(rows, self.now)

    def test_cache_expiry_budget_and_failed_queries(self):
        calls = []
        ticks = [0]
        service = ForecastService(lambda lat, lon: calls.append((lat, lon)) or {'hours': []}, ttl=10, query_limit=2, clock=lambda: ticks[0])
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
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(service, 'http://localhost:3000'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(Request(base + '/api/weathernext?latitude=52.2&longitude=21', headers={'Origin': 'http://localhost:3000'})) as response:
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://localhost:3000')
                self.assertEqual(len(json.load(response)['hours']), 48)
            for path, origin, code in (
                ('/api/weathernext?latitude=nan&longitude=21', None, 400),
                ('/api/weathernext?latitude=0&longitude=0', 'http://evil.test', 403),
                ('/api/weathernext?latitude=0&longitude=0', None, 429),
                ('/unknown', None, 404),
            ):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(base + path, headers={'Origin': origin} if origin else {}))
                self.assertEqual(caught.exception.code, code)
                caught.exception.close()
            service.loader = lambda *_: (_ for _ in ()).throw(RuntimeError('secret credential details'))
            service.requests.clear()
            with self.assertLogs(level='ERROR'), self.assertRaises(HTTPError) as caught:
                urlopen(base + '/api/weathernext?latitude=0&longitude=0')
            self.assertEqual(caught.exception.code, 503)
            self.assertNotIn('secret', caught.exception.read().decode())
            caught.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def verifier(self, estimate=100, rows=None):
        sdk = SimpleNamespace(QueryJobConfig=lambda **kwargs: SimpleNamespace(**kwargs),
                              ScalarQueryParameter=lambda name, kind, value: (name, kind, value))
        dry_job = SimpleNamespace(total_bytes_processed=estimate)
        live_job = Mock(total_bytes_processed=estimate, total_bytes_billed=estimate)
        live_job.result.return_value = self.rows if rows is None else rows
        client = Mock()
        client.query.side_effect = [dry_job, live_job]
        return client, sdk, live_job

    def test_verification_dry_run_never_executes_forecast(self):
        client, sdk, job = self.verifier()
        with patch('backend.verify_weathernext.datetime') as clock:
            clock.now.return_value = self.now
            report = verify(client, sdk, 'SQL', 1000, 'US', 52.2, 21)
        self.assertEqual(report['mode'], 'dry-run')
        self.assertEqual(report['estimatedBytesProcessed'], 100)
        client.query.assert_called_once()
        config = client.query.call_args.kwargs['job_config']
        self.assertTrue(config.dry_run)
        self.assertFalse(config.use_query_cache)
        self.assertEqual(config.maximum_bytes_billed, 1000)
        self.assertEqual(config.query_parameters, [('latitude', 'FLOAT64', 52.2), ('longitude', 'FLOAT64', 21), ('now', 'TIMESTAMP', self.now)])
        job.result.assert_not_called()

    def test_verification_refuses_over_budget_and_unconfigured_queries(self):
        client, sdk, job = self.verifier(estimate=1001)
        with self.assertRaisesRegex(ValueError, 'exceeds'):
            verify(client, sdk, 'SQL', 1000, 'US', 52.2, 21, execute=True)
        client.query.assert_called_once()
        job.result.assert_not_called()
        with patch.dict(os.environ, {}, clear=True), redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(main(['--latitude', '52.2', '--longitude', '21']), 1)
        self.assertIn('Set GOOGLE_CLOUD_PROJECT and WEATHERNEXT_TABLE', errors.getvalue())

    def test_verification_live_result_uses_api_normalizer(self):
        client, sdk, job = self.verifier()
        with patch('backend.verify_weathernext.datetime') as clock:
            clock.now.return_value = self.now
            report = verify(client, sdk, 'SQL', 1000, 'US', 52.2, 21, execute=True)
        self.assertEqual(report['mode'], 'live')
        self.assertEqual(len(report['forecast']['hours']), 48)
        self.assertEqual(report['bytesBilled'], 100)
        self.assertFalse(client.query.call_args.kwargs['job_config'].dry_run)
        job.cancel.assert_not_called()
        client, sdk, job = self.verifier(rows=self.rows[:-1])
        with patch('backend.verify_weathernext.datetime') as clock:
            clock.now.return_value = self.now
            with self.assertRaises(Unavailable):
                verify(client, sdk, 'SQL', 1000, 'US', 52.2, 21, execute=True)

    def test_verification_cancels_timeout_and_preserves_original_failure(self):
        client, sdk, job = self.verifier()
        job.result.side_effect = TimeoutError('query exceeded deadline')
        job.cancel.side_effect = RuntimeError('cancellation failed')
        with self.assertRaisesRegex(TimeoutError, 'deadline'):
            verify(client, sdk, 'SQL', 1000, 'US', 52.2, 21, execute=True)
        job.cancel.assert_called_once()


if __name__ == '__main__':
    unittest.main()
