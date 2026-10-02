import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProviderKey,
  signWebhookForTest,
  verifyHmacWebhook,
  webhookReplayKey,
} from '../src/domain/webhooks.js';

const secret = '0123456789abcdef0123456789abcdef';
const now = Date.UTC(2026, 9, 1, 12, 0, 0);
const body = JSON.stringify({ event: 'tracking.updated', id: 'evt-123' });

test('webhook verifier accepts an authentic fresh payload', () => {
  const signature = signWebhookForTest(body, now, secret);
  const verified = verifyHmacWebhook({
    rawBody: body,
    signatureHeader: `sha256=${signature}`,
    timestampHeader: String(Math.floor(now / 1000)),
    secret,
    nowMs: now,
  });
  assert.match(verified.bodyHash, /^[a-f0-9]{64}$/);
});

test('webhook verifier rejects tampered payloads', () => {
  const signature = signWebhookForTest(body, now, secret);
  assert.throws(() => verifyHmacWebhook({
    rawBody: body + 'tampered',
    signatureHeader: signature,
    timestampHeader: String(Math.floor(now / 1000)),
    secret,
    nowMs: now,
  }), /signature verification failed/i);
});

test('webhook verifier rejects stale or future replay timestamps', () => {
  const old = now - (6 * 60 * 1000);
  const signature = signWebhookForTest(body, old, secret);
  assert.throws(() => verifyHmacWebhook({
    rawBody: body,
    signatureHeader: signature,
    timestampHeader: String(Math.floor(old / 1000)),
    secret,
    nowMs: now,
  }), /replay window/i);
});

test('provider keys are normalized and constrained', () => {
  assert.equal(normalizeProviderKey(' AfterShip '), 'aftership');
  assert.throws(() => normalizeProviderKey('../fedex'), /invalid/i);
});

test('replay keys are deterministic and payload-sensitive', () => {
  const a = webhookReplayKey({ provider: 'fedex', providerEventId: 'evt-1', bodyHash: 'a'.repeat(64) });
  const b = webhookReplayKey({ provider: 'fedex', providerEventId: 'evt-1', bodyHash: 'a'.repeat(64) });
  const c = webhookReplayKey({ provider: 'fedex', providerEventId: 'evt-1', bodyHash: 'b'.repeat(64) });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
