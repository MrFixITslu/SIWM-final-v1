import {
  getItems,
  getPurchaseOrders,
  getSwimOutboundDemandSummary,
  listSwimReplenishmentPolicies,
} from '../server-db.js';
import { forecastReplenishment } from '../src/domain/replenishment.js';

export interface ReplenishmentForecastRow {
  itemId: string;
  sku: string;
  name: string;
  supplierId?: string | null;
  onHand: number;
  inboundConfirmed: number;
  policyConfigured: boolean;
  risk: 'UNCONFIGURED' | 'CRITICAL' | 'AT_RISK' | 'WATCH' | 'HEALTHY' | 'NO_DEMAND';
  policy?: { id: string; name: string; scopeKey: string; demandWindowDays: number };
  available?: number;
  averageDailyDemand?: number;
  totalLeadTimeDays?: number;
  safetyStockDays?: number;
  stockoutInDays?: number;
  projectedStockAtReceipt?: number;
  reorderPoint?: number;
  reorderByDate?: string;
  recommendedOrderQuantity?: number;
}

export interface ReplenishmentForecastResult {
  generatedAt: string;
  forecasts: ReplenishmentForecastRow[];
  notes: string[];
}

export async function buildReplenishmentForecast(
  warehouseId: string,
  now = new Date(),
): Promise<ReplenishmentForecastResult> {
  const [items, purchaseOrders, policies] = await Promise.all([
    getItems(warehouseId),
    getPurchaseOrders(warehouseId),
    listSwimReplenishmentPolicies(warehouseId),
  ]);

  const windows = [...new Set(policies.map((policy) => policy.demandWindowDays))];
  const demandByWindow = new Map<number, Record<string, number>>();
  await Promise.all(windows.map(async (windowDays) => {
    const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
    demandByWindow.set(windowDays, await getSwimOutboundDemandSummary(warehouseId, since));
  }));

  const defaultPolicy = policies.find((policy) => !policy.supplierId);
  const policyBySupplier = new Map(
    policies.filter((policy) => policy.supplierId).map((policy) => [policy.supplierId as string, policy]),
  );

  const inboundByItemId = new Map<string, number>();
  const inboundBySku = new Map<string, number>();
  const openStatuses = new Set(['ORDERED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED']);
  for (const po of purchaseOrders) {
    if (!openStatuses.has(po.status)) continue;
    for (const line of po.items || []) {
      const remaining = Math.max(0, Number(line.quantity || 0) - Number(line.quantityReceived || 0));
      if (!remaining) continue;
      if (line.itemId) inboundByItemId.set(line.itemId, (inboundByItemId.get(line.itemId) || 0) + remaining);
      if (line.sku) {
        const key = String(line.sku).trim().toUpperCase();
        inboundBySku.set(key, (inboundBySku.get(key) || 0) + remaining);
      }
    }
  }

  const riskOrder: Record<string, number> = {
    CRITICAL: 0,
    AT_RISK: 1,
    WATCH: 2,
    HEALTHY: 3,
    NO_DEMAND: 4,
    UNCONFIGURED: 5,
  };

  const forecasts: ReplenishmentForecastRow[] = items.map((item: any) => {
    const policy = (item.supplierId && policyBySupplier.get(item.supplierId)) || defaultPolicy;
    const inbound = inboundByItemId.get(item.id) || inboundBySku.get(String(item.sku || '').toUpperCase()) || 0;
    if (!policy) {
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        supplierId: item.supplierId || null,
        onHand: item.quantity,
        inboundConfirmed: inbound,
        policyConfigured: false,
        risk: 'UNCONFIGURED',
      };
    }

    const demandTotal = demandByWindow.get(policy.demandWindowDays)?.[item.id] || 0;
    const averageDailyDemand = demandTotal / policy.demandWindowDays;
    const forecast = forecastReplenishment({
      onHand: Number(item.quantity || 0),
      inboundConfirmed: inbound,
      averageDailyDemand,
      policy,
      asOf: now.toISOString(),
    });

    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      supplierId: item.supplierId || null,
      onHand: item.quantity,
      policyConfigured: true,
      policy: {
        id: policy.id,
        name: policy.name,
        scopeKey: policy.scopeKey,
        demandWindowDays: policy.demandWindowDays,
      },
      ...forecast,
    };
  }).sort((a, b) =>
    (riskOrder[a.risk] ?? 99) - (riskOrder[b.risk] ?? 99) ||
    (a.stockoutInDays ?? Number.POSITIVE_INFINITY) - (b.stockoutInDays ?? Number.POSITIVE_INFINITY)
  );

  return {
    generatedAt: now.toISOString(),
    forecasts,
    notes: [
      'Demand uses actual OUTBOUND stock movements within each configured policy window.',
      'Confirmed inbound includes remaining quantities on ORDERED, IN_TRANSIT and PARTIALLY_RECEIVED purchase orders.',
      'Customer-order allocations are not subtracted until SWIM order allocation is enabled.',
    ],
  };
}
