# pcblueprint-sync

Docker cron container that pulls fitness data from Zepp and Strava and writes it to `pcblueprint-api`. Runs on the same Synology NAS as the API.

---

## What it does

| Job | Source | Data | Schedule |
|---|---|---|---|
| Zepp nightly | Zepp/Amazfit (unofficial API) | Daily HR, HRV, sleep stages, stress score | `0 11 * * *` (11:00) |
| Strava daily | Strava OAuth v3 | Workouts with GPS polyline, splits, elevation + HR streams | `0 3 * * *` (03:00) |

**Zepp at 11:00** — by then the app has finished calculating HRV and stress from your sleep.

**Strava at 03:00** — once a day is enough for 1–2 sessions/day. Zepp activities auto-sync to Strava via the Zepp app, so Strava is the single source for all workout data.

**No deduplication needed** — Zepp writes daily metrics only. Strava writes workouts only. Clean separation.

---

## Setup

Deployed on the NAS as an image pulled from `ghcr.io/apcanario/pcblueprint-sync:latest` — same pattern as `pcblueprint-api`. No source tree on the NAS; Watchtower pulls new images automatically after every merge to `main`.

### 1. Create the compose directory on the NAS

```bash
ssh apcanario@192.168.1.69
mkdir -p /volume2/docker/sync
cd /volume2/docker/sync
```

### 2. Drop in `compose.yaml`

```yaml
services:
  pcblueprint-sync:
    image: ghcr.io/apcanario/pcblueprint-sync:latest
    container_name: pcblueprint-sync
    restart: unless-stopped
    env_file: .env
```

No inbound ports — the worker only makes outbound HTTP calls to Zepp, Strava, and the api container.

### 3. Create `.env` from the template

Copy the block below into `/volume2/docker/sync/.env` and fill in the values. Mode `0600`, never committed.

```env
# pcblueprint-api
API_URL=http://pcblueprint-api:3001
API_TOKEN=<same value as API_KEY in /volume2/docker/api/compose.yaml>

# Zepp/Amazfit
ZEPP_EMAIL=your@gmail.com
ZEPP_PASSWORD=<set in Zepp app: Profile → Account Security → Set Password>
ZEPP_REGION=eu                     # eu / us / cn

# Strava
STRAVA_CLIENT_ID=<from strava.com/settings/api>
STRAVA_CLIENT_SECRET=<from strava.com/settings/api>
STRAVA_REFRESH_TOKEN=<one-time OAuth flow — see below>

# Optional: webhook for sync failure alerts (Discord/Slack)
ALERT_WEBHOOK_URL=
```

```bash
chmod 600 .env
```

### 4. Get a Strava refresh token (one-time)

1. Create an API app at [strava.com/settings/api](https://www.strava.com/settings/api)
2. Open this URL in a browser (replace `YOUR_CLIENT_ID`):
   ```
   https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all
   ```
3. Click Authorize → you land on `http://localhost?code=XXXX` — copy the `code`
4. Exchange it for a refresh token:
   ```bash
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET \
     -d code=CODE_FROM_STEP_3 \
     -d grant_type=authorization_code
   ```
5. Copy `refresh_token` from the response into `.env` — it never expires unless you revoke it

### 5. Set a Zepp password

Zepp app → Profile tab → your avatar → Account Security → **Set Password**.

You can set a password even if you signed up with Google. Use your Google email as `ZEPP_EMAIL`.

### 6. Add the container to Watchtower's watch list

Watchtower runs alongside the api under `/volume2/docker/api/compose.yaml`. Append `pcblueprint-sync` to its `command:` so updates are auto-pulled:

```yaml
  watchtower:
    # ...
    command: pcblueprint-api pcblueprint-sync
```

Restart the api stack so Watchtower picks up the change:

```bash
cd /volume2/docker/api
docker compose up -d
```

### 7. Start the sync container

```bash
cd /volume2/docker/sync
docker compose up -d
```

The container runs cron internally. No inbound ports exposed.

---

## Project structure

```
pcblueprint-sync/
├── src/
│   ├── index.ts              # Cron scheduler entry point
│   ├── clients/
│   │   ├── zepp.ts           # Custom Zepp HTTP client (no third-party auth dep)
│   │   └── strava.ts         # Strava OAuth v3 client
│   ├── jobs/
│   │   ├── zepp.ts           # Nightly daily-metrics job
│   │   └── strava.ts         # Daily workout job (detail + streams per activity)
│   ├── lib/
│   │   ├── api.ts            # Typed client for pcblueprint-api ingest endpoints
│   │   ├── logger.ts         # Stdout logger + optional webhook alerts
│   │   └── dedup.ts          # Unused — kept for reference
│   └── types/
│       └── index.ts          # Shared TypeScript types
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── tsconfig.json
```

---

## How it works

### Zepp job (`src/jobs/zepp.ts`)

- Authenticates with Zepp via email + password (custom HTTP client, no third-party runtime dep)
- Fetches the last 3 days of daily summaries (idempotent — re-running doesn't create duplicates)
- Posts to `POST /health/ingest/daily` with HR, HRV, sleep stages, stress score, steps
- Updates `sync-status.json` with the timestamp of the last successful run
- Token cached in memory, refreshed on 401

### Strava job (`src/jobs/strava.ts`)

- Uses OAuth refresh token flow to get a short-lived access token
- Fetches activities since last sync from `GET /athlete/activities`
- For each new activity: fetches full detail (`GET /activities/{id}`) + streams (`GET /activities/{id}/streams`)
- Builds payload with polyline, splits, elevation, cadence, watts where available
- Posts to `POST /health/ingest/workout`
- Strava rate limits: 100 req/15min, 1000/day — at 2 calls/activity × ~2 activities/day = well within limits

---

## Monitoring

Logs go to stdout — view with:
```bash
docker logs pcblueprint-sync --tail 50 --follow
```

If `ALERT_WEBHOOK_URL` is set, sync failures post a JSON message to it (Discord/Slack compatible).

Sync timestamps are visible on the website dashboard (Data Sources badges).

---

## Updating

Automatic via Watchtower (polls `ghcr.io` every 300s). After a merge to `main`, the GitHub Actions workflow publishes a new `:latest` image, Watchtower pulls it on the next tick, and the container restarts.

To force an immediate pull without waiting for the poll:

```bash
ssh apcanario@192.168.1.69
cd /volume2/docker/sync
docker compose pull && docker compose up -d
```

---

*Part of the pcblueprint system. Built with Claude. Maintained by Pedro.*
