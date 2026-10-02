export type TrackingStatus =
  | 'LABEL_CREATED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_FORWARDER'
  | 'CUSTOMS'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'EXCEPTION'
  | 'RETURNED'
  | 'UNKNOWN';

export interface TrackingCheckpoint {
  id?: string;
  carrierEventId?: string;
  status: TrackingStatus;
  description: string;
  location?: string;
  occurredAt: string;
  estimatedDeliveryAt?: string;
  source: string;
}

export interface CarrierDetection {
  carrier: 'UPS' | 'FEDEX' | 'DHL' | 'USPS' | 'UNKNOWN';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

export interface TrackingSummary {
  status: TrackingStatus;
  latestDescription: string;
  latestLocation?: string;
  latestCheckpointAt?: string;
  estimatedDeliveryAt?: string;
  exception: boolean;
  delivered: boolean;
}

export interface CarrierAdapter {
  readonly providerKey: string;
  createTracker(input: { trackingNumber: string; carrierHint?: string }): Promise<{ externalTrackerId: string }>;
  fetchTracking(input: { trackingNumber: string; externalTrackerId?: string }): Promise<TrackingCheckpoint[]>;
}

export function detectCarrier(trackingNumber: string): CarrierDetection[] {
  const value = trackingNumber.trim().replace(/[\s-]/g, '').toUpperCase();
  const results: CarrierDetection[] = [];
  if (/^1Z[0-9A-Z]{16}$/.test(value)) {
    results.push({ carrier: 'UPS', confidence: 'HIGH', reason: 'Matches the standard UPS 1Z format.' });
  }
  if (/^\d{12}$/.test(value) || /^\d{15}$/.test(value)) {
    results.push({ carrier: 'FEDEX', confidence: 'MEDIUM', reason: 'Length matches common FedEx parcel formats.' });
  }
  if (/^\d{10}$/.test(value)) {
    results.push({ carrier: 'DHL', confidence: 'MEDIUM', reason: 'Length matches a common DHL Express format.' });
  }
  if (/^\d{20,22}$/.test(value)) {
    results.push({ carrier: 'USPS', confidence: 'LOW', reason: 'Length matches common USPS numeric formats; other carriers may overlap.' });
  }
  return results.length ? results : [{ carrier: 'UNKNOWN', confidence: 'LOW', reason: 'No safe local match; ask the configured tracking provider to detect the carrier.' }];
}

export function normalizeCarrierStatus(rawStatus: string, description = ''): TrackingStatus {
  const text = `${rawStatus} ${description}`.toLowerCase();
  if (/delivered|proof of delivery/.test(text)) return 'DELIVERED';
  if (/out for delivery|with courier/.test(text)) return 'OUT_FOR_DELIVERY';
  if (/customs|clearance|brokerage/.test(text)) return 'CUSTOMS';
  if (/exception|delay|failed delivery|held|damaged/.test(text)) return 'EXCEPTION';
  if (/returned|return to sender/.test(text)) return 'RETURNED';
  if (/forwarder|freight warehouse|consolidation/.test(text)) return 'AT_FORWARDER';
  if (/picked up|accepted|collected/.test(text)) return 'PICKED_UP';
  if (/in transit|departed|arrived|processed|moving/.test(text)) return 'IN_TRANSIT';
  if (/label|pre.?shipment|shipment information/.test(text)) return 'LABEL_CREATED';
  return 'UNKNOWN';
}

export function summarizeTracking(checkpoints: TrackingCheckpoint[]): TrackingSummary {
  if (!checkpoints.length) {
    return { status: 'UNKNOWN', latestDescription: 'No carrier checkpoints received yet.', exception: false, delivered: false };
  }
  const sorted = [...checkpoints].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const latest = sorted[sorted.length - 1];
  const latestEta = [...sorted].reverse().find((point) => point.estimatedDeliveryAt)?.estimatedDeliveryAt;
  return {
    status: latest.status,
    latestDescription: latest.description,
    latestLocation: latest.location,
    latestCheckpointAt: latest.occurredAt,
    estimatedDeliveryAt: latestEta,
    exception: latest.status === 'EXCEPTION',
    delivered: latest.status === 'DELIVERED',
  };
}