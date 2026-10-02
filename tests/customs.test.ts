import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCustomsEstimate, type CustomsChargeRule } from '../src/domain/customs.js';

const source = { authority: 'Test Customs Authority', sourceUrl: 'https://example.gov/rules', verifiedAt: '2026-10-01T00:00:00Z' };
const rules: CustomsChargeRule[] = [
  { id:'duty', destinationCountry:'LC', hsCodePrefix:'8471', chargeCode:'IMPORT_DUTY', label:'Import Duty', sequence:10, basis:'CUSTOMS_VALUE', rateBps:1000, effectiveFrom:'2026-01-01', source },
  { id:'vat', destinationCountry:'LC', hsCodePrefix:'8471', chargeCode:'VAT', label:'VAT', sequence:20, basis:'CUSTOMS_VALUE_PLUS_DUTY', rateBps:1250, effectiveFrom:'2026-01-01', source },
];

test('landed cost engine uses deterministic minor-unit arithmetic', () => {
  const result = calculateCustomsEstimate({
    destinationCountry:'LC', originCountry:'US', hsCode:'8471.30', currency:'XCD',
    goodsValueMinor:100000, freightMinor:10000, insuranceMinor:1000,
    brokerageMinor:5000, portFeesMinor:2500, valuationDate:'2026-10-01',
  }, rules);
  assert.equal(result.customsValueMinor, 111000);
  assert.equal(result.chargeLines[0].amountMinor, 11100);
  assert.equal(result.chargeLines[1].basisMinor, 122100);
  assert.equal(result.chargeLines[1].amountMinor, 15263);
  assert.equal(result.estimatedLandedCostMinor, 144863);
});

test('rules outside their effective period are ignored', () => {
  const result = calculateCustomsEstimate({ destinationCountry:'LC', hsCode:'8471', currency:'XCD', goodsValueMinor:10000, freightMinor:0, insuranceMinor:0, valuationDate:'2025-01-01' }, rules);
  assert.equal(result.customsChargesMinor, 0);
});