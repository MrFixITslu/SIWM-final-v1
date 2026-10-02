import crypto from 'crypto';

export interface WebhookVerificationInput {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}

export interface VerifiedWebhook {
  timestampMs: number;
  bodyHash: string;
  signatureDigest: string;
}

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;

function requireStrongSecret(secret: string): void {
  if (Buffer.byteLength(secret || '', 'utf8') < 32) {
    throw new Error('Webhook signing secret must be at least 32 bytes.');
  }
}

function parseTimestamp(value: string | undefined): number {
  if (!value || !/^\d{10,13}$/.test(value.trim())) {
    throw new Error('Webhook timestamp is missing or invalid.');
  }
  const numeric = Number(value);
  const ms = value.length === 10 ? numeric * 1000 : numeric;
  if (!Number.isSafeInteger(ms)) throw new Error('Webhook timestamp is invalid.');
  return ms;
}

function parseSignature(value: string | undefined): Buffer {
  if (!value) throw new Error('Webhook signature is missing.');
  const trimmed = value.trim();
  const hex = trimmed.toLowerCase().startsWith('sha256=') ? trimmed.slice(7) : trimmed;
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error('Webhook signature format is invalid.');
  return Buffer.from(hex, 'hex');
}

export function signWebhookForTest(rawBody: Buffer | string, timestampMs: number, secret: string): string {
  requireStrongSecret(secret);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const timestampSeconds = Math.floor(timestampMs / 1000).toString();
  return crypto.createHmac('sha256', secret)
    .update(timestampSeconds)
    .update('.')
    .update(body)
    .digest('hex');
}

export function verifyHmacWebhook(input: WebhookVerificationInput): VerifiedWebhook {
  requireStrongSecret(input.secret);
  const rawBody = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody, 'utf8');
  const timestampMs = parseTimestamp(input.timestampHeader);
  const nowMs = input.nowMs ?? Date.now();
  const toleranceMs = input.toleranceMs ?? DEFAULT_TOLERANCE_MS;

  if (!Number.isSafeInteger(toleranceMs) || toleranceMs < 1 || toleranceMs > 15 * 60 * 1000) {
    throw new Error('Webhook timestamp tolerance is invalid.');
  }
  if (Math.abs(nowMs - timestampMs) > toleranceMs) {
    throw new Error('Webhook timestamp is outside the accepted replay window.');
  }

  const timestampSeconds = Math.floor(timestampMs / 1000).toString();
  const expected = crypto.createHmac('sha256', input.secret)
    .update(timestampSeconds)
    .update('.')
    .update(rawBody)
    .digest();

  const supplied = parseSignature(input.signatureHeader);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error('Webhook signature verification failed.');
  }

  return {
    timestampMs,
    bodyHash: crypto.createHash('sha256').update(rawBody).digest('hex'),
    signatureDigest: expected.toString('hex'),
  };
}

export function normalizeProviderKey(value: string): string {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(provider)) {
    throw new Error('Tracking provider key is invalid.');
  }
  return provider;
}

export function webhookReplayKey(params: {
  provider: string;
  providerEventId: string;
  bodyHash: string;
}): string {
  const provider = normalizeProviderKey(params.provider);
  const eventId = params.providerEventId.trim();
  if (!eventId || eventId.length > 180) throw new Error('Provider event ID is invalid.');
  if (!/^[a-f0-9]{64}$/i.test(params.bodyHash)) throw new Error('Webhook body hash is invalid.');

  return crypto.createHash('sha256')
    .update(provider)
    .update('\0')
    .update(eventId)
    .update('\0')
    .update(params.bodyHash.toLowerCase())
    .digest('hex');
}
