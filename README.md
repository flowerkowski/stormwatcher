# StormWatch

[![Deploy to GitHub Pages](https://github.com/flowerkowski/stormwatcher/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/flowerkowski/stormwatcher/actions/workflows/deploy.yml)

StormWatch is a focused rain and thunderstorm dashboard for the next few hours and days. Choose a city or allow browser geolocation, then keep the tab open to receive configurable in-page, sound, and browser alerts.

## Features

- City search with optional browser geolocation
- Current conditions, a 48-hour precipitation outlook, and a 7-day forecast
- Configurable rain-probability and heavy-rain thresholds
- In-page toasts, synthesized alert sounds, and browser notifications
- Location-specific settings and alert history stored in browser storage
- Responsive layout with reduced-motion support
- No API key, server, or account required
- Optional WeatherNext 3 ensemble comparison through a credentialed backend

StormWatch is a convenience forecast tool, not an official emergency-warning service. Follow your local weather authority for safety-critical alerts.

## Try it locally

Requirements: Node.js 22.18 or newer, plus Python 3 for the backend tests in
`npm run check`. Node 22 is used by the deployment workflow. The optional Google
backend also needs the Python dependencies listed in `backend/requirements.txt`.

```bash
git clone https://github.com/flowerkowski/stormwatcher.git
cd stormwatcher
npm ci
npm run dev
```

Open the local URL printed by Vite. Before opening a pull request, run the same checks used in CI:

```bash
npm run check
```

`npm run build` writes the production site to `dist/`; `npm run preview` serves that build locally.

## GitHub Pages deployment

The repository includes a [GitHub Actions deployment workflow](.github/workflows/deploy.yml). It installs the locked dependencies, lints the project, builds `dist/`, and publishes it to GitHub Pages after pushes to `main`.

To enable it:

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy StormWatch to GitHub Pages** manually from the **Actions** tab.

For a project site, the expected URL is `https://flowerkowski.github.io/stormwatcher/` once Pages is enabled. The app uses relative asset URLs and does not depend on a server-side router, so it also works on a custom domain.

## Other static hosts

Netlify, Vercel, and Cloudflare Pages can import this repository directly. If configuring one manually, use:

- Build command: `npm run build`
- Output directory: `dist`
- Node.js version: `22`

These services are useful when you want automatic preview deployments for pull requests. GitHub Pages is the smallest setup for this repository.

## Data, privacy, and notifications

- Forecast and city-search data come from [Open-Meteo](https://open-meteo.com/).
- GPS is requested only after you choose **Use GPS**. A best-effort reverse lookup through [BigDataCloud](https://www.bigdatacloud.net/) gives the coordinates a friendly place name.
- The selected location, alert settings, and alert signatures stay in your browser's local storage.
- Forecast monitoring and alerts run only while the page is open. Background push notifications would require a service worker and a notification backend.

## WeatherNext 3

The optional comparison shows Google ensemble mean rainfall, p10–p90 spread,
temperature and wind beside matching Open-Meteo hours. Google requires approved
data access and a backend; the static app works without these. See
[setup, data semantics and verification limits](docs/WEATHERNEXT.md).

## Contributing

Issues and pull requests are welcome. Please include the browser, viewport, and steps to reproduce for UI or notification problems, and run `npm run check` before submitting a change.
