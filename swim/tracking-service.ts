import crypto from 'crypto';
import type {
  CarrierTrackingSnapshot,
  SwimEventInput,
  TrackingCheckpoint
} from './domain.js';
import {
  addTrackingCheckpoint,
  appendSwimEvent,
  getShipment,
  getTrackingRegistration,
  getTrackingRegistrationByProviderId,
  registerTrackingProvider,
  updateShipmentTrackingState
} from './platform-store.js';
import {
  getCarrierAdapter,
  mapTrackingStatusToShipmentStatus
} from './tracking.js';
import {
  newSwimId,
  normalizeTrackingNumber,
  requireSafeId
} from './security.js';

export interface TrackingActor {
  actorId?: string;
  actorName?: string;
}

function checkpointFingerprint(
  providerCode: string,
  shipmentId: string,
  cp: Omit<TrackingCheckpoint, 'id' | 'warehouseId' | 'shipmentId'>
): string {
  const raw = [
    providerCode,
    shipmentId,
    cp.trackingNumber,
    cp.carrierCode,
    cp.eventTime,
    cp.status,
    cp.location || '',
    cp.statusDetail || ''
  ].join('|');
  return `fp-${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

async function persistSnapshot(
  warehouseId: string,
  shipmentId: string,
  providerCode: string,
  snapshot: CarrierTrackingSnapshot,
  actor: TrackingActor,
  eventDedupeKey?: string
) {
  const safeWarehouseId = requireSafeId(warehouseId, 'warehouseId');
  const safeShipmentId = requireSafeId(shipmentId, 'shipmentId');
  const shipment = await getShipment(safeWarehouseId, safeShipmentId);
  if (!shipment) throw new Error('Shipment was not found in this workspace.');

  let insertedCheckpoints = 0;
  for (const cp of snapshot.checkpoints || []) {
    const providerEventId =
      cp.providerEventId ||
      checkpointFingerprint(providerCode, safeShipmentId, cp);
    await addTrackingCheckpoint({
      ...cp,
      id: newSwimId('trk'),
      warehouseId: safeWarehouseId,
      shipmentId: safeShipmentId,
      trackingNumber: normalizeTrackingNumber(cp.trackingNumber || snapshot.trackingNumber),
      carrierCode: String(cp.carrierCode || snapshot.carrierCode || 'UNKNOWN').toUpperCase(),
      source: providerCode,
      providerEventId
    });
    insertedCheckpoints += 1;
  }

  const shipmentStatus = mapTrackingStatusToShipmentStatus(snapshot.status);
  const updatedShipment = shipmentStatus
    ? await updateShipmentTrackingState(
        safeWarehouseId,
        safeShipmentId,
        shipmentStatus,
        snapshot.carrierCode,
        snapshot.trackingNumber,
        snapshot.eta
      )
    : shipment;

  const event: SwimEventInput = {
    warehouseId: safeWarehouseId,
    eventType: snapshot.status === 'EXCEPTION'
      ? 'SHIPMENT_TRACKING_EXCEPTION'
      : 'SHIPMENT_TRACKING_UPDATED',
    category: 'TRACKING',
    aggregateType: 'SHIPMENT',
    aggregateId: safeShipmentId,
    severity: snapshot.status === 'EXCEPTION' ? 'WARNING' : 'INFO',
    actorId: actor.actorId,
    actorName: actor.actorName,
    source: providerCode,
    dedupeKey: eventDedupeKey,
    metadata: {
      providerCode,
      carrierCode: snapshot.carrierCode,
      trackingNumber: snapshot.trackingNumber,
      trackingStatus: snapshot.status,
      eta: snapshot.eta,
      lastUpdatedAt: snapshot.lastUpdatedAt,
      checkpointCount: snapshot.checkpoints?.length || 0
    }
  };
  await appendSwimEvent(event);

  return {
    shipment: updatedShipment,
    snapshot,
    insertedCheckpoints
  };
}

export async function registerShipmentTracking(input: {
  warehouseId: string;
  shipmentId: string;
  trackingNumber: string;
  carrierCode?: string;
  providerCode?: string;
  actor?: TrackingActor;
}) {
  const warehouseId = requireSafeId(input.warehouseId, 'warehouseId');
  const shipmentId = requireSafeId(input.shipmentId, 'shipmentId');
  const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
  const providerCode = String(input.providerCode || 'AFTERSHIP').trim().toUpperCase();
  const shipment = await getShipment(warehouseId, shipmentId);
  if (!shipment) throw new Error('Shipment was not found in this workspace.');

  const existing = await getTrackingRegistration(warehouseId, shipmentId, providerCode);
  if (existing) {
    return refreshShipmentTracking({
      warehouseId,
      shipmentId,
      providerCode,
      actor: input.actor
    });
  }

  const adapter = getCarrierAdapter(providerCode);
  if (!adapter.registerTracking) {
    throw new Error(`Tracking provider ${providerCode} does not support registration.`);
  }

  const registrationResult = await adapter.registerTracking(trackingNumber, {
    carrierCode: input.carrierCode,
    shipmentId,
    warehouseId
  });

  const registration = await registerTrackingProvider({
    id: newSwimId('provider-link'),
    warehouseId,
    shipmentId,
    providerCode,
    providerTrackingId: registrationResult.providerTrackingId,
    trackingNumber,
    carrierCode: registrationResult.snapshot.carrierCode || input.carrierCode
  });

  const persisted = await persistSnapshot(
    warehouseId,
    shipmentId,
    providerCode,
    registrationResult.snapshot,
    input.actor || {},
    `tracking-registration:${providerCode}:${registrationResult.providerTrackingId}`
  );

  return { registration, ...persisted };
}

export async function refreshShipmentTracking(input: {
  warehouseId: string;
  shipmentId: string;
  providerCode?: string;
  actor?: TrackingActor;
}) {
  const warehouseId = requireSafeId(input.warehouseId, 'warehouseId');
  const shipmentId = requireSafeId(input.shipmentId, 'shipmentId');
  const providerCode = String(input.providerCode || 'AFTERSHIP').trim().toUpperCase();
  const registration = await getTrackingRegistration(warehouseId, shipmentId, providerCode);
  if (!registration) {
    throw new Error('No tracking provider is registered for this shipment.');
  }
  const adapter = getCarrierAdapter(providerCode);
  const snapshot = await adapter.fetchTracking(
    registration.trackingNumber,
    registration.providerTrackingId
  );
  const refreshedAt = snapshot.lastUpdatedAt || new Date().toISOString();
  const persisted = await persistSnapshot(
    warehouseId,
    shipmentId,
    providerCode,
    snapshot,
    input.actor || {},
    `tracking-refresh:${providerCode}:${registration.providerTrackingId}:${refreshedAt}`
  );
  return { registration, ...persisted };
}

export async function ingestProviderTrackingUpdate(input: {
  providerCode: string;
  providerTrackingId: string;
  snapshot: CarrierTrackingSnapshot;
  providerEventId?: string;
}) {
  const providerCode = input.providerCode.trim().toUpperCase();
  const registration = await getTrackingRegistrationByProviderId(
    providerCode,
    input.providerTrackingId
  );
  if (!registration) {
    return { matched: false as const };
  }

  const persisted = await persistSnapshot(
    registration.warehouseId,
    registration.shipmentId,
    providerCode,
    input.snapshot,
    {},
    input.providerEventId
      ? `webhook:${providerCode}:${input.providerEventId}`
      : undefined
  );

  return {
    matched: true as const,
    registration,
    ...persisted
  };
}
