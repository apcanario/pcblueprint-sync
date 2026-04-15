// ── Ingest payloads (mirror of pcblueprint-api schema) ──────────────────────

export interface SleepStages {
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

export interface DailyIngestPayload {
  date: string;           // YYYY-MM-DD
  source: string;         // 'zepp'
  sleep?: {
    sleep_start?: string;
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
    stress_score?: number;  // Zepp daily stress (0–100)
  };
  activity?: {
    steps?: number;
    calories_kcal?: number;
    distance_km?: number;
  };
}

export interface WorkoutSplit {
  split: number;
  distance_m: number;
  elapsed_time_s: number;
  elevation_diff_m: number;
  avg_speed_mps: number;
  avg_hr: number | null;
  pace_zone: number | null;
}

export interface WorkoutIngestPayload {
  id: string;               // 'strava-{id}'
  source: string;           // 'strava' | 'coros'
  start: string;            // ISO8601
  duration_seconds: number;
  type: string;             // normalised sport type
  name?: string | null;
  description?: string | null;
  distance_km?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  calories?: number | null;
  avg_speed_mps?: number | null;
  elevation_gain_m?: number | null;
  avg_cadence?: number | null;
  avg_watts?: number | null;
  polyline?: string | null;
  splits_km?: WorkoutSplit[];
  streams?: WorkoutStreams;
}

export interface WorkoutStreams {
  time: number[];           // seconds from start
  altitude?: number[];      // metres ASL
  heartrate?: number[];     // bpm
  velocity_smooth?: number[]; // m/s
}

export interface SyncStatus {
  zepp: string | null;
  strava: string | null;
}

// ── Zepp API response shapes ───────────────────────────────────────────────────

export interface ZeppDailySummary {
  date: string;             // YYYYMMDD
  steps?: number;
  calories?: number;
  distance?: number;        // metres
  sleepDuration?: number;   // minutes
  deepSleep?: number;       // minutes
  lightSleep?: number;
  remSleep?: number;
  awakeDuration?: number;
  sleepStart?: number;      // unix ms
  sleepEnd?: number;
  restingHeartRate?: number;
  avgHeartRate?: number;
  minHeartRate?: number;
  maxHeartRate?: number;
  hrv?: number;             // ms
  stress?: number;          // 0–100 daily average stress
}

// ── Strava API response shapes ─────────────────────────────────────────────

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  start_date: string;       // ISO8601
  elapsed_time: number;     // seconds
  distance: number;         // metres
  average_heartrate?: number;
  max_heartrate?: number;
  calories?: number;
}

export interface StravaSplit {
  split: number;
  distance: number;         // metres
  elapsed_time: number;     // seconds
  elevation_difference: number; // metres
  moving_time: number;
  average_speed: number;    // m/s
  average_heartrate?: number;
  pace_zone?: number;
}

export interface StravaMap {
  id: string;
  summary_polyline: string;
  polyline?: string;
}

export interface StravaActivityDetail extends StravaActivity {
  description?: string;
  total_elevation_gain: number;
  average_speed: number;    // m/s
  max_speed: number;
  average_cadence?: number;
  average_watts?: number;
  device_watts?: boolean;
  map: StravaMap;
  splits_metric: StravaSplit[];
}

export interface StravaStreamEntry {
  type: string;
  data: number[];
  series_type: string;
  original_size: number;
  resolution: string;
}

export type StravaStreams = Record<string, StravaStreamEntry>;
