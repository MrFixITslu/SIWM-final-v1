import test from 'node:test';
import assert from 'node:assert/strict';
import { customsRuleId, normalizeHsCodePrefix, validateCustomsRuleDates, validateOfficialSourceUrl } from '../src/domain/customs-rules.js';

test('customs rule IDs are stable across HS formatting differences', () => {
  const base = { destinationCountry:'LC', chargeCode:'IMPORT_DUTY', effectiveFrom:'2026-01-01' };
  assert.equal(
    customsRuleId({ ...base, hsCodePrefix:'8471.30' }),
    customsRuleId({ ...base, hsCodePrefix:'847130' }),
  );
});

test('customs source URLs must be HTTPS', () => {
  assert.equal(validateOfficialSourceUrl('https://customs.example/rules').startsWith('https://'), true);
  assert.throws(() => validateOfficialSourceUrl('http://customs.example/rules'), /HTTPS/i);
});

test('customs rule date ranges cannot run backwards or claim future verification', () => {
  assert.throws(() => validateCustomsRuleDates({
    effectiveFrom:'2026-10-01',
    effectiveTo:'2026-09-01',
    verifiedAt:'2026-10-01T00:00:00Z',
  }, new Date('2026-10-01T12:00:00Z')), /effectiveTo/i);
  assert.throws(() => validateCustomsRuleDates({
    effectiveFrom:'2026-10-01',
    verifiedAt:'2026-10-10T00:00:00Z',
  }, new Date('2026-10-01T12:00:00Z')), /future/i);
});

test('HS code prefixes normalize to digits only', () => {
  assert.equal(normalizeHsCodePrefix('84.71.30'), '847130');
});
