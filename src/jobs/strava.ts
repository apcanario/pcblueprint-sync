/**
 * Strava nightly sync job.
 * Scheduled: 0 3 * * * (03:00 daily)
 *
 * For each new activity since last sync:
 *   1. GET /activities/{id}          → name, polyline, elevation, pace, cadence, splits
 *   2. GET /activities/{id}/streams  → elevation + HR + velocity timeseries
 *   3. POST /health/ingest/workout   → stored in archive with git commit
 *
 * Zepp is sole source for daily HR / sleep / HRV / stress — no workouts from Zepp.
 * Strava is sole source for workouts — no deduplication needed.
 */
import { logger, sendAlert } from '../lib/logger.js';
import { ingestWorkout, writeSyncStatus, readSyncStatus } from '../lib/api.js';
import { getActivitiesAfter, getActivityDetail, getActivityStreams } from '../clients/strava.js';
import type { WorkoutIngestPayload, WorkoutSplit, StravaActivityDetail, StravaStreams } from '../types/index.js';

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
  Kayaking: 'kayaking',
  Surfing: 'surfing',
};

function normaliseType(detail: StravaActivityDetail): string {
  return (
    STRAVA_SPORT_MAP[detail.sport_type] ??
    STRAVA_SPORT_MAP[detail.type] ??
    detail.sport_type.toLowerCase().replace(/\s+/g, '_')
  );
}

function mapSplits(stravaSplits: StravaActivityDetail['splits_metric']): WorkoutSplit[] {
  return stravaSplits.map((s) => ({
    split: s.split,
    distance_m: s.distance,
    elapsed_time_s: s.elapsed_time,
    elevation_diff_m: s.elevation_difference,
    avg_speed_mps: s.average_speed,
    avg_hr: s.average_heartrate ?? null,
    pace_zone: s.pace_zone ?? null,
  }));
}

function mapStreams(streams: StravaStreams): WorkoutIngestPayload['streams'] {
  return {
    time: streams['time']?.data ?? [],
    altitude: streams['altitude']?.data,
    heartrate: streams['heartrate']?.data,
    velocity_smooth: streams['velocity_smooth']?.data,
  };
}

function buildPayload(
  detail: StravaActivityDetail,
  streams: StravaStreams | null,
): WorkoutIngestPayload {
  return {
    id: `strava-${detail.id}`,
    source: 'strava',
    start: detail.start_date,
    duration_seconds: detail.elapsed_time,
    type: normaliseType(detail),
    name: detail.name,
    description: detail.description ?? null,
    distance_km: detail.distance > 0 ? detail.distance / 1000 : null,
    avg_hr: detail.average_heartrate ?? null,
    max_hr: detail.max_heartrate ?? null,
    calories: detail.calories ?? null,
    avg_speed_mps: detail.average_speed ?? null,
    elevation_gain_m: detail.total_elevation_gain ?? null,
    avg_cadence: detail.average_cadence ?? null,
    avg_watts: (detail.device_watts && detail.average_watts) ? detail.average_watts : null,
    polyline: detail.map?.summary_polyline ?? null,
    splits_km: mapSplits(detail.splits_metric ?? []),
    streams: streams ? mapStreams(streams) : undefined,
  };
}

export async function runStravaJob(): Promise<void> {
  logger.info('Strava job start');

  let afterUnix: number;
  try {
    const status = await readSyncStatus();
    afterUnix = status.strava
      ? Math.floor(new Date(status.strava).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 48 * 3600;
  } catch {
    afterUnix = Math.floor(Date.now() / 1000) - 48 * 3600;
    logger.warn('Strava: could not read sync status — defaulting to 48h window');
  }

  let ingested = 0;
  const errors: string[] = [];

  try {
    const activities = await getActivitiesAfter(afterUnix);

    if (activities.length === 0) {
      logger.info('Strava job: no new activities');
      await writeSyncStatus({ strava: new Date().toISOString() });
      return;
    }

    for (const activity of activities) {
      try {
        // 1. Fetch full detail (polyline, elevation, splits, cadence, watts)
        const detail = await getActivityDetail(activity.id);

        // 2. Fetch timeseries streams for elevation + HR charts
        const streams = await getActivityStreams(activity.id);

        // 3. Map and ingest
        const payload = buildPayload(detail, streams);
        await ingestWorkout(payload);
        ingested++;

        logger.info(`Strava: ingested ${payload.name ?? payload.id}`, {
          type: payload.type,
          distance_km: payload.distance_km,
          polyline: payload.polyline ? `${payload.polyline.length} chars` : 'none',
          splits: payload.splits_km?.length ?? 0,
          streams: payload.streams?.time.length ?? 0,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${activity.id}: ${msg}`);
        logger.error('Strava: activity ingest error', { id: activity.id, error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`getActivitiesAfter: ${msg}`);
    logger.error('Strava: failed to fetch activity list', msg);
  }

  if (errors.length === 0) {
    try {
      await writeSyncStatus({ strava: new Date().toISOString() });
    } catch (err) {
      logger.warn('Strava: failed to write sync status', err instanceof Error ? err.message : err);
    }
  } else {
    const summary = `Strava job: ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`;
    logger.error(summary);
    await sendAlert(`⚠️ [pcblueprint-sync] ${summary}`);
  }

  logger.info(`Strava job done: ${ingested} ingested, ${errors.length} errors`);
}
