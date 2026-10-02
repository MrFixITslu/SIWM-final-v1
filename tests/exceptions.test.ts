import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationalExceptions } from '../src/domain/exceptions.js';

const now = new Date('2026-10-10T12:00:00Z');

test('operations inbox prioritizes carrier exceptions and overdue shipments', () => {
  const result = buildOperationalExceptions({
    shipments: [
      { id:'a', reference:'SW-100', status:'EXCEPTION', latestTrackingStatus:'EXCEPTION' },
      { id:'b', reference:'SW-101', status:'IN_TRANSIT', estimatedArrivalAt:'2026-10-07T12:00:00Z' },
    ],
    forecasts: [],
    purchaseOrders: [],
    now,
  });
  assert.equal(result[0].severity, 'CRITICAL');
  assert.equal(result.length, 2);
});

test('critical stockout risk becomes an actionable inventory exception', () => {
  const [item] = buildOperationalExceptions({
    shipments: [],
    forecasts: [{ itemId:'i1', sku:'ONT-01', name:'ONT Model 1', risk:'CRITICAL', stockoutInDays:6, recommendedOrderQuantity:120 }],
    purchaseOrders: [],
    now,
  });
  assert.equal(item.category, 'INVENTORY');
  assert.match(item.detail, /120/);
});

test('overdue purchase orders are escalated based on lateness', () => {
  const [po] = buildOperationalExceptions({
    shipments: [],
    forecasts: [],
    purchaseOrders: [{ id:'po1', poNumber:'PO-001', status:'ORDERED', expectedDelivery:'2026-10-01T12:00:00Z' }],
    now,
  });
  assert.equal(po.severity, 'CRITICAL');
  assert.equal(po.category, 'PROCUREMENT');
});

test('completed shipments and received purchase orders do not create false exceptions', () => {
  const result = buildOperationalExceptions({
    shipments: [{ id:'a', reference:'SW-100', status:'DELIVERED', estimatedArrivalAt:'2026-10-01T12:00:00Z' }],
    forecasts: [],
    purchaseOrders: [{ id:'po1', poNumber:'PO-001', status:'RECEIVED', expectedDelivery:'2026-10-01T12:00:00Z' }],
    now,
  });
  assert.equal(result.length, 0);
});
