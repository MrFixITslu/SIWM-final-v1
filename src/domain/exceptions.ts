export type OperationalSeverity = 'CRITICAL' | 'WARNING' | 'INFO';
export type OperationalCategory = 'SHIPPING' | 'CUSTOMS' | 'INVENTORY' | 'PROCUREMENT' | 'CONFIGURATION';

export interface OperationalException {
  id: string;
  severity: OperationalSeverity;
  category: OperationalCategory;
  title: string;
  detail: string;
  entityType: 'shipment' | 'inventory_item' | 'purchase_order' | 'workspace';
  entityId: string;
  dueAt?: string;
  action?: string;
}

interface ShipmentInput {
  id: string;
  reference: string;
  status: string;
  latestTrackingStatus?: string;
  estimatedArrivalAt?: string;
  latestLocation?: string;
}

interface ForecastInput {
  itemId: string;
  sku: string;
  name: string;
  risk: string;
  stockoutInDays?: number;
  reorderByDate?: string;
  recommendedOrderQuantity?: number;
}

interface PurchaseOrderInput {
  id: string;
  poNumber: string;
  status: string;
  expectedDelivery?: string;
  supplierName?: string;
}

const severityRank: Record<OperationalSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

const daysBetween = (from: number, to: number) => Math.max(0, (to - from) / 86_400_000);

export function buildOperationalExceptions(input: {
  shipments: ShipmentInput[];
  forecasts: ForecastInput[];
  purchaseOrders: PurchaseOrderInput[];
  now?: Date;
}): OperationalException[] {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const exceptions: OperationalException[] = [];

  for (const shipment of input.shipments) {
    const exception = shipment.status === 'EXCEPTION' || shipment.latestTrackingStatus === 'EXCEPTION';
    if (exception) {
      exceptions.push({
        id: `shipment-exception:${shipment.id}`,
        severity: 'CRITICAL',
        category: 'SHIPPING',
        title: `${shipment.reference} has a carrier exception`,
        detail: shipment.latestLocation
          ? `Latest known location: ${shipment.latestLocation}.`
          : 'Carrier tracking requires review.',
        entityType: 'shipment',
        entityId: shipment.id,
        action: 'Review shipment',
      });
      continue;
    }

    if (shipment.estimatedArrivalAt && !['DELIVERED','RECEIVED','CANCELLED'].includes(shipment.status)) {
      const eta = Date.parse(shipment.estimatedArrivalAt);
      if (Number.isFinite(eta) && eta < nowMs) {
        const lateDays = daysBetween(eta, nowMs);
        exceptions.push({
          id: `shipment-overdue:${shipment.id}`,
          severity: lateDays >= 2 ? 'CRITICAL' : 'WARNING',
          category: shipment.status === 'CUSTOMS' || shipment.latestTrackingStatus === 'CUSTOMS' ? 'CUSTOMS' : 'SHIPPING',
          title: `${shipment.reference} is past its ETA`,
          detail: `Estimated arrival passed ${lateDays < 1 ? 'today' : `${lateDays.toFixed(1)} days ago`}.`,
          entityType: 'shipment',
          entityId: shipment.id,
          dueAt: shipment.estimatedArrivalAt,
          action: 'Review tracking',
        });
      }
    }
  }

  for (const forecast of input.forecasts) {
    if (forecast.risk === 'CRITICAL') {
      exceptions.push({
        id: `inventory-critical:${forecast.itemId}`,
        severity: 'CRITICAL',
        category: 'INVENTORY',
        title: `${forecast.name} may stock out before replenishment arrives`,
        detail: forecast.stockoutInDays == null
          ? `SKU ${forecast.sku} requires immediate replenishment review.`
          : `Projected stockout in ${forecast.stockoutInDays.toFixed(1)} days.${forecast.recommendedOrderQuantity ? ` Suggested order: ${forecast.recommendedOrderQuantity.toLocaleString()} units.` : ''}`,
        entityType: 'inventory_item',
        entityId: forecast.itemId,
        dueAt: forecast.reorderByDate,
        action: 'Review replenishment',
      });
    } else if (forecast.risk === 'AT_RISK') {
      exceptions.push({
        id: `inventory-risk:${forecast.itemId}`,
        severity: 'WARNING',
        category: 'INVENTORY',
        title: `${forecast.name} is inside its safety-stock window`,
        detail: `SKU ${forecast.sku} should be reviewed before the reorder window closes.`,
        entityType: 'inventory_item',
        entityId: forecast.itemId,
        dueAt: forecast.reorderByDate,
        action: 'Review replenishment',
      });
    } else if (forecast.risk === 'UNCONFIGURED') {
      exceptions.push({
        id: `inventory-unconfigured:${forecast.itemId}`,
        severity: 'INFO',
        category: 'CONFIGURATION',
        title: `${forecast.name} has no lead-time profile`,
        detail: `SWIM cannot calculate a reliable stockout date for SKU ${forecast.sku} until a replenishment profile is configured.`,
        entityType: 'inventory_item',
        entityId: forecast.itemId,
        action: 'Configure lead time',
      });
    }
  }

  const activePoStatuses = new Set(['ORDERED','IN_TRANSIT','PARTIALLY_RECEIVED']);
  for (const po of input.purchaseOrders) {
    if (!activePoStatuses.has(po.status) || !po.expectedDelivery) continue;
    const due = Date.parse(po.expectedDelivery);
    if (!Number.isFinite(due) || due >= nowMs) continue;
    const lateDays = daysBetween(due, nowMs);
    exceptions.push({
      id: `po-overdue:${po.id}`,
      severity: lateDays >= 3 ? 'CRITICAL' : 'WARNING',
      category: 'PROCUREMENT',
      title: `PO ${po.poNumber} is overdue`,
      detail: `${po.supplierName ? `${po.supplierName} · ` : ''}Expected ${lateDays.toFixed(1)} days ago.`,
      entityType: 'purchase_order',
      entityId: po.id,
      dueAt: po.expectedDelivery,
      action: 'Review purchase order',
    });
  }

  return exceptions.sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] ||
    Date.parse(a.dueAt || '9999-12-31') - Date.parse(b.dueAt || '9999-12-31') ||
    a.title.localeCompare(b.title)
  );
}
