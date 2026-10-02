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
  customerOrderReference?: string;
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