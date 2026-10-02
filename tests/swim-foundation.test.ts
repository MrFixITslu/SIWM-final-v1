import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  normalizeTrackingNumber,
  newWarehouseJoinCode,
  validatePasswordPolicy,
  verifyHmacSha256Base64
} from '../swim/security.js';
import {
  mapTrackingStatusToShipmentStatus,
  normalizeProviderStatus
} from '../swim/tracking.js';
import {
  calculateLandedCost,
  findApplicableCustomsRule
} from '../swim/customs.js';
import { createAfterShipAdapter } from '../swim/providers/aftership.js';
import type { CustomsRule } from '../swim/domain.js';

test('tracking numbers normalize and reject unsafe input', () => {
  assert.equal(normalizeTrackingNumber(' 1z-abc-123 '), '1Z-ABC-123');
  assert.throws(() => normalizeTrackingNumber('../bad<script>'));
});

test('carrier statuses normalize into SWIM lifecycle states', () => {
  assert.equal(normalizeProviderStatus('Out for Delivery'), 'OUT_FOR_DELIVERY');
  assert.equal(normalizeProviderStatus('Customs clearance'), 'CUSTOMS');
  assert.equal(normalizeProviderStatus('Delivery exception'), 'EXCEPTION');
  assert.equal(mapTrackingStatusToShipmentStatus('CUSTOMS'), 'CUSTOMS_PROCESSING');
  assert.equal(mapTrackingStatusToShipmentStatus('DELIVERED'), 'DELIVERED');
});

test('warehouse join codes are non-predictable format and password policy is passphrase friendly', () => {
  assert.match(newWarehouseJoinCode(), /^WH-[0-9A-Z]{8}$/);
  assert.equal(validatePasswordPolicy('short'), 'Password must be at least 12 characters long.');
  assert.equal(validatePasswordPolicy('a secure passphrase 2026'), undefined);
});

test('webhook HMAC verification uses AfterShip-compatible base64 SHA-256', () => {
  const raw = Buffer.from('{"event":"tracking_update"}');
  const secret = 'test-webhook-secret';
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  assert.equal(verifyHmacSha256Base64(raw, signature, secret), true);
  assert.equal(verifyHmacSha256Base64(raw, signature + 'x', secret), false);
});

test('customs engine selects most specific effective HS rule', () => {
  const rules: CustomsRule[] = [
    {
      id: 'generic',
      jurisdictionCode: 'LC',
      hsCodePrefix: '84',
      importDutyRate: 0.10,
      vatRate: 0.125,
      effectiveFrom: '2026-01-01T00:00:00Z',
      officialSourceUrl: 'https://example.test/generic',
      sourceTitle: 'Test tariff',
      verifiedAt: '2026-09-01T00:00:00Z',
      version: '2026.1'
    },
    {
      id: 'specific',
      jurisdictionCode: 'LC',
      hsCodePrefix: '8471',
      importDutyRate: 0,
      vatRate: 0.125,
      customsServiceRate: 0.05,
      effectiveFrom: '2026-01-01T00:00:00Z',
      officialSourceUrl: 'https://example.test/specific',
      sourceTitle: 'Test tariff',
      verifiedAt: '2026-09-01T00:00:00Z',
      version: '2026.1'
    }
  ];
  const found = findApplicableCustomsRule(
    rules,
    'LC',
    '847130',
    new Date('2026-10-01T00:00:00Z')
  );
  assert.equal(found?.id, 'specific');
});

test('landed cost calculation keeps charge components visible', () => {
  const rule: CustomsRule = {
    id: 'lc-8471',
    jurisdictionCode: 'LC',
    hsCodePrefix: '8471',
    importDutyRate: 0.10,
    customsServiceRate: 0.05,
    vatRate: 0.125,
    effectiveFrom: '2026-01-01T00:00:00Z',
    officialSourceUrl: 'https://example.test',
    sourceTitle: 'Test tariff',
    verifiedAt: '2026-09-01T00:00:00Z',
    version: '2026.1'
  };
  const result = calculateLandedCost({
    jurisdictionCode: 'LC',
    hsCode: '847130',
    goodsValue: 1000,
    freight: 100,
    insurance: 20,
    brokerage: 40,
    portFees: 25,
    localDelivery: 15
  }, rule);
  assert.equal(result.customsValue, 1120);
  assert.equal(result.importDuty, 112);
  assert.equal(result.customsServiceCharge, 56);
  assert.equal(result.vat, 161);
  assert.equal(result.totalLandedCost, 1529);
  assert.equal(result.officialSourceUrl, 'https://example.test');
});

test('AfterShip webhook parser produces provider-neutral tracking snapshot without network calls', async () => {
  const adapter = createAfterShipAdapter('test-key');
  const parsed = await adapter.parseWebhook?.({
    event_id: 'evt-123',
    msg: {
      id: 'tracking-id-1',
      tracking_number: '123456789',
      slug: 'fedex',
      tag: 'InTransit',
      checkpoints: [{
        id: 'cp-1',
        checkpoint_time: '2026-10-01T12:00:00Z',
        message: 'Departed facility',
        tag: 'InTransit',
        location: 'Miami, FL',
        country_iso2: 'US'
      }]
    }
  }, {});
  assert.equal(parsed?.[0].providerTrackingId, 'tracking-id-1');
  assert.equal(parsed?.[0].snapshot.carrierCode, 'FEDEX');
  assert.equal(parsed?.[0].snapshot.status, 'IN_TRANSIT');
  assert.equal(parsed?.[0].snapshot.checkpoints[0].location, 'Miami, FL');
});
