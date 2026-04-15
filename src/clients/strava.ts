/**
 * Strava OAuth v3 client.
 *
 * Uses the official Strava API: https://developers.strava.com/docs/reference/
 * Auth: refresh-token flow — no browser required after initial setup.
 *
 * Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
 */
import https from 'https';
import { logger } from '../lib/logger.js';
import type { StravaActivity } from '../types/index.js';

const CLIENT_ID = process.env.STRAVA_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET ?? '';
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN ?? '';

interface AccessTokenCache {
  accessToken: string;
  expiresAt: number; // unix seconds
}

let tokenCache: AccessTokenCache | null = null;

// ── Low-level HTTPS helper ───────────────────────────────────────────────

function httpsRequest<T>(
  method: string,
  hostname: string,
  path: string,
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
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

// ── Auth ──────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  expires_at: number; // unix seconds
  refresh_token?: string;
}

async function refreshAccessToken(): Promise<AccessTokenCache> {
  logger.info('Strava: refreshing access token');
  const body = JSON.stringify({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const { status, data } = await httpsRequest<TokenResponse>(
    'POST',
    'www.strava.com',
    '/oauth/token',
    body,
  );

  if (status !== 200 || !data.access_token) {
    throw new Error(`Strava token refresh failed (HTTP ${status})`);
  }

  const cache: AccessTokenCache = {
    accessToken: data.access_token,
    expiresAt: data.expires_at,
  };
  tokenCache = cache;
  logger.info('Strava: token refreshed');
  return cache;
}

async function getAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 60 > nowSec) {
    return tokenCache.accessToken;
  }
  const cache = await refreshAccessToken();
  return cache.accessToken;
}

// ── Public data methods ───────────────────────────────────────────────

/**
 * Fetch all Strava activities after a given Unix timestamp.
 * Paginates automatically until no more results.
 */
export async function getActivitiesAfter(afterUnix: number): Promise<StravaActivity[]> {
  const token = await getAccessToken();
  const all: StravaActivity[] = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const path = `/api/v3/athlete/activities?after=${afterUnix}&per_page=${perPage}&page=${page}`;
    const { status, data } = await httpsRequest<StravaActivity[]>(
      'GET',
      'www.strava.com',
      path,
      undefined,
      { Authorization: `Bearer ${token}` },
    );

    if (status === 401) {
      tokenCache = null;
      throw new Error('Strava: 401 — token may have been revoked');
    }
    if (status !== 200) {
      throw new Error(`Strava activities fetch failed (HTTP ${status})`);
    }
    if (!Array.isArray(data) || data.length === 0) break;

    all.push(...data);
    if (data.length < perPage) break;
    page++;
  }

  logger.info(`Strava: fetched ${all.length} activities after ${new Date(afterUnix * 1000).toISOString()}`);
  return all;
}
