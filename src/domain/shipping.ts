import type { TrackingStatus } from './tracking.js';

export type ShipmentMode = 'PARCEL' | 'AIR' | 'OCEAN' | 'GROUND' | 'COURIER' | 'INTER_ISLAND';
export type ShipmentStatus = 'PLANNED' | 'BOOKED' | 'IN_TRANSIT' | 'CUSTOMS' | 'RECEIVED' | 'DELIVERED' | 'EXCEPTION' | 'CANCELLED';
export type LogisticsUnitType = 'ITEM' | 'CARTON' | 'PACKAGE' | 'PALLET' | 'CONTAINER';

export interface ShipmentLeg {
  id: string;
  sequence: number;
  mode: ShipmentMode;
  carrier?: string;
  service?: string;
  origin: string;
  destination: string;
  trackingNumber?: string;
  plannedDepartureAt?: string;
  plannedArrivalAt?: string;
  actualDepartureAt?: string;
  actualArrivalAt?: string;
}

export interface LogisticsUnit {
  id: string;
  shipmentId: string;
  parentUnitId?: string;
  type: LogisticsUnitType;
  reference?: string;
  quantity?: number;
  weightGrams?: number;
}

export interface ShipmentRecord {
  id: string;
  warehouseId: string;
  reference: string;
  mode: ShipmentMode;
  status: ShipmentStatus;
  carrier?: string;
  trackingNumber?: string;
  trackingProvider?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  freightForwarderId?: string;
  customerOrderReference?: string;
  parentShipmentId?: string;
  origin?: string;
  destination?: string;
  estimatedArrivalAt?: string;
  latestLocation?: string;
  latestTrackingStatus?: TrackingStatus;
  createdAt: string;
  updatedAt: string;
}

const containmentRank: Record<LogisticsUnitType, number> = {
  ITEM: 0,
  CARTON: 1,
  PACKAGE: 2,
  PALLET: 3,
  CONTAINER: 4,
};

export function canContain(parent: LogisticsUnitType, child: LogisticsUnitType): boolean {
  return containmentRank[parent] > containmentRank[child];
}

export function shipmentNeedsAttention(shipment: Pick<ShipmentRecord, 'status' | 'estimatedArrivalAt' | 'latestTrackingStatus'>, now = new Date()): boolean {
  if (shipment.status === 'EXCEPTION' || shipment.latestTrackingStatus === 'EXCEPTION') return true;
  if (shipment.status === 'DELIVERED' || shipment.status === 'RECEIVED' || shipment.status === 'CANCELLED') return false;
  if (!shipment.estimatedArrivalAt) return false;
  const eta = Date.parse(shipment.estimatedArrivalAt);
  return Number.isFinite(eta) && eta < now.getTime();
}

export function validateShipmentLegSequence(legs: ShipmentLeg[]): { valid: true } | { valid: false; reason: string } {
  if (!legs.length) return { valid: true };
  const ordered = [...legs].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<number>();
  for (let index = 0; index < ordered.length; index += 1) {
    const leg = ordered[index];
    if (!Number.isInteger(leg.sequence) || leg.sequence < 1) {
      return { valid: false, reason: 'Shipment leg sequence numbers must be positive integers.' };
    }
    if (seen.has(leg.sequence)) {
      return { valid: false, reason: 'Shipment leg sequence numbers must be unique.' };
    }
    seen.add(leg.sequence);
    if (!leg.origin.trim() || !leg.destination.trim()) {
      return { valid: false, reason: 'Each shipment leg requires an origin and destination.' };
    }
    if (index > 0) {
      const previous = ordered[index - 1];
      if (previous.destination.trim().toLowerCase() !== leg.origin.trim().toLowerCase()) {
        return { valid: false, reason: 'Shipment legs must form a continuous journey.' };
      }
    }
  }
  return { valid: true };
}

export function canConsolidateShipment(
  master: Pick<ShipmentRecord, 'id' | 'status' | 'parentShipmentId'>,
  child: Pick<ShipmentRecord, 'id' | 'status' | 'parentShipmentId'>,
): { allowed: true } | { allowed: false; reason: string } {
  if (master.id === child.id) return { allowed: false, reason: 'A shipment cannot contain itself.' };
  if (child.parentShipmentId) return { allowed: false, reason: 'This shipment is already part of a consolidation.' };
  if (['DELIVERED', 'RECEIVED', 'CANCELLED'].includes(master.status)) {
    return { allowed: false, reason: 'Completed or cancelled master shipments cannot accept new child shipments.' };
  }
  if (['DELIVERED', 'RECEIVED', 'CANCELLED'].includes(child.status)) {
    return { allowed: false, reason: 'Completed or cancelled shipments cannot be consolidated.' };
  }
  return { allowed: true };
}
