import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackingGatewayEnvelope } from '../src/domain/tracking-gateway.js';

const valid = {
  eventId: 'carrier-event-1',
  warehouseId: 'wh-123',
  shipmentId: 'ship-123',
  trackingNumber: '1Z999AA10123456784',
  status: 'IN_TRANSIT',
  description: 'Departed carrier facility',
  location: 'Miami, FL',
  occurredAt: '2026-10-01T12:00:00Z',
  estimatedDeliveryAt: '2026-10-05T18:00:00Z',
};

test('tracking gateway accepts only a strict normalized carrier envelope', () => {
  assert.deepEqual(parseTrackingGatewayEnvelope(valid), valid);
  assert.throws(() => parseTrackingGatewayEnvelope({ ...valid, unexpected: true }), /invalid/i);
});

test('tracking gateway rejects missing tenant and shipment binding', () => {
  const { warehouseId, ...withoutWarehouse } = valid;
  assert.throws(() => parseTrackingGatewayEnvelope(withoutWarehouse), /invalid/i);
  const { shipmentId, ...withoutShipment } = valid;
  assert.throws(() => parseTrackingGatewayEnvelope(withoutShipment), /invalid/i);
});

test('tracking gateway rejects oversized or malformed operational fields', () => {
  assert.throws(() => parseTrackingGatewayEnvelope({ ...valid, description: 'x'.repeat(1001) }), /invalid/i);
  assert.throws(() => parseTrackingGatewayEnvelope({ ...valid, occurredAt: 'yesterday' }), /invalid/i);
});
