/**
 * pcblueprint-sync — cron entry point
 *
 * Schedules:
 *   0 11 * * *  — Zepp mid-morning sync (HRV calculated by app after wake)
 *   0 3  * * *  — Strava nightly sync (once daily is enough)
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

  // Zepp mid-morning — 11:00 daily
  // By this time the Zepp app has had time to calculate HRV and sync overnight data.
  cron.schedule('0 11 * * *', () => {
    void safeRun('Zepp', runZeppJob);
  });

  // Strava nightly — 03:00 daily
  // One pull per day is sufficient for 1–2 training sessions.
  cron.schedule('0 3 * * *', () => {
    void safeRun('Strava', runStravaJob);
  });

  logger.info('Cron jobs registered: Zepp @ 11:00, Strava @ 03:00');

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
