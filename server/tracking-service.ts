import crypto from 'crypto';
import {
  addSwimTrackingCheckpoint,
  appendSwimBusinessEvent,
  getSwimShipment,
  getSwimTrackingSubscription,
  saveSwimTrackingSubscription,
  updateSwimTrackingSubscriptionSync,
} from '../server-db.js';
import { newId } from './security.js';
import { configuredTrackingProvider, trackingProviderByKey } from './tracking-provider-registry.js';
import type { TrackingCheckpoint } from '../src/domain/tracking.js';

function carrierHint(carrier?: string): string | undefined {
  const normalized = (carrier || '').trim().toUpperCase();
  if (normalized === 'FEDEX') return 'fedex';
  if (normalized === 'UPS') return 'ups';
  if (normalized === 'USPS') return 'usps';
  if (normalized === 'DHL') return 'dhl';
  return undefined;
}

export async function applyProviderCheckpoints(params: {
  warehouseId: string;
  shipmentId: string;
  actorId?: string;
  checkpoints: TrackingCheckpoint[];
}): Promise<number> {
  let insertedCount = 0;
  for (const checkpoint of params.checkpoints) {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex');
    const result = await addSwimTrackingCheckpoint(params.warehouseId, params.shipmentId, {
      ...checkpoint,
      id: newId('track'),
      payloadHash,
    });
    if (!result.inserted) continue;

    insertedCount += 1;
    await appendSwimBusinessEvent({
      eventId: newId('evt'),
      warehouseId: params.warehouseId,
      eventType: checkpoint.status === 'EXCEPTION'
        ? 'SHIPMENT_DELAYED'
        : 'SHIPMENT_CHECKPOINT_RECORDED',
      aggregateType: 'shipment',
      aggregateId: params.shipmentId,
      actorId: params.actorId,
      occurredAt: checkpoint.occurredAt,
      payload: {
        status: checkpoint.status,
        location: checkpoint.location || null,
        source: checkpoint.source,
        carrierEventId: checkpoint.carrierEventId || null,
      },
    });
  }
  return insertedCount;
}

export async function subscribeShipmentTracking(params: {
  warehouseId: string;
  shipmentId: string;
  actorId: string;
}) {
  const shipment = await getSwimShipment(params.warehouseId, params.shipmentId);
  if (!shipment) throw new Error('Shipment not found in this workspace.');
  if (!shipment.trackingNumber?.trim()) throw new Error('Add a tracking number before subscribing to carrier updates.');

  const existing = await getSwimTrackingSubscription(params.warehouseId, params.shipmentId);
  if (existing) return refreshShipmentTracking(params);

  const provider = configuredTrackingProvider();
  const created = await provider.createSubscription({
    trackingNumber: shipment.trackingNumber,
    carrierHint: carrierHint(shipment.carrier),
    title: shipment.reference,
  });

  const subscription = await saveSwimTrackingSubscription({
    id: newId('sub'),
    warehouseId: params.warehouseId,
    shipmentId: params.shipmentId,
    providerKey: created.providerKey,
    externalTrackerId: created.externalTrackerId,
    trackingNumber: created.trackingNumber,
    carrier: created.carrier,
  });

  const newCheckpointCount = await applyProviderCheckpoints({
    warehouseId: params.warehouseId,
    shipmentId: params.shipmentId,
    actorId: params.actorId,
    checkpoints: created.checkpoints,
  });

  await appendSwimBusinessEvent({
    eventId: newId('evt'),
    warehouseId: params.warehouseId,
    eventType: 'TRACKING_NUMBER_ADDED',
    aggregateType: 'shipment',
    aggregateId: params.shipmentId,
    actorId: params.actorId,
    occurredAt: new Date().toISOString(),
    payload: {
      provider: created.providerKey,
      externalTrackerId: created.externalTrackerId,
      trackingNumber: created.trackingNumber,
    },
  });

  return { subscription, newCheckpointCount };
}

export async function refreshShipmentTracking(params: {
  warehouseId: string;
  shipmentId: string;
  actorId?: string;
}) {
  const subscription = await getSwimTrackingSubscription(params.warehouseId, params.shipmentId);
  if (!subscription) throw new Error('This shipment is not subscribed to a tracking provider.');

  const provider = trackingProviderByKey(subscription.providerKey);
  try {
    const fetched = await provider.fetchTracking({
      externalTrackerId: subscription.externalTrackerId,
      trackingNumber: subscription.trackingNumber,
      carrier: subscription.carrier,
    });
    const newCheckpointCount = await applyProviderCheckpoints({
      warehouseId: params.warehouseId,
      shipmentId: params.shipmentId,
      actorId: params.actorId,
      checkpoints: fetched.checkpoints,
    });
    await updateSwimTrackingSubscriptionSync({
      warehouseId: params.warehouseId,
      shipmentId: params.shipmentId,
      status: 'ACTIVE',
    });
    return {
      subscription: await getSwimTrackingSubscription(params.warehouseId, params.shipmentId),
      newCheckpointCount,
    };
  } catch (error) {
    await updateSwimTrackingSubscriptionSync({
      warehouseId: params.warehouseId,
      shipmentId: params.shipmentId,
      status: 'ERROR',
      lastError: 'Tracking provider synchronization failed.',
    });
    throw error;
  }
}
