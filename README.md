# SoCal Surf Guide

A local web app that matches Southern California surf conditions to the right board — and tells you when conditions are perfect.

## Beaches covered

| Beach | Data source |
|-------|-------------|
| San Onofre | Spitcast |
| Trails | Spitcast |
| Doheny State Beach | Spitcast |
| Strands | Salt Creek (nearest Spitcast spot) |
| West Street | Brooks Street, Laguna (nearest Spitcast spot) |

## Recommendations

- **5+ ft** → Body board / body surf
- **1–4 ft** → Longboard
- **Under 1 ft** → Swimming

## Perfect conditions scoring

Each hour is scored (0–100) using wave height, shape quality, offshore wind, and tide. Sessions scoring **72+** are flagged as "perfect." The banner at the top shows the best spot and time for the selected day.

Ideal setup for these breaks: **E–NE offshore wind**, **mid tide**, **1–4 ft clean waves**.

## Run locally

```bash
cd socal-surf-guide
ruby server.rb
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser.

The Ruby server serves the app and proxies Spitcast API requests (required because the API has no browser CORS headers).

To preview the Cloudflare setup (static files + Worker proxy):

```bash
npx wrangler dev
```

## Deploy to Cloudflare (public URL)

This is the public host. HTML is on Cloudflare’s CDN, so the first visit should load immediately. A Worker proxies Spitcast the same way `server.rb` does.

```bash
npx wrangler deploy
```

The URL looks like `https://socal-surf-guide.<account>.workers.dev`.

**Render remains a backup.** `render.yaml` is unchanged. The Render URL can still sleep on the free plan.

### Is it safe to make public?

**Yes, for the forecast proxy.** It only forwards read-only Spitcast requests and rejects other paths. Cloudflare provides HTTPS automatically.

Profiles are optional. Passwords are hashed, and beaches, boards, and photos are stored only for someone who signs in. Signed-out visits are not saved.

Keep in mind:
- **Spitcast terms** — credit them (footer already does); don’t name the app “Spitcast.”

## Data

Forecast data from [Spitcast](https://www.spitcast.com) (NOAA-sourced swell, wind, and tide).
