import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logger } from './logger.js';
import type { DailyIngestPayload, WorkoutIngestPayload, SyncStatus } from '../types/index.js';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const API_TOKEN = process.env.API_TOKEN ?? '';

function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const mod = url.protocol === 'https:' ? https : http;

    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode === 204) { resolve(undefined as T); return; }
          try {
            const parsed = JSON.parse(raw) as T;
            if ((res.statusCode ?? 200) >= 400) {
              reject(new Error(`API ${res.statusCode}: ${raw}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Failed to parse API response: ${raw}`));
          }
        });
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Upsert a day's health data (sleep, HR, activity). Idempotent on date+source. */
export async function ingestDaily(payload: DailyIngestPayload): Promise<void> {
  await request<void>('POST', '/health/ingest/daily', payload);
  logger.info('ingestDaily OK', { date: payload.date, source: payload.source });
}

/** Upsert a workout. Idempotent on id. */
export async function ingestWorkout(payload: WorkoutIngestPayload): Promise<void> {
  await request<void>('POST', '/health/ingest/workout', payload);
  logger.info('ingestWorkout OK', { id: payload.id, source: payload.source });
}

/** Write sync status timestamps (called after each successful job). */
export async function writeSyncStatus(status: Partial<SyncStatus>): Promise<void> {
  await request<void>('POST', '/health/ingest/sync-status', status);
  logger.info('writeSyncStatus OK', status);
}

/** Read current sync status (used by Strava job for incremental cutoff). */
export async function readSyncStatus(): Promise<SyncStatus> {
  return request<SyncStatus>('GET', '/health/ingest/sync-status');
}
