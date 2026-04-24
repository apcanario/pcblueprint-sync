# pcblueprint-sync

Cron Docker container that writes Zepp and Strava data to pcblueprint-api. No LLM, no inbound ports. Fixed jobs on a timer.

## User Environment

- **OS**: Windows 11
- **Terminal**: PowerShell (always use for terminal instructions)
- **NAS**: Synology DS423+ at `192.168.1.69`, username `apcanario`
- **SSH**: `ssh apcanario@192.168.1.69` from PowerShell
- **NAS shell**: bash (once SSHed in)
- **Sync path on NAS**: `/volume1/pcblueprint-sync`
- **Env file**: `/volume1/pcblueprint-sync/.env` (mode 0600, never committed)

## Architecture

Two jobs, clean separation:

| Job | Source | Data | Schedule |
|-----|--------|------|----------|
| Zepp | Zepp/Amazfit (unofficial API) | Daily HR, HRV, sleep stages, stress, steps | `0 11 * * *` (11:00) |
| Strava | Strava OAuth v3 | Workouts with GPS, splits, elevation + HR streams | `0 3 * * *` (03:00) |

**No deduplication needed** — Zepp writes daily metrics only; Strava writes workouts only. Zepp activities auto-sync to Strava via the Zepp app, so Strava is the single source for all workout data.

## Key Files

```
src/
  index.ts              — cron scheduler entry point (node-cron)
  clients/
    zepp.ts             — custom Zepp HTTP client (email+password auth, no third-party deps)
    strava.ts           — Strava OAuth v3 client (refresh token flow)
  jobs/
    zepp.ts             — nightly daily-metrics job (last 3 days, idempotent)
    strava.ts           — daily workout job (since last sync timestamp)
  lib/
    api.ts              — typed POST client for pcblueprint-api ingest endpoints
    logger.ts           — stdout logger + optional webhook alerting
    dedup.ts            — unused, kept for reference
  types/index.ts        — shared TypeScript interfaces
Dockerfile
docker-compose.yml
.env.example
```

## Key Patterns

**Zepp auth** — email + password → session token → per-request Bearer. Token cached in memory, refreshed on 401. All HTTP logic in `src/clients/zepp.ts`. No runtime dependency on third-party Zepp libraries — custom client only.

**Strava auth** — `STRAVA_REFRESH_TOKEN` → short-lived access token via `POST https://www.strava.com/oauth/token`. Access token cached for its `expires_at` window.

**Idempotency** — Zepp job fetches last 3 days; the API upserts by date key. Strava job tracks last sync timestamp in `health/sync-status.json` and only fetches newer activities.

## Development

```bash
npm install
cp .env.example .env
# Fill in credentials
npm run build
node dist/index.js    # runs cron scheduler
```

To test a single job without waiting for cron, import and call it directly:
```typescript
// Temporary test entry point
import { runZeppJob } from './jobs/zepp';
runZeppJob().catch(console.error);
```

## Deployment (NAS)

```bash
cd /volume1/pcblueprint-sync
git pull origin main
docker compose up -d --build
```

Watchtower handles automatic image updates when a new image is pushed to ghcr.io after a merge to `main`.

## Monitoring

```bash
docker logs pcblueprint-sync --tail 50 --follow
```

Sync timestamps appear on the pcblueprint-website dashboard (Data Sources card).

## What NOT to Do

- Do NOT expose inbound ports — the container has none and needs none
- Do NOT commit `.env` — mode 0600, gitignored
- Do NOT add a third-party Zepp auth library as a runtime dependency — the custom client is intentional (keeps auth entirely in our private codebase)
- Do NOT add deduplication between Zepp/Strava — they handle different data types
- Do NOT modify the cron schedule without understanding the Zepp HRV calculation window (11:00 is after overnight HRV processing)

## Working with Claude — Operating Rules

- Never paste discovered secret values (API keys, tokens, passwords) into chat responses or PR descriptions. Reference by variable name only (e.g. "the API_KEY env var"), never the value itself.
- When investigating env/config, prefer variable-name-only output. If a value must be revealed to answer a question, warn the user first and confirm before showing it.
- Do not modify package-lock.json. If npm install drifts the lockfile, discard (git checkout --) rather than commit — pre-existing lockfile drift is being resolved separately in S04h.
- When realigning routes to PATHS constants (S04a/S04b pattern), update vi.mock('../services/fileService', ...) factories in the matching test file(s) to spread the actual module first (so PATHS and helpers stay defined), then override only the disk-touching fns (readJson, writeJson, readMarkdown, appendMarkdown, writeMarkdown, appendCsvRow).
- Docs-only pushes (changes confined to **/*.md, LICENSE, .gitignore) no longer trigger Docker rebuilds — don't wait for a deploy notification after a pure docs PR.

## Working with Claude — Session Rules

**Break work into small chunks.** Each task block should be completable in under 5 minutes.

**Commit after every block.** Small commits make rollback safe.

**Read before editing.** Always read the target file before modifying it.
