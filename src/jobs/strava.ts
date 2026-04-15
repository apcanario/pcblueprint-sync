/**
 * Strava hourly sync job.
 * Scheduled: 0 * * * * (top of every hour)
 *
 * Fetches Strava activities since the last recorded sync timestamp.
 * Before writing each workout, checks against recently-ingested Zepp
 * workouts to avoid duplicates (Zepp is authoritative for overlapping data).
 */
import { logger, sendAlert } from '../lib/logger.js';
import { ingestWorkout, writeSyncStatus, readSyncStatus } from '../lib/api.js';
import { getActivitiesAfter } from '../clients/strava.js';
import { getActivities as getZeppActivities } from '../clients/zepp.js';
import { filterDuplicates } from '../lib/dedup.js';
import type { WorkoutIngestPayload, StravaActivity } from '../types/index.js';

const STRAVA_SPORT_MAP: Record<string, string> = {
  Run: 'outdoor_running',
  VirtualRun: 'indoor_running',
  Ride: 'cycling',
  VirtualRide: 'indoor_cycling',
  Swim: 'swimming',
  Walk: 'walking',
  Hike: 'hiking',
  WeightTraining: 'strength_training',
  Yoga: 'yoga',
  Elliptical: 'elliptical',
  Workout: 'workout',
};

function buildWorkoutPayload(activity: StravaActivity): WorkoutIngestPayload {
  const type =
    STRAVA_SPORT_MAP[activity.sport_type] ??
    STRAVA_SPORT_MAP[activity.type] ??
    activity.sport_type.toLowerCase();

  return {
    id: `strava-${activity.id}`,
    source: 'strava',
    start: activity.start_date,
    duration_seconds: activity.elapsed_time,
    type,
    distance_km: activity.distance > 0 ? activity.distance / 1000 : undefined,
    avg_hr: activity.average_heartrate ?? undefined,
    max_hr: activity.max_heartrate ?? undefined,
    calories: activity.calories ?? undefined,
  };
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function runStravaJob(): Promise<void> {
  logger.info('Strava job start');

  // Determine cutoff: use last Strava sync timestamp, or fall back to 48h ago
  let afterUnix: number;
  try {
    const status = await readSyncStatus();
    afterUnix = status.strava
      ? Math.floor(new Date(status.strava).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 48 * 3600;
  } catch {
    afterUnix = Math.floor(Date.now() / 1000) - 48 * 3600;
    logger.warn('Strava: could not read sync status, defaulting to 48h window');
  }

  let ingested = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const stravaActivities = await getActivitiesAfter(afterUnix);
    if (stravaActivities.length === 0) {
      logger.info('Strava job: no new activities');
      await writeSyncStatus({ strava: new Date().toISOString() });
      return;
    }

    // Fetch Zepp workouts for the same window for dedup
    const from = nDaysAgo(3);
    const to = nDaysAgo(0);
    let zeppWorkouts: WorkoutIngestPayload[] = [];
    try {
      const zeppActivities = await getZeppActivities(from, to);
      zeppWorkouts = zeppActivities.map((a) => ({
        id: `zepp-${a.trackId}`,
        source: 'zepp',
        start: new Date(a.startTime).toISOString(),
        duration_seconds: Math.round((a.endTime - a.startTime) / 1000),
        type: 'unknown',
      }));
    } catch (err) {
      logger.warn(
        'Strava: failed to fetch Zepp activities for dedup — proceeding without dedup',
        err instanceof Error ? err.message : err,
      );
    }

    const stravaPayloads = stravaActivities.map(buildWorkoutPayload);
    const toIngest = filterDuplicates(stravaPayloads, zeppWorkouts);
    skipped = stravaPayloads.length - toIngest.length;

    for (const payload of toIngest) {
      try {
        await ingestWorkout(payload);
        ingested++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${payload.id}: ${msg}`);
        logger.error('Strava workout ingest error', { id: payload.id, error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getActivitiesAfter: ${msg}`);
    logger.error('Strava: failed to fetch activities', msg);
  }

  if (errors.length === 0) {
    try {
      await writeSyncStatus({ strava: new Date().toISOString() });
    } catch (err) {
      logger.warn('Strava: failed to write sync status', err instanceof Error ? err.message : err);
    }
  } else {
    const summary = `Strava job finished with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`;
    logger.error(summary);
    await sendAlert(`⚠️ [pcblueprint-sync] ${summary}`);
  }

  logger.info(
    `Strava job done: ${ingested} ingested, ${skipped} deduped/skipped, ${errors.length} errors`,
  );
}
