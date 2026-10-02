import crypto from 'crypto';

export type SwimEventType =
  | 'PURCHASE_ORDER_CREATED'
  | 'SUPPLIER_DISPATCHED'
  | 'TRACKING_NUMBER_ADDED'
  | 'SHIPMENT_CHECKPOINT_RECORDED'
  | 'SHIPMENT_DELAYED'
  | 'PACKAGE_ARRIVED_FORWARDER'
  | 'SHIPMENT_CONSOLIDATED'
  | 'PORT_ARRIVAL'
  | 'CUSTOMS_STATUS_CHANGED'
  | 'CUSTOMS_CLEARED'
  | 'WAREHOUSE_RECEIVED'
  | 'ITEM_PUTAWAY'
  | 'ITEM_PICKED'
  | 'ORDER_PACKED'
  | 'ORDER_DISPATCHED'
  | 'DELIVERY_CONFIRMED'
  | 'INVENTORY_ADJUSTED'
  | 'STOCKOUT_RISK_CHANGED'
  | 'REPLENISHMENT_POLICY_CHANGED'
  | 'FREIGHT_FORWARDER_CREATED'
  | 'FREIGHT_FORWARDER_UPDATED';

export interface SwimBusinessEvent<T = Record<string, unknown>> {
  eventId: string;
  warehouseId: string;
  eventType: SwimEventType;
  aggregateType: 'shipment' | 'purchase_order' | 'inventory' | 'order' | 'warehouse' | 'customs';
  aggregateId: string;
  actorId?: string;
  occurredAt: string;
  payload: T;
  previousHash?: string | null;
  eventHash?: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

export function canonicalEventBody(event: Omit<SwimBusinessEvent, 'eventHash'>): string {
  return JSON.stringify(stable({
    eventId: event.eventId,
    warehouseId: event.warehouseId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    actorId: event.actorId || null,
    occurredAt: event.occurredAt,
    payload: event.payload,
    previousHash: event.previousHash || null,
  }));
}

export function computeEventHash(secret: string, event: Omit<SwimBusinessEvent, 'eventHash'>): string {
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Event ledger secret must be at least 32 bytes.');
  return crypto.createHmac('sha256', secret).update(canonicalEventBody(event)).digest('hex');
}

export function sealEvent<T>(secret: string, event: Omit<SwimBusinessEvent<T>, 'eventHash'>): SwimBusinessEvent<T> {
  return { ...event, eventHash: computeEventHash(secret, event as Omit<SwimBusinessEvent, 'eventHash'>) };
}

export function verifyEventChain(secret: string, events: SwimBusinessEvent[]): { valid: boolean; brokenAt?: string } {
  let previousHash: string | null = null;
  for (const event of events) {
    if ((event.previousHash || null) !== previousHash) return { valid: false, brokenAt: event.eventId };
    const { eventHash, ...unsigned } = event;
    const expected = computeEventHash(secret, unsigned);
    if (!eventHash || !crypto.timingSafeEqual(Buffer.from(eventHash), Buffer.from(expected))) {
      return { valid: false, brokenAt: event.eventId };
    }
    previousHash = eventHash;
  }
  return { valid: true };
}