import test from 'node:test';
import assert from 'node:assert/strict';
import { canConsolidateShipment, validateShipmentLegSequence } from '../src/domain/shipping.js';

test('shipment legs must form one continuous ordered journey', () => {
  const valid = validateShipmentLegSequence([
    { id:'1', sequence:1, mode:'GROUND', origin:'Supplier', destination:'Miami Forwarder' },
    { id:'2', sequence:2, mode:'OCEAN', origin:'Miami Forwarder', destination:'Port Castries' },
    { id:'3', sequence:3, mode:'GROUND', origin:'Port Castries', destination:'Warehouse' },
  ]);
  assert.deepEqual(valid, { valid:true });

  const broken = validateShipmentLegSequence([
    { id:'1', sequence:1, mode:'GROUND', origin:'Supplier', destination:'Miami Forwarder' },
    { id:'2', sequence:2, mode:'OCEAN', origin:'Port Miami', destination:'Port Castries' },
  ]);
  assert.equal(broken.valid, false);
});

test('consolidation prevents self links, duplicates and completed shipments', () => {
  const master = { id:'master', status:'IN_TRANSIT' as const };
  const child = { id:'child', status:'BOOKED' as const };
  assert.deepEqual(canConsolidateShipment(master, child), { allowed:true });
  assert.equal(canConsolidateShipment(master, { ...child, id:'master' }).allowed, false);
  assert.equal(canConsolidateShipment(master, { ...child, parentShipmentId:'other' }).allowed, false);
  assert.equal(canConsolidateShipment(master, { ...child, status:'DELIVERED' }).allowed, false);
});
