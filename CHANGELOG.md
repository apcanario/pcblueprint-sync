# Changelog

All notable changes to pcblueprint-sync.

## [2026-04-25] — S06b — Sync Worker Containerise + Deploy

### Added
- `.github/workflows/publish.yml` — builds + pushes `ghcr.io/apcanario/pcblueprint-sync` to GHCR on every merge to `main`. Multi-arch (`linux/amd64,linux/arm64`), tagged `:latest` + `:sha-<short>`, GHCR creds from `GITHUB_TOKEN`, gha cache. Mirrors `pcblueprint-api/.github/workflows/docker.yml` exactly. Docs-only pushes (`**/*.md`, `LICENSE`, `.gitignore`) skipped via `paths-ignore`.

### Changed
- `CLAUDE.md` Deployment section now names the workflow file and the multi-arch tags, and notes that Watchtower needs `pcblueprint-sync` in its `command:` list to pick up new images.

### Increment
*Pedro can now merge to `pcblueprint-sync/main` and within ~3 minutes there's a fresh `ghcr.io/apcanario/pcblueprint-sync:latest` image waiting for Watchtower to pull. The README's Setup section, which has described this deploy path since 2026-04-25 morning, is no longer aspirational — the workflow that backs it now exists. Two steps still need Pedro's hands on the NAS: appending `pcblueprint-sync` to Watchtower's `command:` list in `/volume2/docker/api/compose.yaml`, and creating `/volume2/docker/sync/{compose.yaml,.env}` then `docker compose up -d` to start the container for the first time. After that, every subsequent code change ships hands-free.*

## [2026-04-24] — S04d (CLAUDE.md Operating Rules)

### Changed
- Added *Working with Claude — Operating Rules* section to `CLAUDE.md` (same content landed across the 4-repo batch: api, archive, website, sync). Codifies: never paste secret values into chat/PRs (variable-name-only); don't modify `package-lock.json` (defer drift to a dedicated PR); `vi.mock` factory pattern for PATHS-aligned route tests; docs-only pushes no longer trigger Docker rebuilds on the api side

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
