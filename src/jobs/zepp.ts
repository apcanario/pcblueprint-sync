/**
 * Zepp mid-morning sync job.
 * Scheduled: 0 11 * * * (11:00 daily)
 *
 * Fetches last 3 days of daily data from Zepp:
 *   • Sleep duration + stages
 *   • Resting HR, avg/min/max HR, HRV
 *   • Daily stress score
 *   • Steps, calories, distance
 *
 * Workouts are NOT pulled from Zepp. Strava is the sole workout source
 * (Zepp activities are synced to Strava automatically via the Zepp app).
 */
import { logger, sendAlert } from '../lib/logger.js';
import { ingestDaily, writeSyncStatus } from '../lib/api.js';
import { getDailySummaries } from '../clients/zepp.js';
import type { DailyIngestPayload, ZeppDailySummary } from '../types/index.js';

const LOOKBACK_DAYS = 3;

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function zeppDateToIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function buildDailyPayload(summary: ZeppDailySummary): DailyIngestPayload {
  const date = zeppDateToIso(summary.date);
  const payload: DailyIngestPayload = { date, source: 'zepp' };

  // ── Sleep ──
  if (summary.sleepDuration !== undefined || summary.sleepStart !== undefined) {
    const durationMin = summary.sleepDuration ?? 0;
    payload.sleep = {
      duration_hours: Math.floor(durationMin / 60),
      duration_minutes: durationMin % 60,
      ...(summary.sleepStart ? { sleep_start: new Date(summary.sleepStart).toISOString() } : {}),
      ...(summary.sleepEnd ? { sleep_end: new Date(summary.sleepEnd).toISOString() } : {}),
      ...(summary.deepSleep !== undefined ? {
        stages_minutes: {
          deep: summary.deepSleep ?? 0,
          light: summary.lightSleep ?? 0,
          rem: summary.remSleep ?? 0,
          awake: summary.awakeDuration ?? 0,
        },
        stages_available: true,
      } : {}),
    };
  }

  // ── Heart rate + HRV + stress ──
  if (
    summary.restingHeartRate !== undefined ||
    summary.hrv !== undefined ||
    summary.stress !== undefined
  ) {
    payload.hr = {
      ...(summary.restingHeartRate !== undefined ? { resting_hr_bpm: summary.restingHeartRate } : {}),
      ...(summary.avgHeartRate !== undefined ? { avg_hr_bpm: summary.avgHeartRate } : {}),
      ...(summary.minHeartRate !== undefined ? { min_hr_bpm: summary.minHeartRate } : {}),
      ...(summary.maxHeartRate !== undefined ? { max_hr_bpm: summary.maxHeartRate } : {}),
      ...(summary.hrv !== undefined ? { hrv_ms: summary.hrv } : {}),
      ...(summary.stress !== undefined ? { stress_score: summary.stress } : {}),
    };
  }

  // ── Activity (steps / calories / distance) ──
  if (summary.steps !== undefined || summary.calories !== undefined) {
    payload.activity = {
      ...(summary.steps !== undefined ? { steps: summary.steps } : {}),
      ...(summary.calories !== undefined ? { calories_kcal: summary.calories } : {}),
      ...(summary.distance !== undefined ? { distance_km: summary.distance / 1000 } : {}),
    };
  }

  return payload;
}

export async function runZeppJob(): Promise<void> {
  const from = nDaysAgo(LOOKBACK_DAYS);
  const to = nDaysAgo(0);
  logger.info(`Zepp job start: fetching ${from} → ${to}`);

  let ok = 0;
  const errors: string[] = [];

  try {
    const summaries = await getDailySummaries(from, to);

    for (const summary of summaries) {
      try {
        const payload = buildDailyPayload(summary);
        await ingestDaily(payload);
        ok++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`daily ${summary.date}: ${msg}`);
        logger.error('Zepp daily ingest error', { date: summary.date, error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getDailySummaries: ${msg}`);
    logger.error('Zepp: failed to fetch daily summaries', msg);
  }

  if (errors.length === 0) {
    try {
      await writeSyncStatus({ zepp: new Date().toISOString() });
    } catch (err) {
      logger.warn('Zepp: failed to write sync status', err instanceof Error ? err.message : err);
    }
  } else {
    const summary = `Zepp job: ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`;
    logger.error(summary);
    await sendAlert(`⚠️ [pcblueprint-sync] ${summary}`);
  }

  logger.info(`Zepp job done: ${ok} days ingested, ${errors.length} errors`);
}
