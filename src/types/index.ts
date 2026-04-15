// ── Ingest payloads (mirror of pcblueprint-api schema) ──────────────────────

export interface SleepStages {
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

export interface DailyIngestPayload {
  date: string;           // YYYY-MM-DD
  source: string;         // 'zepp' | 'strava' | 'coros'
  sleep?: {
    sleep_start?: string; // ISO8601
    sleep_end?: string;
    duration_hours?: number;
    duration_minutes?: number;
    stages_minutes?: SleepStages;
    stages_available?: boolean;
  };
  hr?: {
    resting_hr_bpm?: number;
    avg_hr_bpm?: number;
    min_hr_bpm?: number;
    max_hr_bpm?: number;
    readings_count?: number;
    hrv_ms?: number;
  };
  activity?: {
    steps?: number;
    calories_kcal?: number;
    distance_km?: number;
  };
}

export interface TrackPoint {
  time: string;           // ISO8601
  lat?: number;
  lng?: number;
  altitude_m?: number;
  hr?: number;
  cadence?: number;
  power_w?: number;
}

export interface WorkoutIngestPayload {
  id: string;             // idempotency key (source-native ID)
  source: string;         // 'zepp' | 'strava'
  start: string;          // ISO8601
  duration_seconds: number;
  type: string;           // sport type
  distance_km?: number;
  avg_hr?: number;
  max_hr?: number;
  calories?: number;
  trackpoints?: TrackPoint[];
}

export interface SyncStatus {
  zepp: string | null;
  strava: string | null;
}

// ── Zepp API response shapes (subset used by our client) ────────────────────

export interface ZeppDailySummary {
  date: string;           // YYYYMMDD
  steps?: number;
  calories?: number;
  distance?: number;      // metres
  sleepDuration?: number; // minutes
  deepSleep?: number;     // minutes
  lightSleep?: number;
  remSleep?: number;
  awakeDuration?: number;
  sleepStart?: number;    // unix ms
  sleepEnd?: number;
  restingHeartRate?: number;
  avgHeartRate?: number;
  minHeartRate?: number;
  maxHeartRate?: number;
  hrv?: number;           // ms
}

export interface ZeppActivity {
  trackId: string;
  startTime: number;      // unix ms
  endTime: number;
  type: number;           // sport type code
  calories: number;
  distance: number;       // metres
  avgHeartRate: number;
  maxHeartRate: number;
}

// ── Strava API response shapes (subset) ──────────────────────────────────────

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;     // ISO8601
  elapsed_time: number;   // seconds
  distance: number;       // metres
  average_heartrate?: number;
  max_heartrate?: number;
  calories?: number;
}
