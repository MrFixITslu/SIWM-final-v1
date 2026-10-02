import test from 'node:test';
import assert from 'node:assert/strict';
import { mapAfterShipCheckpoints } from '../server/tracking-providers/aftership.js';

test('AfterShip checkpoints normalize into SWIM tracking events', () => {
  const [checkpoint] = mapAfterShipCheckpoints({
    estimated_delivery: '2026-10-08T18:00:00Z',
    checkpoints: [{
      hash: 'checkpoint-hash-1',
      tag: 'InTransit',
      subtag: 'InTransit_002',
      message: 'Departed FedEx location',
      checkpoint_time: '2026-10-03T10:15:00-04:00',
      city: 'Miami',
      state: 'FL',
      country_region: 'USA',
    }],
  });

  assert.equal(checkpoint.carrierEventId, 'checkpoint-hash-1');
  assert.equal(checkpoint.status, 'IN_TRANSIT');
  assert.match(checkpoint.location || '', /Miami/);
  assert.equal(checkpoint.estimatedDeliveryAt, '2026-10-08T18:00:00.000Z');
  assert.equal(checkpoint.source, 'provider:aftership');
});

test('AfterShip mapper ignores checkpoints without a usable event timestamp', () => {
  const result = mapAfterShipCheckpoints({ checkpoints: [{ tag:'InTransit', message:'Moving' }] });
  assert.equal(result.length, 0);
});

test('AfterShip mapper only returns normalized SWIM fields', () => {
  const [checkpoint] = mapAfterShipCheckpoints({
    private_provider_field: 'must-not-leak',
    checkpoints: [{
      hash: 'hash',
      tag: 'Delivered',
      message: 'Delivered',
      checkpoint_time: '2026-10-03T10:15:00Z',
      private_payload: { customer:'sensitive' },
    }],
  });

  assert.deepEqual(Object.keys(checkpoint).sort(), [
    'carrierEventId',
    'description',
    'estimatedDeliveryAt',
    'location',
    'occurredAt',
    'source',
    'status',
  ].sort());
});
