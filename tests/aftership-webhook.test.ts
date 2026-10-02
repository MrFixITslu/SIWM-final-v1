import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signAfterShipWebhookForTest,
  verifyAndParseAfterShipWebhook,
} from '../server/tracking-providers/aftership-webhook.js';

const secret = '0123456789abcdef0123456789abcdef';
const now = Date.UTC(2026, 9, 1, 12, 0, 0);

const body = JSON.stringify({
  ts: Math.floor(now / 1000),
  event: 'tracking_update',
  event_id: 'fb7a20b8-78ba-4b83-81e9-56b75af57ea2',
  msg: {
    id: 'tracker_123',
    checkpoints: [{
      hash: 'cp-1',
      tag: 'OutForDelivery',
      message: 'Out for delivery',
      checkpoint_time: '2026-10-01T10:00:00-04:00',
      city: 'Castries',
      country_region: 'Saint Lucia',
    }],
  },
});

test('AfterShip native webhook signature and envelope verify', () => {
  const signature = signAfterShipWebhookForTest(body, secret);
  const result = verifyAndParseAfterShipWebhook(
    Buffer.from(body),
    signature,
    { secret, nowMs: now },
  );
  assert.equal(result.externalTrackerId, 'tracker_123');
  assert.equal(result.eventId, 'fb7a20b8-78ba-4b83-81e9-56b75af57ea2');
  assert.equal(result.checkpoints[0].status, 'OUT_FOR_DELIVERY');
});

test('AfterShip webhook rejects tampering', () => {
  const signature = signAfterShipWebhookForTest(body, secret);
  assert.throws(() => verifyAndParseAfterShipWebhook(
    Buffer.from(body.replace('Castries', 'Tampered')),
    signature,
    { secret, nowMs: now },
  ), /signature verification/i);
});

test('AfterShip webhook rejects stale replay envelopes', () => {
  const oldBody = JSON.stringify({
    ...JSON.parse(body),
    ts: Math.floor((now - 8 * 24 * 60 * 60 * 1000) / 1000),
  });
  const signature = signAfterShipWebhookForTest(oldBody, secret);
  assert.throws(() => verifyAndParseAfterShipWebhook(
    Buffer.from(oldBody),
    signature,
    { secret, nowMs: now },
  ), /replay window/i);
});
