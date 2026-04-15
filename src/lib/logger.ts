import https from 'https';
import http from 'http';
import { URL } from 'url';

const WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';

function timestamp(): string {
  return new Date().toISOString();
}

function fmt(level: string, message: string, meta?: unknown): string {
  const suffix = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp()}] ${level.padEnd(5)} ${message}${suffix}`;
}

export const logger = {
  info(message: string, meta?: unknown): void {
    console.log(fmt('INFO', message, meta));
  },
  warn(message: string, meta?: unknown): void {
    console.warn(fmt('WARN', message, meta));
  },
  error(message: string, meta?: unknown): void {
    console.error(fmt('ERROR', message, meta));
  },
};

/**
 * Send a plain-text alert to ALERT_WEBHOOK_URL (Discord/Slack compatible).
 * Non-blocking — failure is logged but never throws.
 */
export async function sendAlert(message: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  const body = JSON.stringify({ content: message });
  try {
    await new Promise<void>((resolve, reject) => {
      const url = new URL(WEBHOOK_URL);
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    logger.warn('Failed to send webhook alert', err instanceof Error ? err.message : err);
  }
}
