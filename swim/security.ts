import crypto from 'crypto';

const SAFE_ID = /^[a-zA-Z0-9._:-]{1,160}$/;
const TRACKING_NUMBER = /^[A-Za-z0-9-]{4,80}$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const HS_CODE = /^[0-9]{4,12}$/;

export function requireSafeId(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

export function normalizeTrackingNumber(value: unknown): string {
  const normalized = String(value || '').replace(/\s+/g, '').trim();
  if (!TRACKING_NUMBER.test(normalized)) {
    throw new Error('Tracking number format is invalid.');
  }
  return normalized.toUpperCase();
}

export function normalizeCountryCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toUpperCase();
  if (!COUNTRY_CODE.test(normalized)) {
    throw new Error('Country code must be a 2-letter ISO code.');
  }
  return normalized;
}

export function normalizeHsCode(value: unknown): string {
  const normalized = String(value || '').replace(/[^0-9]/g, '');
  if (!HS_CODE.test(normalized)) {
    throw new Error('HS code must contain 4 to 12 digits.');
  }
  return normalized;
}

export function requireNonNegativeMoney(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) {
    throw new Error(`${field} must be a valid non-negative amount.`);
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function newSwimId(prefix: string): string {
  const cleanPrefix = requireSafeId(prefix, 'ID prefix').replace(/[:.]/g, '-');
  return `${cleanPrefix}-${crypto.randomUUID()}`;
}

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function requireWebhookSecret(secret: string | undefined, provider: string): string {
  if (!secret) {
    throw new Error(`Webhook secret is not configured for ${provider}.`);
  }
  return secret;
}

export function verifyHmacSha256(
  rawBody: Buffer,
  suppliedSignature: string,
  secret: string
): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const supplied = suppliedSignature.replace(/^sha256=/i, '').trim().toLowerCase();
  return timingSafeEqualString(expected, supplied);
}

export function verifyHmacSha256Base64(
  rawBody: Buffer,
  suppliedSignature: string,
  secret: string
): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return timingSafeEqualString(expected, String(suppliedSignature || '').trim());
}
