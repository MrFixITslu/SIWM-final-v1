export type CustomsChargeBasis = 'CUSTOMS_VALUE' | 'CUSTOMS_VALUE_PLUS_DUTY' | 'RUNNING_SUBTOTAL';

export interface CustomsRuleSource {
  authority: string;
  sourceUrl: string;
  verifiedAt: string;
}

export interface CustomsChargeRule {
  id: string;
  destinationCountry: string;
  hsCodePrefix: string;
  chargeCode: string;
  label: string;
  sequence: number;
  basis: CustomsChargeBasis;
  rateBps?: number;
  fixedAmountMinor?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  eligibleOrigins?: string[];
  excludedOrigins?: string[];
  requiredConcessionCode?: string;
  source: CustomsRuleSource;
}

export interface CustomsEstimateInput {
  destinationCountry: string;
  originCountry?: string;
  hsCode: string;
  currency: string;
  goodsValueMinor: number;
  freightMinor: number;
  insuranceMinor: number;
  brokerageMinor?: number;
  portFeesMinor?: number;
  localDeliveryMinor?: number;
  concessionCodes?: string[];
  valuationDate: string;
}

export interface CustomsChargeLine {
  ruleId: string;
  chargeCode: string;
  label: string;
  basisMinor: number;
  amountMinor: number;
  rateBps?: number;
  source: CustomsRuleSource;
}

export interface CustomsEstimate {
  currency: string;
  customsValueMinor: number;
  chargeLines: CustomsChargeLine[];
  customsChargesMinor: number;
  ancillaryCostsMinor: number;
  estimatedLandedCostMinor: number;
}

function safeMinor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer in minor currency units.`);
  return value;
}

function ruleApplies(rule: CustomsChargeRule, input: CustomsEstimateInput): boolean {
  const when = Date.parse(input.valuationDate);
  if (!Number.isFinite(when)) throw new Error('valuationDate must be a valid ISO date.');
  if (when < Date.parse(rule.effectiveFrom)) return false;
  if (rule.effectiveTo && when > Date.parse(rule.effectiveTo)) return false;
  if (!input.hsCode.replace(/\D/g, '').startsWith(rule.hsCodePrefix.replace(/\D/g, ''))) return false;
  if (rule.eligibleOrigins?.length && (!input.originCountry || !rule.eligibleOrigins.includes(input.originCountry))) return false;
  if (rule.excludedOrigins?.includes(input.originCountry || '')) return false;
  if (rule.requiredConcessionCode && !input.concessionCodes?.includes(rule.requiredConcessionCode)) return false;
  return true;
}

export function calculateCustomsEstimate(input: CustomsEstimateInput, rules: CustomsChargeRule[]): CustomsEstimate {
  const goods = safeMinor(input.goodsValueMinor, 'goodsValueMinor');
  const freight = safeMinor(input.freightMinor, 'freightMinor');
  const insurance = safeMinor(input.insuranceMinor, 'insuranceMinor');
  const customsValue = goods + freight + insurance;
  let runningCharges = 0;
  let importDuty = 0;
  const lines: CustomsChargeLine[] = [];

  const applicable = rules.filter((rule) => rule.destinationCountry === input.destinationCountry && ruleApplies(rule, input))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

  for (const rule of applicable) {
    let basis = customsValue;
    if (rule.basis === 'CUSTOMS_VALUE_PLUS_DUTY') basis = customsValue + importDuty;
    if (rule.basis === 'RUNNING_SUBTOTAL') basis = customsValue + runningCharges;
    const percentage = rule.rateBps ? Math.round((basis * rule.rateBps) / 10_000) : 0;
    const fixed = safeMinor(rule.fixedAmountMinor || 0, 'fixedAmountMinor');
    const amount = percentage + fixed;
    runningCharges += amount;
    if (rule.chargeCode === 'IMPORT_DUTY') importDuty += amount;
    lines.push({ ruleId: rule.id, chargeCode: rule.chargeCode, label: rule.label, basisMinor: basis, amountMinor: amount, rateBps: rule.rateBps, source: rule.source });
  }

  const ancillary = safeMinor(input.brokerageMinor || 0, 'brokerageMinor') + safeMinor(input.portFeesMinor || 0, 'portFeesMinor') + safeMinor(input.localDeliveryMinor || 0, 'localDeliveryMinor');
  return {
    currency: input.currency.toUpperCase(),
    customsValueMinor: customsValue,
    chargeLines: lines,
    customsChargesMinor: runningCharges,
    ancillaryCostsMinor: ancillary,
    estimatedLandedCostMinor: customsValue + runningCharges + ancillary,
  };
}