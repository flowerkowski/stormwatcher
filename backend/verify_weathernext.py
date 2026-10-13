"""Verify the same query used by the API; default is a BigQuery dry run."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from urllib.parse import urlencode

from backend.weathernext import coordinates, google_settings, normalize, query_config


def verify(client, bigquery, sql, cap, location, latitude, longitude, execute=False):
    now = datetime.now(timezone.utc)
    config = query_config(bigquery, latitude, longitude, now, cap, dry_run=True)
    dry_job = client.query(sql, job_config=config, location=location, timeout=10)
    estimate = dry_job.total_bytes_processed
    if not isinstance(estimate, int) or estimate < 0:
        raise ValueError("BigQuery did not return a usable scan estimate")
    report = {"mode": "dry-run", "estimatedBytesProcessed": estimate,
              "maximumBytesBilled": cap, "withinByteLimit": estimate <= cap,
              "location": location, "requestedCoordinates": {"latitude": latitude, "longitude": longitude}}
    if estimate > cap:
        raise ValueError(f"Estimated scan ({estimate} bytes) exceeds WEATHERNEXT_MAX_BYTES_BILLED ({cap}); no forecast query executed")
    if execute:
        config = query_config(bigquery, latitude, longitude, now, cap)
        job = client.query(sql, job_config=config, location=location, timeout=10)
        try:
            rows = job.result(timeout=30)
        except TimeoutError:
            try:
                job.cancel()
            except Exception:
                pass  # Preserve the timeout as the verification failure.
            raise
        report.update(mode="live", forecast=normalize(rows, now),
                      bytesProcessed=job.total_bytes_processed, bytesBilled=job.total_bytes_billed)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--latitude', type=float, required=True)
    parser.add_argument('--longitude', type=float, required=True)
    parser.add_argument('--execute', action='store_true', help='Execute a billable forecast query after its dry run succeeds')
    parser.add_argument('--output', type=Path, help='Write the verification report as JSON (file must not already exist)')
    args = parser.parse_args(argv)
    try:
        latitude, longitude = coordinates(urlencode({'latitude': args.latitude, 'longitude': args.longitude}))
        if args.output and args.output.exists():
            raise ValueError(f"Output already exists: {args.output}")
        project, sql, cap, location = google_settings()
        from google.cloud import bigquery
        with bigquery.Client(project=project) as client:
            report = verify(client, bigquery, sql, cap, location, latitude, longitude, args.execute)
        payload = json.dumps(report, indent=2, allow_nan=False)
        if args.output:
            with args.output.open('x') as output:
                output.write(payload + '\n')
        print(payload)
        return 0
    except Exception as error:
        print(f"WeatherNext verification failed: {error}", file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
