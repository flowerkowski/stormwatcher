# App review and improvements

Reviewed 8 October 2026. StormWatch is a React/TypeScript static application with
Open-Meteo geocoding/forecast data, browser persistence and in-page monitoring.
The original production build and lint checks passed. No existing source changes
were present when this review began.

## Corrected behavior

| Finding | Change | Verification |
| --- | --- | --- |
| Hourly rain/probability/gusts describe the preceding hour, but the app used their valid timestamp as the start of the following hour | Pair the displayed bucket with amounts/probability/gusts valid at its end; keep temperature and condition code at the bucket start | Fetch regression test and browser comparison |
| Disabling rain/storm delivery could turn forecast storms into a clear hero | Compute headline/status from all forecast events; filter only the alert list and delivery | Browser check with both alert toggles disabled |
| Events merged even across missing hourly steps; IDs retained their original severity after escalation | Break events at gaps and use final severity in event IDs | Event unit tests |
| Null/missing precipitation and invalid saved values could silently turn into zero/dry conditions or invalid polling | Validate forecast columns, lengths, timelines, units/ranges; validate stored coordinates and settings | Invalid-data and storage tests; live Open-Meteo response accepted |
| Forecast copy implied observations, radar coverage or official warnings; storm notification probability was actually precipitation probability | Label forecast status, threshold-dependent quiet state and precipitation probability explicitly; link users to official authorities | Source review and browser checks |
| City search lacked arrow-key selection, and aborted searches could retain a spinner or update old results | Track an active option, support ArrowUp/ArrowDown/Enter/Escape, clear stale search state and ignore aborted responses | Browser keyboard check |
| Hourly SVG minimum width forced the dashboard grid wider than narrow screens | Allow the grid item to shrink while retaining chart scrolling | 390px browser viewport check |
| Forecast fetch could hang indefinitely | Add a 20-second request timeout; WeatherNext has an independent 45-second timeout | Source review and separate WeatherNext failure browser check |

The optional WeatherNext comparison and credentialed backend are described in
[WEATHERNEXT.md](WEATHERNEXT.md). Google forecast statistics remain separate from
Open-Meteo alert inputs; uncertainty is shown as percentiles rather than invented
rain or thunderstorm probabilities.

## Verification scope

`npm run check` runs seven JavaScript/TypeScript tests, ten Python tests including
a local HTTP contract test, ESLint and the production build. Google SDK 3.46.1
was installed separately to verify query-configuration compatibility. Chromium
smoke checks used forecast fixtures for repeatable desktop/mobile, disabled alert,
WeatherNext success/failure and keyboard-selection behavior. A real Open-Meteo
Warsaw forecast was fetched and passed the same response validator.

The user has no approved WeatherNext access yet. No real Google forecast query,
data permissions, query cost, or hosted deployment has been verified. Google
access approval and a linked BigQuery dataset are the remaining prerequisites to
activate and verify that live comparison.

The integration also includes `python -m backend.verify_weathernext`: a default
dry run validates the exact production query and estimates scanned bytes, while
an explicit `--execute` validates real rows and writes an inspectable JSON report.
The browser and backend enforce the full 48-hour contract, UTC hour alignment and
recent initialization/fetch timestamps. These checks prevent a partial or stale
comparison from appearing as a complete WeatherNext forecast.
