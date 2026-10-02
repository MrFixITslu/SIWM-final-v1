export type ReplenishmentRisk = 'NO_DEMAND' | 'HEALTHY' | 'WATCH' | 'AT_RISK' | 'CRITICAL';

export interface LeadTimePolicy {
  supplierProcessingDays: number;
  originTransportDays: number;
  forwarderHandlingDays: number;
  internationalTransitDays: number;
  customsClearanceDays: number;
  localDeliveryDays: number;
  safetyStockDays: number;
  targetCoverageDays: number;
}

export interface ReplenishmentInput {
  onHand: number;
  allocated?: number;
  inboundConfirmed?: number;
  averageDailyDemand: number;
  policy: LeadTimePolicy;
  asOf?: string;
}

export interface ReplenishmentForecast {
  available: number;
  inboundConfirmed: number;
  averageDailyDemand: number;
  totalLeadTimeDays: number;
  safetyStockDays: number;
  stockoutInDays?: number;
  projectedStockAtReceipt: number;
  reorderPoint: number;
  reorderByDate?: string;
  recommendedOrderQuantity: number;
  risk: ReplenishmentRisk;
}

function nonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number.`);
  return value;
}

function days(value: number, field: string): number {
  const checked = nonNegative(value, field);
  if (checked > 3650) throw new Error(`${field} is outside the supported range.`);
  return checked;
}

export function totalLeadTimeDays(policy: LeadTimePolicy): number {
  return [
    days(policy.supplierProcessingDays, 'supplierProcessingDays'),
    days(policy.originTransportDays, 'originTransportDays'),
    days(policy.forwarderHandlingDays, 'forwarderHandlingDays'),
    days(policy.internationalTransitDays, 'internationalTransitDays'),
    days(policy.customsClearanceDays, 'customsClearanceDays'),
    days(policy.localDeliveryDays, 'localDeliveryDays'),
  ].reduce((sum, value) => sum + value, 0);
}

export function forecastReplenishment(input: ReplenishmentInput): ReplenishmentForecast {
  const onHand = nonNegative(input.onHand, 'onHand');
  const allocated = nonNegative(input.allocated || 0, 'allocated');
  const inbound = nonNegative(input.inboundConfirmed || 0, 'inboundConfirmed');
  const dailyDemand = nonNegative(input.averageDailyDemand, 'averageDailyDemand');
  const available = Math.max(0, onHand - allocated);
  const leadTime = totalLeadTimeDays(input.policy);
  const safetyDays = days(input.policy.safetyStockDays, 'safetyStockDays');
  const coverageDays = days(input.policy.targetCoverageDays, 'targetCoverageDays');

  if (dailyDemand === 0) {
    return {
      available,
      inboundConfirmed: inbound,
      averageDailyDemand: 0,
      totalLeadTimeDays: leadTime,
      safetyStockDays: safetyDays,
      projectedStockAtReceipt: available + inbound,
      reorderPoint: 0,
      recommendedOrderQuantity: 0,
      risk: 'NO_DEMAND',
    };
  }

  const stockoutInDays = available / dailyDemand;
  const projectedStockAtReceipt = available + inbound - (dailyDemand * leadTime);
  const reorderPoint = Math.ceil(dailyDemand * (leadTime + safetyDays));
  const targetInventory = dailyDemand * (leadTime + safetyDays + coverageDays);
  const recommendedOrderQuantity = Math.max(0, Math.ceil(targetInventory - available - inbound));
  const reorderInDays = Math.max(0, stockoutInDays - leadTime - safetyDays);

  const asOf = input.asOf ? new Date(input.asOf) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error('asOf must be a valid ISO date/time.');
  const reorderBy = new Date(asOf.getTime() + Math.floor(reorderInDays) * 86_400_000);

  let risk: ReplenishmentRisk = 'HEALTHY';
  if (projectedStockAtReceipt < 0 || stockoutInDays <= leadTime) risk = 'CRITICAL';
  else if (stockoutInDays <= leadTime + safetyDays) risk = 'AT_RISK';
  else if (available + inbound <= reorderPoint * 1.25) risk = 'WATCH';

  return {
    available,
    inboundConfirmed: inbound,
    averageDailyDemand: dailyDemand,
    totalLeadTimeDays: leadTime,
    safetyStockDays: safetyDays,
    stockoutInDays,
    projectedStockAtReceipt,
    reorderPoint,
    reorderByDate: reorderBy.toISOString(),
    recommendedOrderQuantity,
    risk,
  };
}

export function averageDailyDemandFromMovements(
  movements: { quantity: number; occurredAt: string }[],
  windowDays: number,
  asOf = new Date(),
): number {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 3650) {
    throw new Error('windowDays must be an integer between 1 and 3650.');
  }
  const start = asOf.getTime() - windowDays * 86_400_000;
  const total = movements.reduce((sum, movement) => {
    const occurred = Date.parse(movement.occurredAt);
    if (!Number.isFinite(occurred) || occurred < start || occurred > asOf.getTime()) return sum;
    const quantity = nonNegative(movement.quantity, 'movement.quantity');
    return sum + quantity;
  }, 0);
  return total / windowDays;
}
