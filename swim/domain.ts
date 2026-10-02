export type SwimEventCategory =
  | 'SECURITY'
  | 'INVENTORY'
  | 'WAREHOUSE'
  | 'PROCUREMENT'
  | 'SHIPMENT'
  | 'TRACKING'
  | 'CUSTOMS'
  | 'FULFILMENT'
  | 'AUTOMATION'
  | 'INTEGRATION';

export type SwimEventSeverity = 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL';

export interface SwimEventInput {
  warehouseId: string;
  organizationId?: string;
  eventType: string;
  category: SwimEventCategory;
  aggregateType: string;
  aggregateId: string;
  occurredAt?: string;
  severity?: SwimEventSeverity;
  actorId?: string;
  actorName?: string;
  source?: string;
  dedupeKey?: string;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}

export interface SwimEvent extends SwimEventInput {
  id: string;
  occurredAt: string;
  recordedAt: string;
  severity: SwimEventSeverity;
  sequence: number;
}

export type ShipmentDirection = 'INBOUND' | 'OUTBOUND' | 'TRANSFER' | 'RETURN';
export type ShipmentMode = 'AIR' | 'OCEAN' | 'GROUND' | 'COURIER' | 'OTHER';
export type ShipmentStatus =
  | 'PLANNED'
  | 'BOOKED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_FORWARDER'
  | 'CONSOLIDATED'
  | 'AT_PORT'
  | 'CUSTOMS_PROCESSING'
  | 'CUSTOMS_HOLD'
  | 'CUSTOMS_CLEARED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'RETURNED'
  | 'EXCEPTION'
  | 'CANCELLED';

export interface ShipmentRecord {
  id: string;
  warehouseId: string;
  organizationId?: string;
  reference: string;
  direction: ShipmentDirection;
  mode: ShipmentMode;
  status: ShipmentStatus;
  originCountry?: string;
  originLocation?: string;
  destinationCountry?: string;
  destinationLocation?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  customerReference?: string;
  freightForwarder?: string;
  masterTrackingNumber?: string;
  carrierCode?: string;
  estimatedArrival?: string;
  actualArrival?: string;
  currency?: string;
  goodsValue?: number;
  freightCost?: number;
  insuranceCost?: number;
  notes?: string;
}

export type TrackingStatus =
  | 'UNKNOWN'
  | 'LABEL_CREATED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_FORWARDER'
  | 'AT_PORT'
  | 'CUSTOMS'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'RETURNED';

export interface TrackingCheckpoint {
  id: string;
  warehouseId: string;
  shipmentId: string;
  trackingNumber: string;
  carrierCode: string;
  status: TrackingStatus;
  statusDetail?: string;
  location?: string;
  countryCode?: string;
  eventTime: string;
  source: string;
  rawProviderStatus?: string;
  providerEventId?: string;
}

export interface CarrierTrackingSnapshot {
  carrierCode: string;
  trackingNumber: string;
  status: TrackingStatus;
  eta?: string;
  lastUpdatedAt?: string;
  serviceLevel?: string;
  checkpoints: Omit<TrackingCheckpoint, 'id' | 'warehouseId' | 'shipmentId'>[];
}

export type CustomsBaseComponent =
  | 'CUSTOMS_VALUE'
  | 'IMPORT_DUTY'
  | 'CUSTOMS_SERVICE_CHARGE'
  | 'EXCISE'
  | 'ENVIRONMENTAL_LEVY'
  | 'OTHER_TAXES';

export interface CustomsCalculationPolicy {
  importDutyBase?: CustomsBaseComponent[];
  customsServiceBase?: CustomsBaseComponent[];
  exciseBase?: CustomsBaseComponent[];
  environmentalLevyBase?: CustomsBaseComponent[];
  otherTaxBase?: CustomsBaseComponent[];
  vatBase?: CustomsBaseComponent[];
}

export interface CustomsRule {
  id: string;
  jurisdictionCode: string;
  hsCodePrefix: string;
  description?: string;
  importDutyRate?: number;
  vatRate?: number;
  customsServiceRate?: number;
  exciseRate?: number;
  environmentalLevyRate?: number;
  otherRate?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  officialSourceUrl: string;
  sourceTitle: string;
  verifiedAt: string;
  version: string;
  calculationPolicy?: CustomsCalculationPolicy;
}

export interface LandedCostInput {
  jurisdictionCode: string;
  hsCode: string;
  goodsValue: number;
  freight: number;
  insurance: number;
  otherDutiableCharges?: number;
  brokerage?: number;
  portFees?: number;
  localDelivery?: number;
  concessionPercent?: number;
}

export interface LandedCostResult {
  customsValue: number;
  importDuty: number;
  customsServiceCharge: number;
  excise: number;
  environmentalLevy: number;
  otherTaxes: number;
  vat: number;
  brokerage: number;
  portFees: number;
  localDelivery: number;
  totalBorderCharges: number;
  totalLandedCost: number;
  ruleId: string;
  ruleVersion: string;
  officialSourceUrl: string;
  confidence: 'HIGH' | 'MEDIUM' | 'REVIEW_REQUIRED';
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface AutomationApproval {
  id: string;
  warehouseId: string;
  actionType: string;
  aggregateType: string;
  aggregateId: string;
  requestedBy: string;
  rationale: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface TrackingProviderRegistration {
  id: string;
  warehouseId: string;
  shipmentId: string;
  providerCode: string;
  providerTrackingId: string;
  trackingNumber: string;
  carrierCode?: string;
  createdAt: string;
}
