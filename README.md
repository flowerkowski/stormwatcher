# StormWatch

StormWatch is a client-side rain and thunderstorm forecast dashboard. It fetches live forecast data from Open-Meteo, detects upcoming wet-weather windows, and can notify you while the page remains open.

## Features

- City search and optional browser geolocation
- Current conditions, a 48-hour precipitation chart, and a 7-day outlook
- Configurable rain and heavy-rain thresholds
- In-page, sound, and browser notifications
- Location-specific settings saved in the browser
- Responsive layout with reduced-motion support
- No API key or backend required

StormWatch is a convenience forecast tool, not an official emergency-warning service. Follow your local weather authority for safety-critical alerts.

## Run locally

Requirements: Node.js 20.19 or newer (Node 22 is recommended).

```bash
npm ci
npm run dev
```

Open the URL printed by Vite. Useful checks:

```bash
npm run check
npm run preview
```

`npm run build` creates the deployable static site in `dist/`.

## Deploy to GitHub Pages

Yes—this app is a good fit for GitHub Pages because it is fully static and calls the weather APIs directly from the browser. The included [deployment workflow](.github/workflows/deploy.yml) builds and publishes the site after every push to `main`.

Treat this `app/` directory as the repository root:

1. Create an empty GitHub repository.
2. Initialize Git in this directory, commit the files, and push the `main` branch.
3. In the GitHub repository, open **Settings → Pages**.
4. Under **Build and deployment**, choose **GitHub Actions** as the source.
5. Push to `main`, or run the workflow manually from the **Actions** tab.

The Vite build uses relative asset URLs, so it works both at `username.github.io/repository/` and on a custom domain. GitHub Pages also provides the HTTPS context required by browser geolocation and notifications.

## Easiest alternative

Netlify or Vercel can import the GitHub repository and auto-detect Vite. Use:

- Build command: `npm run build`
- Publish/output directory: `dist`
- Node version: `22`

Those services are slightly easier if you want automatic preview deployments for every pull request. For a small personal dashboard already hosted on GitHub, the included GitHub Pages workflow is the simplest option with no additional account.

## Data and browser behavior

- Forecast and city-search data come from [Open-Meteo](https://open-meteo.com/).
- Using GPS performs a best-effort reverse lookup through BigDataCloud so the coordinates have a friendly place name.
- The selected location, alert settings, and alert signatures are stored only in local browser storage.
- Monitoring stops when the page is closed. True background push alerts would require a service worker and a backend notification service.
