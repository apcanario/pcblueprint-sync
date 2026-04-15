import { logger } from './logger.js';
import type { WorkoutIngestPayload } from '../types/index.js';

/**
 * Returns true if a Strava activity is considered a duplicate of an existing
 * Zepp workout already written to the archive.
 *
 * Criteria (both must match):
 *   • start_time within ±5 minutes
 *   • duration_seconds within ±60 seconds
 */
export function isDuplicate(
  stravaWorkout: WorkoutIngestPayload,
  existingZeppWorkouts: WorkoutIngestPayload[],
): boolean {
  const stravaStart = new Date(stravaWorkout.start).getTime();

  for (const zepp of existingZeppWorkouts) {
    const zeppStart = new Date(zepp.start).getTime();
    const startDiffMs = Math.abs(stravaStart - zeppStart);
    const durationDiff = Math.abs(stravaWorkout.duration_seconds - zepp.duration_seconds);

    if (startDiffMs <= 5 * 60 * 1000 && durationDiff <= 60) {
      logger.info(
        'Dedup: Strava activity matches Zepp workout — skipping Strava write',
        {
          stravaId: stravaWorkout.id,
          zeppId: zepp.id,
          startDiffMs,
          durationDiff,
        },
      );
      return true;
    }
  }

  return false;
}

/**
 * Filters a list of Strava workouts, returning only those that have no
 * matching Zepp workout (i.e. Strava-only activities).
 *
 * Emits a WARN log for any near-miss (within 10 min + 120 s) that doesn't
 * quite hit the dedup threshold, for manual review.
 */
export function filterDuplicates(
  stravaWorkouts: WorkoutIngestPayload[],
  zeppWorkouts: WorkoutIngestPayload[],
): WorkoutIngestPayload[] {
  return stravaWorkouts.filter((sw) => {
    if (isDuplicate(sw, zeppWorkouts)) return false;

    // Near-miss warning: same activity window, just outside threshold
    const swStart = new Date(sw.start).getTime();
    for (const zw of zeppWorkouts) {
      const zwStart = new Date(zw.start).getTime();
      const startDiffMs = Math.abs(swStart - zwStart);
      const durationDiff = Math.abs(sw.duration_seconds - zw.duration_seconds);
      if (startDiffMs <= 10 * 60 * 1000 && durationDiff <= 120) {
        logger.warn(
          'Dedup near-miss: Strava and Zepp workouts close but outside threshold — manual review advised',
          { stravaId: sw.id, zeppId: zw.id, startDiffMs, durationDiff },
        );
      }
    }

    return true;
  });
}
