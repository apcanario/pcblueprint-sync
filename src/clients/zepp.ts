/**
 * Custom Zepp (Amazfit) HTTP client.
 *
 * Targets the same undocumented endpoints used by open-source tools
 * (referenced for endpoint discovery only — no runtime dependency).
 * All auth and request code is written from scratch in this file.
 *
 * Env: ZEPP_EMAIL, ZEPP_PASSWORD, ZEPP_REGION (eu | us | cn)
 */
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logger } from '../lib/logger.js';
import type { ZeppDailySummary } from '../types/index.js';

const REGION = (process.env.ZEPP_REGION ?? 'eu').toLowerCase();
const EMAIL = process.env.ZEPP_EMAIL ?? '';
const PASSWORD = process.env.ZEPP_PASSWORD ?? '';

// Base URLs differ by region
const AUTH_HOST: Record<string, string> = {
  eu: 'api-user.huami.com',
  us: 'api-user.huami.com',
  cn: 'api-user.huami.com',
};

const DATA_HOST: Record<string, string> = {
  eu: 'api-mifit.huami.com',
  us: 'api-mifit.huami.com',
  cn: 'api-mifit.huami.com',
};

interface TokenCache {
  accessToken: string;
  appToken: string;
  expiresAt: number; // unix ms
}

let tokenCache: TokenCache | null = null;

// ── Low-level HTTP helper ───────────────────────────────────────────────

function request<T>(options: {
  hostname: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const mod = https; // Zepp API is always HTTPS
    const req = mod.request(
      {
        hostname: options.hostname,
        port: 443,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MiFit/4.6.0 (iPhone; iOS 14.0; Scale/2.00)',
          ...options.headers,
          ...(options.body
            ? { 'Content-Length': Buffer.byteLength(options.body) }
            : {}),
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
            reject(new Error(`Zepp: failed to parse response: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────

interface AuthResponse {
  access: string;
  app_token: string;
  expires_in?: number;
}

async function authenticate(): Promise<TokenCache> {
  logger.info('Zepp: authenticating');
  const body = JSON.stringify({
    app_name: 'com.xiaomi.hm.health',
    app_version: '4.6.0',
    code: '',
    country_code: REGION === 'cn' ? 'CN' : 'US',
    device_id: '02:00:00:00:00:00',
    device_model: 'phone',
    grant_type: 'password',
    third_name: REGION === 'cn' ? 'huami_phone' : 'huami_phone',
    password: Buffer.from(PASSWORD).toString('base64'),
    source: 'com.xiaomi.hm.health',
    user_name: EMAIL,
  });

  const { status, data } = await request<AuthResponse>({
    hostname: AUTH_HOST[REGION] ?? AUTH_HOST['eu'],
    path: '/user/login/normal',
    method: 'POST',
    body,
  });

  if (status !== 200 || !data.access) {
    throw new Error(`Zepp auth failed (HTTP ${status})`);
  }

  const cache: TokenCache = {
    accessToken: data.access,
    appToken: data.app_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
  };
  tokenCache = cache;
  logger.info('Zepp: authenticated successfully');
  return cache;
}

async function getToken(): Promise<TokenCache> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache;
  return authenticate();
}

// ── Public data methods ───────────────────────────────────────────────

interface ZeppDailyResponse {
  data?: {
    items?: Array<{
      date_time: string;       // YYYYMMDD
      summary?: string;        // JSON-encoded summary blob
    }>;
  };
}

/**
 * Fetch daily summaries for a date range.
 * @param fromDate YYYY-MM-DD
 * @param toDate   YYYY-MM-DD
 */
export async function getDailySummaries(
  fromDate: string,
  toDate: string,
): Promise<ZeppDailySummary[]> {
  const token = await getToken();
  const from = fromDate.replace(/-/g, '');
  const to = toDate.replace(/-/g, '');

  const { status, data } = await request<ZeppDailyResponse>({
    hostname: DATA_HOST[REGION] ?? DATA_HOST['eu'],
    path: `/api/v7/lifestyle/queryHomepageData?device_type=all&from_date=${from}&to_date=${to}`,
    method: 'GET',
    headers: { apptoken: token.appToken },
  });

  if (status === 401) {
    tokenCache = null;
    throw new Error('Zepp: 401 on data fetch — credentials may have expired');
  }
  if (status !== 200) {
    throw new Error(`Zepp daily fetch failed (HTTP ${status})`);
  }

  const items = data.data?.items ?? [];
  return items.map((item) => {
    let parsed: Partial<ZeppDailySummary> = {};
    try {
      parsed = JSON.parse(item.summary ?? '{}') as Partial<ZeppDailySummary>;
    } catch {
      // non-fatal: return partial
    }
    return {
      date: item.date_time,
      ...parsed,
    } as ZeppDailySummary;
  });
}

