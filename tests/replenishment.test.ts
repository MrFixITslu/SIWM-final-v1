import test from 'node:test';
import assert from 'node:assert/strict';
import { averageDailyDemandFromMovements, forecastReplenishment } from '../src/domain/replenishment.js';

const policy = {
  supplierProcessingDays: 3,
  originTransportDays: 4,
  forwarderHandlingDays: 3,
  internationalTransitDays: 8,
  customsClearanceDays: 3,
  localDeliveryDays: 1,
  safetyStockDays: 5,
  targetCoverageDays: 30,
};

test('Caribbean lead-time forecast flags stock that will run out before replenishment arrives', () => {
  const result = forecastReplenishment({
    onHand: 31,
    averageDailyDemand: 2.4,
    inboundConfirmed: 0,
    policy,
    asOf: '2026-10-01T00:00:00Z',
  });
  assert.equal(result.totalLeadTimeDays, 22);
  assert.equal(result.risk, 'CRITICAL');
  assert.ok((result.stockoutInDays || 0) < result.totalLeadTimeDays);
  assert.ok(result.recommendedOrderQuantity > 0);
});

test('confirmed inbound inventory reduces recommended order quantity', () => {
  const withoutInbound = forecastReplenishment({ onHand: 100, averageDailyDemand: 2, policy, inboundConfirmed: 0 });
  const withInbound = forecastReplenishment({ onHand: 100, averageDailyDemand: 2, policy, inboundConfirmed: 50 });
  assert.ok(withInbound.recommendedOrderQuantity < withoutInbound.recommendedOrderQuantity);
});

test('zero demand does not invent a reorder requirement', () => {
  const result = forecastReplenishment({ onHand: 25, averageDailyDemand: 0, policy, inboundConfirmed: 0 });
  assert.equal(result.risk, 'NO_DEMAND');
  assert.equal(result.recommendedOrderQuantity, 0);
  assert.equal(result.stockoutInDays, undefined);
});

test('demand history uses only movements inside the selected window', () => {
  const demand = averageDailyDemandFromMovements([
    { quantity: 10, occurredAt: '2026-09-25T00:00:00Z' },
    { quantity: 20, occurredAt: '2026-09-30T00:00:00Z' },
    { quantity: 999, occurredAt: '2026-01-01T00:00:00Z' },
  ], 10, new Date('2026-10-01T00:00:00Z'));
  assert.equal(demand, 3);
});
