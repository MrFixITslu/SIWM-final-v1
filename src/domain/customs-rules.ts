import crypto from 'crypto';

export function normalizeHsCodePrefix(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits || digits.length > 14) throw new Error('HS code prefix must contain 1 to 14 digits.');
  return digits;
}

export function validateOfficialSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Official customs rule sources must use HTTPS.');
  return url.toString();
}

export function validateCustomsRuleDates(input: {
  effectiveFrom: string;
  effectiveTo?: string;
  verifiedAt: string;
}, now = new Date()): void {
  const from = Date.parse(input.effectiveFrom);
  if (!Number.isFinite(from)) throw new Error('effectiveFrom is invalid.');
  if (input.effectiveTo) {
    const to = Date.parse(input.effectiveTo);
    if (!Number.isFinite(to) || to < from) throw new Error('effectiveTo must be on or after effectiveFrom.');
  }
  const verified = Date.parse(input.verifiedAt);
  if (!Number.isFinite(verified)) throw new Error('verifiedAt is invalid.');
  if (verified > now.getTime() + 24 * 60 * 60 * 1000) throw new Error('verifiedAt cannot be materially in the future.');
}

export function customsRuleId(input: {
  destinationCountry: string;
  hsCodePrefix: string;
  chargeCode: string;
  effectiveFrom: string;
  requiredConcessionCode?: string;
}): string {
  const canonical = [
    input.destinationCountry.trim().toUpperCase(),
    normalizeHsCodePrefix(input.hsCodePrefix),
    input.chargeCode.trim().toUpperCase(),
    input.effectiveFrom.slice(0, 10),
    (input.requiredConcessionCode || '').trim().toUpperCase(),
  ].join('|');
  return `cr-${crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 40)}`;
}
