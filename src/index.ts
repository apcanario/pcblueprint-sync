/**
 * pcblueprint-sync — cron entry point
 *
 * Schedules:
 *   0 3 * * *  — Zepp nightly sync (last 3 days, idempotent)
 *   0 * * * *  — Strava hourly incremental sync
 *
 * This process exposes no inbound ports. Credentials are read from
 * environment variables (mount .env mode 0600 at runtime).
 */
import cron from 'node-cron';
import { logger, sendAlert } from './lib/logger.js';
import { runZeppJob } from './jobs/zepp.js';
import { runStravaJob } from './jobs/strava.js';

function validateEnv(): void {
  const required = [
    'API_URL',
    'API_TOKEN',
    'ZEPP_EMAIL',
    'ZEPP_PASSWORD',
    'STRAVA_CLIENT_ID',
    'STRAVA_CLIENT_SECRET',
    'STRAVA_REFRESH_TOKEN',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}

async function safeRun(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`${name} job crashed unexpectedly`, msg);
    await sendAlert(`🔴 [pcblueprint-sync] ${name} job crashed: ${msg}`);
  }
}

function main(): void {
  validateEnv();
  logger.info('pcblueprint-sync starting up');

  // Zepp nightly — 03:00 every day
  cron.schedule('0 3 * * *', () => {
    void safeRun('Zepp', runZeppJob);
  });

  // Strava hourly — top of every hour
  cron.schedule('0 * * * *', () => {
    void safeRun('Strava', runStravaJob);
  });

  logger.info('Cron jobs registered: Zepp @ 03:00, Strava @ every :00');

  // Keep the process alive
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully');
    process.exit(0);
  });
  process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down gracefully');
    process.exit(0);
  });
}

main();
