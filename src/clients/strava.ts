/**
 * Strava OAuth v3 client.
 * Auth: refresh-token flow — no browser required after initial setup.
 * Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
 */
import https from 'https';
import { logger } from '../lib/logger.js';
import type { StravaActivity, StravaActivityDetail, StravaStreams } from '../types/index.js';

const CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? '';
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN ?? '';

interface AccessTokenCache {
  accessToken: string;
  expiresAt: number; // unix seconds
}

let tokenCache: AccessTokenCache | null = null;

// ── HTTP helper ───────────────────────────────────────────────────────────────────

function httpsRequest<T>(
  method: string,
  path: string,
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.strava.com',
        port: 443,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) as T });
          } catch {
            reject(new Error(`Strava: failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Auth ────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  expires_at: number;
}

async function refreshAccessToken(): Promise<AccessTokenCache> {
  logger.info('Strava: refreshing access token');
  const body = JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const { status, data } = await httpsRequest<TokenResponse>('POST', '/oauth/token', body);
  if (status !== 200 || !data.access_token) {
    throw new Error(`Strava token refresh failed (HTTP ${status})`);
  }
  const cache: AccessTokenCache = { accessToken: data.access_token, expiresAt: data.expires_at };
  tokenCache = cache;
  logger.info('Strava: token refreshed');
  return cache;
}

async function getAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 60 > nowSec) return tokenCache.accessToken;
  return (await refreshAccessToken()).accessToken;
}

// ── Public methods ──────────────────────────────────────────────────────────

/**
 * Fetch all activities after a Unix timestamp (paginated).
 */
export async function getActivitiesAfter(afterUnix: number): Promise<StravaActivity[]> {
  const token = await getAccessToken();
  const all: StravaActivity[] = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const path = `/api/v3/athlete/activities?after=${afterUnix}&per_page=${perPage}&page=${page}`;
    const { status, data } = await httpsRequest<StravaActivity[]>(
      'GET', path, undefined, { Authorization: `Bearer ${token}` },
    );
    if (status === 401) { tokenCache = null; throw new Error('Strava: 401 — token revoked'); }
    if (status !== 200) throw new Error(`Strava activities fetch failed (HTTP ${status})`);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  logger.info(`Strava: fetched ${all.length} activities after ${new Date(afterUnix * 1000).toISOString()}`);
  return all;
}

/**
 * Fetch full activity detail including map polyline, elevation, cadence, splits.
 */
export async function getActivityDetail(id: number): Promise<StravaActivityDetail> {
  const token = await getAccessToken();
  const { status, data } = await httpsRequest<StravaActivityDetail>(
    'GET', `/api/v3/activities/${id}`, undefined, { Authorization: `Bearer ${token}` },
  );
  if (status === 401) { tokenCache = null; throw new Error('Strava: 401 on detail fetch'); }
  if (status !== 200) throw new Error(`Strava activity detail failed (HTTP ${status}) id=${id}`);
  return data;
}

/**
 * Fetch elevation, heartrate, and velocity timeseries for chart rendering.
 * Returns null if the activity has no GPS (e.g. indoor trainer).
 */
export async function getActivityStreams(id: number): Promise<StravaStreams | null> {
  const token = await getAccessToken();
  const keys = 'time,altitude,heartrate,velocity_smooth';
  const path = `/api/v3/activities/${id}/streams?keys=${keys}&key_by_type=true`;
  const { status, data } = await httpsRequest<StravaStreams>(
    'GET', path, undefined, { Authorization: `Bearer ${token}` },
  );
  if (status === 404) return null; // indoor / no GPS
  if (status === 401) { tokenCache = null; throw new Error('Strava: 401 on streams fetch'); }
  if (status !== 200) throw new Error(`Strava streams failed (HTTP ${status}) id=${id}`);
  // Empty or minimal response = no useful stream data
  const time = (data as StravaStreams)['time'];
  if (!time || !time.data || time.data.length === 0) return null;
  return data;
}
