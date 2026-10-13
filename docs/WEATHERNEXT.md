# WeatherNext 3 integration

Reviewed against Google's documentation on 8 October 2026.

StormWatch now includes an optional WeatherNext 3 comparison and a Python BigQuery
backend. The browser continues to use Open-Meteo for current conditions, daily
forecasts, precipitation probabilities and forecast alerts. Google's surface
statistics supply hourly precipitation amounts, ensemble percentiles, temperature
and wind speed. They do not supply WMO thunderstorm codes, wind gusts or the
probability of precipitation used by the alert engine. Converting a precipitation
percentile into a rain probability would require an unsupported distribution
assumption. A future alert provider would need raw ensemble members and validated
threshold definitions.

Open-Meteo's [Google WeatherNext API](https://open-meteo.com/en/docs/google-weathernext-api)
currently documents WeatherNext 2 with 6-hour steps, rather than WeatherNext 3.
It cannot currently substitute for the requested model based on its published
documentation.

## Access and local setup

1. Request allowlist access through Google's [quick start](https://developers.google.com/weathernext/guides/access-forecast).
2. Subscribe to the WeatherNext 3 Analytics Hub listing following the
   [BigQuery guide](https://developers.google.com/weathernext/guides/bigquery).
   Note the linked dataset containing `weathernext_3_0_0_0p1deg`.
3. Enable BigQuery in the billing project and give the backend identity permission
   to create query jobs and read the linked dataset. Use an identity that actually
   has access to the subscribed data; a different service account may need its own
   permissions/access approval.
4. Install the backend and set up [Application Default Credentials](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc).

The Google backend requires Python 3.10 or newer.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-billing-project
export WEATHERNEXT_TABLE=your-data-project.your_linked_dataset.weathernext_3_0_0_0p1deg
export BIGQUERY_LOCATION=US
.venv/bin/python backend/weathernext.py
```

Set `BIGQUERY_LOCATION` to the actual location of the linked dataset. In another
terminal, create `.env.local` from `.env.example` and run `npm run dev`. Select a
city; the comparison loads independently of the Open-Meteo forecast. To run
without WeatherNext, leave `VITE_WEATHERNEXT_API_URL` unset.

Only the backend URL belongs in Vite configuration. Google credentials never
belong in frontend variables, source files, or GitHub Pages assets.

## Forecast semantics

- Queries select the latest available initialization within the last 24 hours
  that covers the entire next 48 hours, then the nearest 0.1° grid center within
  20 km. This usually selects a synoptic run: interim runs end 48 hours after
  initialization and may already lack the end of the requested horizon.
- One initialization and one grid cell supply every row. Model runs are never
  spliced together. The returned initialization and grid coordinates are visible
  in the comparison so users can assess freshness and spatial approximation.
- Each timestamp marks the end of a one-hour precipitation accumulation. The
  comparison joins Open-Meteo amounts by that valid timestamp. Temperature and
  wind are valid at the same timestamp.
- `temperature_2m_mean`: Kelvin minus 273.15 → °C.
- `total_precipitation_1hr_{mean,p10,p90}`: meters times 1,000 → mm per hour.
- `wind_speed_10m_mean`: m/s times 3.6 → km/h; this is wind speed, not gusts.
- The p10–p90 interval is ensemble spread, not precipitation probability or a
  calibrated confidence interval. No synthetic thunderstorm code is generated.
- Empty, incomplete, duplicate, stale, nonfinite or mixed-run results fail
  explicitly. WeatherNext failures do not disable Open-Meteo alerts.

The [model reference](https://developers.google.com/weathernext/guides/models)
describes hourly runs, 64 members, 360-hour synoptic horizons and 48-hour interim
horizons. This first integration deliberately uses the dashboard's 48-hour
comparison window. BigQuery provides summary statistics; full ensembles and
pressure levels require the Cloud Storage access path.

## API and operation

`GET /api/weathernext?latitude=52.23&longitude=21.01` returns the contract validated
by `src/lib/weathernext.ts`: model, UTC initialization and fetch timestamps, grid
coordinates and 48 hourly records. `/health` checks process liveness only;
it does not prove Google access. Invalid coordinates return 400, disallowed
browser origins 403, query budget exhaustion 429, and unavailable data/configuration
503. Backend details stay in server logs.

The backend caches each exact coordinate pair for 15 minutes, retains at most
128 pairs, coalesces queries, and caps uncached attempts at 60 per hour per process.
Every query filters initialization partitions, uses bound coordinate/time
parameters, and sets a maximum bytes billed limit of 1 GiB. The limit may be too
low for the linked dataset; first check a BigQuery dry run and adjust
`WEATHERNEXT_MAX_BYTES_BILLED` based on measured bytes and your budget. Query
results have a 30-second wait limit; timed-out jobs are cancelled.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CLOUD_PROJECT` | unset | Query billing project |
| `WEATHERNEXT_TABLE` | unset | Fully qualified linked surface table |
| `BIGQUERY_LOCATION` | `US` | Linked dataset location |
| `WEATHERNEXT_MAX_BYTES_BILLED` | `1073741824` | Per-query byte limit |
| `WEATHERNEXT_QUERIES_PER_HOUR` | `60` | Per-process uncached query limit |
| `ALLOWED_ORIGIN` | `http://localhost:3000` | Exact permitted browser origin |
| `HOST`, `PORT` | `127.0.0.1`, `8080` | Local server address |
| `VITE_WEATHERNEXT_API_URL` | unset | Public frontend endpoint |

GitHub Pages hosts only the frontend. Host the API separately behind an HTTPS
reverse proxy or managed service, use a managed backend identity, and configure
`ALLOWED_ORIGIN` to the site's origin. CORS is a browser policy, not API
authentication. The built-in HTTP server and in-memory quota are intended for
local/single-process use; an internet-facing or multi-replica service needs ingress
authentication/rate limits and a shared cache/quota appropriate to its traffic.
Set the frontend endpoint at build time on the static host.

Read Google's [terms](https://developers.google.com/weathernext/guides/disclaimers) before
redistributing real-time predictions. Google specifies separate real-time terms
and historical CC BY 4.0 licensing. Attribution and experimental labeling are
shown in the UI; forecasts do not replace official emergency warnings.

## Verification and remaining gates

After configuring approved access, run the verification command from the app root:

```bash
# Validate the exact API query against Google and estimate its scan size.
# This default mode does not execute a billable forecast query.
.venv/bin/python -m backend.verify_weathernext --latitude 52.23 --longitude 21.01

# Run the same dry check, then explicitly execute and validate 48 real hours.
# The output file must not already exist.
.venv/bin/python -m backend.verify_weathernext --latitude 52.23 --longitude 21.01 --execute --output /tmp/weathernext-verification.json
```

The dry run uses Google's documented [query validation and scan estimate](https://docs.cloud.google.com/bigquery/docs/samples/bigquery-query-dry-run).
It checks the linked table's SQL/schema/access but does not prove that recent
forecast rows exist. `--execute` uses the API's row normalizer, rejects incomplete
or misaligned hourly data, and records the model run, grid, units, scan/billing
statistics and complete forecast. Both modes reject estimates above the configured
byte limit. The browser requires the same 48 hourly UTC steps and rejects responses
with a fetch timestamp more than 20 minutes old (allowing the 15-minute cache and
request time) or an implausible future timestamp.

`npm run check` runs TypeScript forecast/contract tests, Python cache/validation/HTTP
tests, lint and production build. Python unit tests use fixtures and do not require
Google credentials. Install `backend/requirements.txt` to use the real backend.

Local tests verify data conversion contract, one-run timeline, failure isolation,
coordinate rejection, CORS, query caps, dry-run behavior and timeout cancellation.
They do **not** prove permission to
query Google, actual scan cost or that the subscribed table matches the published
schema. Before enabling a public comparison, run a dry query against the linked
dataset, fetch a real location and verify initialization time, grid, units and
48 hourly steps. No live WeatherNext query has been verified in this workspace.
