import { CustomsRule, LandedCostInput, LandedCostResult } from './domain.js';
import { normalizeHsCode, requireNonNegativeMoney } from './security.js';

const rate = (value: number | undefined) => Math.max(0, Number(value || 0));
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function findApplicableCustomsRule(
  rules: CustomsRule[],
  jurisdictionCode: string,
  hsCodeInput: string,
  at: Date = new Date()
): CustomsRule | undefined {
  const hsCode = normalizeHsCode(hsCodeInput);
  const jurisdiction = jurisdictionCode.trim().toUpperCase();
  const time = at.getTime();

  return rules
    .filter((rule) => rule.jurisdictionCode.toUpperCase() === jurisdiction)
    .filter((rule) => hsCode.startsWith(rule.hsCodePrefix))
    .filter((rule) => {
      const from = new Date(rule.effectiveFrom).getTime();
      const to = rule.effectiveTo ? new Date(rule.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return time >= from && time <= to;
    })
    .sort((a, b) => b.hsCodePrefix.length - a.hsCodePrefix.length)[0];
}

export function calculateLandedCost(
  input: LandedCostInput,
  rule: CustomsRule,
  confidence: LandedCostResult['confidence'] = 'HIGH'
): LandedCostResult {
  const goodsValue = requireNonNegativeMoney(input.goodsValue, 'Goods value');
  const freight = requireNonNegativeMoney(input.freight, 'Freight');
  const insurance = requireNonNegativeMoney(input.insurance, 'Insurance');
  const otherDutiable = requireNonNegativeMoney(input.otherDutiableCharges || 0, 'Other dutiable charges');
  const brokerage = requireNonNegativeMoney(input.brokerage || 0, 'Brokerage');
  const portFees = requireNonNegativeMoney(input.portFees || 0, 'Port fees');
  const localDelivery = requireNonNegativeMoney(input.localDelivery || 0, 'Local delivery');
  const concession = Math.min(100, Math.max(0, Number(input.concessionPercent || 0))) / 100;

  const customsValue = money(goodsValue + freight + insurance + otherDutiable);
  const importDuty = money(customsValue * rate(rule.importDutyRate) * (1 - concession));
  const customsServiceCharge = money(customsValue * rate(rule.customsServiceRate));
  const excise = money(customsValue * rate(rule.exciseRate));
  const environmentalLevy = money(customsValue * rate(rule.environmentalLevyRate));
  const otherTaxes = money(customsValue * rate(rule.otherRate));

  const vatBase = customsValue + importDuty + customsServiceCharge + excise + environmentalLevy + otherTaxes;
  const vat = money(vatBase * rate(rule.vatRate));
  const totalBorderCharges = money(
    importDuty + customsServiceCharge + excise + environmentalLevy + otherTaxes + vat
  );
  const totalLandedCost = money(
    customsValue + totalBorderCharges + brokerage + portFees + localDelivery
  );

  return {
    customsValue,
    importDuty,
    customsServiceCharge,
    excise,
    environmentalLevy,
    otherTaxes,
    vat,
    brokerage,
    portFees,
    localDelivery,
    totalBorderCharges,
    totalLandedCost,
    ruleId: rule.id,
    ruleVersion: rule.version,
    officialSourceUrl: rule.officialSourceUrl,
    confidence
  };
}
