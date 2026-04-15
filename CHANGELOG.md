# Changelog

All notable changes to pcblueprint-sync.

## [2026-04-15] — Initial release

### Added
- Repository created from scratch
- `src/clients/zepp.ts` — custom Zepp HTTP client (email+password auth, session token management, no third-party runtime dependency)
- `src/clients/strava.ts` — Strava OAuth v3 client (refresh token → short-lived access token flow)
- `src/jobs/zepp.ts` — nightly job at 11:00: fetches last 3 days of daily HR, HRV, sleep stages, stress, steps from Zepp and posts to `POST /health/ingest/daily`
- `src/jobs/strava.ts` — daily job at 03:00: fetches workouts since last sync with full detail + streams, posts to `POST /health/ingest/workout`
- `src/lib/api.ts` — typed POST client for pcblueprint-api ingest endpoints
- `src/lib/logger.ts` — structured stdout logger + optional Discord/Slack webhook alerting on failure
- `src/lib/dedup.ts` — reference implementation (unused; clean Zepp/Strava separation made dedup unnecessary)
- `src/types/index.ts` — shared TypeScript interfaces
- `src/index.ts` — cron scheduler entry point (node-cron)
- `Dockerfile` — Node 22 Alpine, no inbound ports
- `docker-compose.yml`
- `.env.example`
- `tsconfig.json`
- `package.json`
