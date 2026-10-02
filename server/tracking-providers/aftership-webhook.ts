import crypto from 'crypto';
import { z } from 'zod';
import { mapAfterShipCheckpoints } from './aftership.js';

const afterShipWebhookSchema = z.object({
  ts: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{10,13}$/)]),
  event: z.string().trim().min(1).max(80),
  event_id: z.string().trim().min(1).max(180),
  msg: z.record(z.string(), z.unknown()),
}).passthrough();

export interface VerifiedAfterShipWebhook {
  eventId: string;
  event: string;
  eventTimestampMs: number;
  externalTrackerId: string;
  bodyHash: string;
  checkpoints: ReturnType<typeof mapAfterShipCheckpoints>;
}

function requireWebhookSecret(): string {
  const secret = process.env.AFTERSHIP_WEBHOOK_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AfterShip webhook secret is not securely configured.');
  }
  return secret;
}

function parseBase64Signature(value: string | undefined): Buffer {
  if (!value) throw new Error('AfterShip webhook signature is missing.');
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) throw new Error('AfterShip webhook signature is invalid.');
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32) throw new Error('AfterShip webhook signature is invalid.');
  return decoded;
}

function normalizeTimestamp(value: number | string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new Error('AfterShip webhook timestamp is invalid.');
  return String(Math.trunc(numeric)).length <= 10 ? numeric * 1000 : numeric;
}

export function verifyAndParseAfterShipWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  options: { secret?: string; nowMs?: number; maxAgeMs?: number } = {},
): VerifiedAfterShipWebhook {
  const secret = options.secret || requireWebhookSecret();
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('AfterShip webhook secret must be at least 32 bytes.');

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const supplied = parseBase64Signature(signatureHeader);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error('AfterShip webhook signature verification failed.');
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('AfterShip webhook body is invalid JSON.');
  }

  const parsed = afterShipWebhookSchema.safeParse(json);
  if (!parsed.success) throw new Error('AfterShip webhook body does not match the expected envelope.');

  const eventTimestampMs = normalizeTimestamp(parsed.data.ts);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  if (eventTimestampMs > nowMs + 5 * 60 * 1000) throw new Error('AfterShip webhook timestamp is in the future.');
  if (eventTimestampMs < nowMs - maxAgeMs) throw new Error('AfterShip webhook is outside the accepted replay window.');

  const msg: any = parsed.data.msg;
  const externalTrackerId = typeof msg.id === 'string' ? msg.id.trim() : '';
  if (!/^[0-9A-Za-z_-]{1,128}$/.test(externalTrackerId)) {
    throw new Error('AfterShip webhook does not contain a valid tracking ID.');
  }

  const trackingShape = Array.isArray(msg.checkpoints)
    ? msg
    : msg.checkpoint && typeof msg.checkpoint === 'object'
      ? { ...msg, checkpoints: [msg.checkpoint] }
      : msg;

  return {
    eventId: parsed.data.event_id,
    event: parsed.data.event,
    eventTimestampMs,
    externalTrackerId,
    bodyHash: crypto.createHash('sha256').update(rawBody).digest('hex'),
    checkpoints: mapAfterShipCheckpoints(trackingShape),
  };
}

export function signAfterShipWebhookForTest(rawBody: Buffer | string, secret: string): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}
