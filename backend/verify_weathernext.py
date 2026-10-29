"""Verify the same Earth Engine query used by the API; default is a metadata-only check."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from urllib.parse import urlencode

from backend.weathernext import (
    coordinates,
    fetch_ee_rows,
    google_settings,
    latest_init_time,
    normalize,
)


def verify(ee, project, asset, timeout_ms, latitude, longitude, execute=False):
    now = datetime.now(timezone.utc)
    if hasattr(ee, "data") and hasattr(ee.data, "setDeadline"):
        ee.data.setDeadline(timeout_ms)
    init_iso = latest_init_time(ee, asset, now)
    report = {
        "mode": "dry-run",
        "backend": "earthengine",
        "project": project,
        "asset": asset,
        "initializedAt": init_iso,
        "requestedCoordinates": {"latitude": latitude, "longitude": longitude},
    }
    if execute:
        rows = fetch_ee_rows(ee, asset, init_iso, latitude, longitude, now)
        report.update(mode="live", forecast=normalize(rows, now))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latitude", type=float, required=True)
    parser.add_argument("--longitude", type=float, required=True)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Execute the full 48-hour Earth Engine point reduction after metadata verification",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write the verification report as JSON (file must not already exist)",
    )
    args = parser.parse_args(argv)
    try:
        latitude, longitude = coordinates(
            urlencode({"latitude": args.latitude, "longitude": args.longitude})
        )
        if args.output and args.output.exists():
            raise ValueError(f"Output already exists: {args.output}")
        project, asset, timeout_ms = google_settings()
        import ee

        ee.Initialize(project=project)
        report = verify(
            ee, project, asset, timeout_ms, latitude, longitude, args.execute
        )
        payload = json.dumps(report, indent=2, allow_nan=False)
        if args.output:
            with args.output.open("x") as output:
                output.write(payload + "\n")
        print(payload)
        return 0
    except Exception as error:
        print(f"WeatherNext verification failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
