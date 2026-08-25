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

## Deploy to Render (public URL)

1. Push this folder to a **GitHub** repository (see below if `git` is unavailable).
2. Sign up at [render.com](https://render.com) and connect your GitHub account.
3. Click **New → Blueprint** and select the repo (Render reads `render.yaml` automatically).
   - Or **New → Web Service**, pick the repo, set **Language** to **Ruby**, **Build command** to `bundle install`, **Start command** to `bundle exec ruby server.rb`.
4. Deploy. Render gives you a public HTTPS URL like `https://socal-surf-guide.onrender.com`.

**If git fails on your Mac** (Xcode license): create a repo at [github.com/new](https://github.com/new), then upload these files via the GitHub website (“Add file → Upload files”).

### Is it safe to make public?

**Yes, for this app.** There are no API keys, passwords, or user data stored anywhere. The proxy only forwards read-only Spitcast forecast requests and rejects all other paths. Render provides HTTPS automatically.

Keep in mind:
- **Spitcast terms** — credit them (footer already does); don’t name the app “Spitcast.”
- **Free tier** — Render sleeps after ~15 min idle; first load may take ~30–60 s.
- **No login needed** — anyone with the URL can use it; that’s fine since there’s nothing private to protect.

## Alerts

Click **Enable alerts** to get a browser notification when perfect conditions are detected for the current day.

## Data

Forecast data from [Spitcast](https://www.spitcast.com) (NOAA-sourced swell, wind, and tide).
