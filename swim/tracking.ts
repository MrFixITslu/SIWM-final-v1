import {
  CarrierTrackingSnapshot,
  TrackingCheckpoint,
  TrackingStatus
} from './domain.js';
import { normalizeTrackingNumber } from './security.js';

export interface TrackingRegistrationResult {
  providerTrackingId: string;
  snapshot: CarrierTrackingSnapshot;
}

export interface CarrierAdapter {
  readonly code: string;
  canHandle(trackingNumber: string): boolean;
  registerTracking?(
    trackingNumber: string,
    options?: { carrierCode?: string; shipmentId?: string; warehouseId?: string }
  ): Promise<TrackingRegistrationResult>;
  fetchTracking(
    trackingNumber: string,
    providerTrackingId?: string
  ): Promise<CarrierTrackingSnapshot>;
  parseWebhook?(
    payload: unknown,
    headers: Record<string, string | string[] | undefined>
  ): Promise<TrackingRegistrationResult[]>;
}

const adapters = new Map<string, CarrierAdapter>();

export function registerCarrierAdapter(adapter: CarrierAdapter): void {
  const code = adapter.code.trim().toUpperCase();
  if (!code) throw new Error('Carrier adapter code is required.');
  if (adapters.has(code)) throw new Error(`Carrier adapter ${code} is already registered.`);
  adapters.set(code, adapter);
}

export function getCarrierAdapter(code: string): CarrierAdapter {
  const adapter = adapters.get(String(code || '').trim().toUpperCase());
  if (!adapter) throw new Error(`Carrier adapter ${code} is not configured.`);
  return adapter;
}

export function detectCarrier(trackingNumber: string): CarrierAdapter | undefined {
  const normalized = normalizeTrackingNumber(trackingNumber);
  return [...adapters.values()].find((adapter) => adapter.canHandle(normalized));
}

export function listCarrierAdapters(): string[] {
  return [...adapters.keys()].sort();
}

export function normalizeProviderStatus(value: string | undefined): TrackingStatus {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return 'UNKNOWN';
  if (/DELIVERED/.test(status)) return 'DELIVERED';
  if (/OUT.?FOR.?DELIVERY|WITH.?COURIER/.test(status)) return 'OUT_FOR_DELIVERY';
  if (/CUSTOMS|CLEARANCE/.test(status)) return 'CUSTOMS';
  if (/EXCEPTION|FAILED|DELAY|HOLD|DAMAGED/.test(status)) return 'EXCEPTION';
  if (/RETURN/.test(status)) return 'RETURNED';
  if (/FORWARDER|CONSOLIDAT/.test(status)) return 'AT_FORWARDER';
  if (/PORT|TERMINAL/.test(status)) return 'AT_PORT';
  if (/TRANSIT|DEPARTED|ARRIVED|SCAN/.test(status)) return 'IN_TRANSIT';
  if (/PICKED.?UP|ACCEPTED/.test(status)) return 'PICKED_UP';
  if (/LABEL|INFO.?RECEIVED|PRE.?SHIPMENT/.test(status)) return 'LABEL_CREATED';
  return 'UNKNOWN';
}

export function sortCheckpoints(
  checkpoints: Omit<TrackingCheckpoint, 'id' | 'warehouseId' | 'shipmentId'>[]
) {
  return [...checkpoints].sort(
    (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime()
  );
}

export function mapTrackingStatusToShipmentStatus(status: TrackingStatus) {
  switch (status) {
    case 'LABEL_CREATED': return 'BOOKED' as const;
    case 'PICKED_UP': return 'PICKED_UP' as const;
    case 'IN_TRANSIT': return 'IN_TRANSIT' as const;
    case 'AT_FORWARDER': return 'AT_FORWARDER' as const;
    case 'AT_PORT': return 'AT_PORT' as const;
    case 'CUSTOMS': return 'CUSTOMS_PROCESSING' as const;
    case 'OUT_FOR_DELIVERY': return 'OUT_FOR_DELIVERY' as const;
    case 'DELIVERED': return 'DELIVERED' as const;
    case 'RETURNED': return 'RETURNED' as const;
    case 'EXCEPTION': return 'EXCEPTION' as const;
    default: return undefined;
  }
}
