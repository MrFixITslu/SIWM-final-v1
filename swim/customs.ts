import { CustomsRule, LandedCostInput, LandedCostResult } from './domain.js';
import { normalizeHsCode, requireNonNegativeMoney } from './security.js';

const rate = (value: number | undefined) => Math.max(0, Number(value || 0));
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

type ChargeValues = {
  CUSTOMS_VALUE: number;
  IMPORT_DUTY: number;
  CUSTOMS_SERVICE_CHARGE: number;
  EXCISE: number;
  ENVIRONMENTAL_LEVY: number;
  OTHER_TAXES: number;
};

function baseAmount(
  components: Array<keyof ChargeValues> | undefined,
  values: ChargeValues,
  fallback: Array<keyof ChargeValues>
): number {
  const selected = components?.length ? components : fallback;
  return money(selected.reduce((sum, key) => sum + Number(values[key] || 0), 0));
}

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
  const values: ChargeValues = {
    CUSTOMS_VALUE: customsValue,
    IMPORT_DUTY: 0,
    CUSTOMS_SERVICE_CHARGE: 0,
    EXCISE: 0,
    ENVIRONMENTAL_LEVY: 0,
    OTHER_TAXES: 0
  };
  const policy = rule.calculationPolicy || {};

  values.IMPORT_DUTY = money(
    baseAmount(policy.importDutyBase, values, ['CUSTOMS_VALUE']) *
    rate(rule.importDutyRate) *
    (1 - concession)
  );
  values.CUSTOMS_SERVICE_CHARGE = money(
    baseAmount(policy.customsServiceBase, values, ['CUSTOMS_VALUE']) *
    rate(rule.customsServiceRate)
  );
  values.EXCISE = money(
    baseAmount(policy.exciseBase, values, ['CUSTOMS_VALUE']) *
    rate(rule.exciseRate)
  );
  values.ENVIRONMENTAL_LEVY = money(
    baseAmount(policy.environmentalLevyBase, values, ['CUSTOMS_VALUE']) *
    rate(rule.environmentalLevyRate)
  );
  values.OTHER_TAXES = money(
    baseAmount(policy.otherTaxBase, values, ['CUSTOMS_VALUE']) *
    rate(rule.otherRate)
  );

  const vatBase = baseAmount(
    policy.vatBase,
    values,
    [
      'CUSTOMS_VALUE',
      'IMPORT_DUTY',
      'CUSTOMS_SERVICE_CHARGE',
      'EXCISE',
      'ENVIRONMENTAL_LEVY',
      'OTHER_TAXES'
    ]
  );
  const vat = money(vatBase * rate(rule.vatRate));
  const totalBorderCharges = money(
    values.IMPORT_DUTY +
    values.CUSTOMS_SERVICE_CHARGE +
    values.EXCISE +
    values.ENVIRONMENTAL_LEVY +
    values.OTHER_TAXES +
    vat
  );
  const totalLandedCost = money(
    customsValue + totalBorderCharges + brokerage + portFees + localDelivery
  );

  return {
    customsValue,
    importDuty: values.IMPORT_DUTY,
    customsServiceCharge: values.CUSTOMS_SERVICE_CHARGE,
    excise: values.EXCISE,
    environmentalLevy: values.ENVIRONMENTAL_LEVY,
    otherTaxes: values.OTHER_TAXES,
    vat,
    brokerage,
    portFees,
    localDelivery,
    totalBorderCharges,
    totalLandedCost,
    ruleId: rule.id,
    ruleVersion: rule.version,
    officialSourceUrl: rule.officialSourceUrl,
    confidence: rule.calculationPolicy ? confidence : 'REVIEW_REQUIRED'
  };
}
