/**
 * Zepp nightly sync job.
 * Scheduled: 0 3 * * * (03:00 daily)
 *
 * Fetches the last 3 days of data from Zepp and ingests daily summaries
 * and workouts via pcblueprint-api. Fully idempotent — re-running
 * produces no duplicate commits in the archive.
 */
import { logger, sendAlert } from '../lib/logger.js';
import { ingestDaily, ingestWorkout, writeSyncStatus } from '../lib/api.js';
import { getDailySummaries, getActivities } from '../clients/zepp.js';
import type { DailyIngestPayload, WorkoutIngestPayload, ZeppDailySummary, ZeppActivity } from '../types/index.js';

const LOOKBACK_DAYS = 3;

const ZEPP_SPORT_MAP: Record<number, string> = {
  1: 'outdoor_running',
  3: 'cycling',
  6: 'swimming',
  9: 'walking',
  10: 'hiking',
  16: 'elliptical',
  22: 'strength_training',
  48: 'yoga',
  93: 'indoor_running',
};

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

  if (
    summary.sleepDuration !== undefined ||
    summary.sleepStart !== undefined
  ) {
    const durationMin = summary.sleepDuration ?? 0;
    payload.sleep = {
      duration_hours: Math.floor(durationMin / 60),
      duration_minutes: durationMin % 60,
      ...(summary.sleepStart
        ? { sleep_start: new Date(summary.sleepStart).toISOString() }
        : {}),
      ...(summary.sleepEnd
        ? { sleep_end: new Date(summary.sleepEnd).toISOString() }
        : {}),
      ...(summary.deepSleep !== undefined
        ? {
            stages_minutes: {
              deep: summary.deepSleep ?? 0,
              light: summary.lightSleep ?? 0,
              rem: summary.remSleep ?? 0,
              awake: summary.awakeDuration ?? 0,
            },
            stages_available: true,
          }
        : {}),
    };
  }

  if (summary.restingHeartRate !== undefined || summary.hrv !== undefined) {
    payload.hr = {
      ...(summary.restingHeartRate !== undefined ? { resting_hr_bpm: summary.restingHeartRate } : {}),
      ...(summary.avgHeartRate !== undefined ? { avg_hr_bpm: summary.avgHeartRate } : {}),
      ...(summary.minHeartRate !== undefined ? { min_hr_bpm: summary.minHeartRate } : {}),
      ...(summary.maxHeartRate !== undefined ? { max_hr_bpm: summary.maxHeartRate } : {}),
      ...(summary.hrv !== undefined ? { hrv_ms: summary.hrv } : {}),
    };
  }

  if (summary.steps !== undefined || summary.calories !== undefined) {
    payload.activity = {
      ...(summary.steps !== undefined ? { steps: summary.steps } : {}),
      ...(summary.calories !== undefined ? { calories_kcal: summary.calories } : {}),
      ...(summary.distance !== undefined ? { distance_km: summary.distance / 1000 } : {}),
    };
  }

  return payload;
}

function buildWorkoutPayload(activity: ZeppActivity): WorkoutIngestPayload {
  const durationSeconds = Math.round((activity.endTime - activity.startTime) / 1000);
  const type = ZEPP_SPORT_MAP[activity.type] ?? `zepp_sport_${activity.type}`;

  return {
    id: `zepp-${activity.trackId}`,
    source: 'zepp',
    start: new Date(activity.startTime).toISOString(),
    duration_seconds: durationSeconds,
    type,
    distance_km: activity.distance > 0 ? activity.distance / 1000 : undefined,
    avg_hr: activity.avgHeartRate > 0 ? activity.avgHeartRate : undefined,
    max_hr: activity.maxHeartRate > 0 ? activity.maxHeartRate : undefined,
    calories: activity.calories > 0 ? activity.calories : undefined,
  };
}

export async function runZeppJob(): Promise<void> {
  const from = nDaysAgo(LOOKBACK_DAYS);
  const to = nDaysAgo(0);
  logger.info(`Zepp job start: fetching ${from} → ${to}`);

  let dailyOk = 0;
  let workoutsOk = 0;
  const errors: string[] = [];

  // ── Daily summaries ──
  try {
    const summaries = await getDailySummaries(from, to);
    for (const summary of summaries) {
      try {
        const payload = buildDailyPayload(summary);
        await ingestDaily(payload);
        dailyOk++;
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

  // ── Workouts ──
  try {
    const activities = await getActivities(from, to);
    for (const activity of activities) {
      try {
        const payload = buildWorkoutPayload(activity);
        await ingestWorkout(payload);
        workoutsOk++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`workout ${activity.trackId}: ${msg}`);
        logger.error('Zepp workout ingest error', { trackId: activity.trackId, error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getActivities: ${msg}`);
    logger.error('Zepp: failed to fetch activities', msg);
  }

  // ── Sync status ──
  if (errors.length === 0) {
    try {
      await writeSyncStatus({ zepp: new Date().toISOString() });
    } catch (err) {
      logger.warn('Zepp: failed to write sync status', err instanceof Error ? err.message : err);
    }
  } else {
    const summary = `Zepp job finished with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`;
    logger.error(summary);
    await sendAlert(`⚠️ [pcblueprint-sync] ${summary}`);
  }

  logger.info(`Zepp job done: ${dailyOk} daily + ${workoutsOk} workouts ingested, ${errors.length} errors`);
}
