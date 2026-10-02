import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCarrier, normalizeCarrierStatus, summarizeTracking } from '../src/domain/tracking.js';

test('carrier detection is confidence-aware instead of pretending certainty', () => {
  assert.equal(detectCarrier('1Z999AA10123456784')[0].carrier, 'UPS');
  assert.equal(detectCarrier('1Z999AA10123456784')[0].confidence, 'HIGH');
  assert.equal(detectCarrier('ABC-NOT-KNOWN')[0].carrier, 'UNKNOWN');
});

test('provider statuses normalize into SWIM tracking states', () => {
  assert.equal(normalizeCarrierStatus('clearance event', 'Customs processing'), 'CUSTOMS');
  assert.equal(normalizeCarrierStatus('delay', 'Weather exception'), 'EXCEPTION');
  assert.equal(normalizeCarrierStatus('delivered'), 'DELIVERED');
});

test('tracking summary exposes the latest state and ETA at a glance', () => {
  const summary = summarizeTracking([
    { status: 'PICKED_UP', description: 'Picked up', occurredAt: '2026-10-01T10:00:00Z', source: 'test' },
    { status: 'IN_TRANSIT', description: 'Departed Miami', location: 'Miami, FL', occurredAt: '2026-10-02T10:00:00Z', estimatedDeliveryAt: '2026-10-07T18:00:00Z', source: 'test' },
  ]);
  assert.equal(summary.status, 'IN_TRANSIT');
  assert.equal(summary.latestLocation, 'Miami, FL');
  assert.equal(summary.estimatedDeliveryAt, '2026-10-07T18:00:00Z');
});