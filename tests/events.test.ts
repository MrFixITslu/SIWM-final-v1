import test from 'node:test';
import assert from 'node:assert/strict';
import { sealEvent, verifyEventChain } from '../src/domain/events.js';

const secret = '0123456789abcdef0123456789abcdef';

test('event ledger detects tampering and broken chains', () => {
  const first = sealEvent(secret, {
    eventId: 'evt-1', warehouseId: 'wh-1', eventType: 'TRACKING_NUMBER_ADDED',
    aggregateType: 'shipment', aggregateId: 'ship-1', actorId: 'usr-1',
    occurredAt: '2026-10-01T12:00:00.000Z', payload: { trackingNumber: '123' }, previousHash: null,
  });
  const second = sealEvent(secret, {
    eventId: 'evt-2', warehouseId: 'wh-1', eventType: 'SHIPMENT_CHECKPOINT_RECORDED',
    aggregateType: 'shipment', aggregateId: 'ship-1', actorId: 'usr-1',
    occurredAt: '2026-10-01T13:00:00.000Z', payload: { status: 'IN_TRANSIT' }, previousHash: first.eventHash,
  });
  assert.deepEqual(verifyEventChain(secret, [first, second]), { valid: true });
  const tampered = { ...second, payload: { status: 'DELIVERED' } };
  assert.equal(verifyEventChain(secret, [first, tampered]).valid, false);
});