import test from 'node:test';
import assert from 'node:assert/strict';
import { canContain, shipmentNeedsAttention } from '../src/domain/shipping.js';

test('logistics hierarchy prevents impossible containment', () => {
  assert.equal(canContain('CONTAINER', 'PALLET'), true);
  assert.equal(canContain('PALLET', 'CARTON'), true);
  assert.equal(canContain('ITEM', 'CARTON'), false);
});

test('overdue active shipments require attention', () => {
  assert.equal(shipmentNeedsAttention({ status:'IN_TRANSIT', estimatedArrivalAt:'2026-09-30T00:00:00Z' }, new Date('2026-10-01T00:00:00Z')), true);
  assert.equal(shipmentNeedsAttention({ status:'DELIVERED', estimatedArrivalAt:'2026-09-30T00:00:00Z' }, new Date('2026-10-01T00:00:00Z')), false);
});