import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { addSwimTrackingCheckpoint, appendSwimBusinessEvent, getSwimShipment, reserveSwimWebhookReceipt } from '../server-db.js';
import { newId } from './security.js';
import { parseTrackingGatewayEnvelope } from '../src/domain/tracking-gateway.js';
import { normalizeProviderKey, verifyHmacWebhook, webhookReplayKey } from '../src/domain/webhooks.js';

const MAX_WEBHOOK_BYTES = 256 * 1024;
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const trackingWebhookRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Tracking webhook rate limit exceeded.' },
});

function providerSecret(provider: string): string {
  const envKey = `SWIM_TRACKING_WEBHOOK_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const secret = process.env[envKey]?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Tracking webhook provider is not securely configured.');
  }
  return secret;
}

export function createTrackingWebhookRouter() {
  const router = Router();

  router.post(
    '/:provider/webhook',
    trackingWebhookRateLimiter,
    express.raw({ type: 'application/json', limit: MAX_WEBHOOK_BYTES }),
    async (req: any, res) => {
      let provider: string;
      try {
        provider = normalizeProviderKey(req.params.provider || '');
      } catch {
        res.status(404).json({ error: 'Unknown tracking provider.' });
        return;
      }

      if (!Buffer.isBuffer(req.body)) {
        res.status(415).json({ error: 'Tracking webhooks require application/json.' });
        return;
      }

      let verified;
      try {
        verified = verifyHmacWebhook({
          rawBody: req.body,
          signatureHeader: typeof req.headers['x-swim-webhook-signature'] === 'string'
            ? req.headers['x-swim-webhook-signature']
            : undefined,
          timestampHeader: typeof req.headers['x-swim-webhook-timestamp'] === 'string'
            ? req.headers['x-swim-webhook-timestamp']
            : undefined,
          secret: providerSecret(provider),
        });
      } catch (error) {
        console.warn('Rejected tracking webhook:', { provider, reason: (error as Error).message });
        res.status(401).json({ error: 'Webhook authentication failed.' });
        return;
      }

      let payload: ReturnType<typeof parseTrackingGatewayEnvelope>;
      try {
        payload = parseTrackingGatewayEnvelope(JSON.parse(req.body.toString('utf8')));
      } catch (error: any) {
        res.status(400).json({
          error: 'Tracking webhook payload is invalid.',
          fields: Array.isArray(error?.issues) ? error.issues : undefined,
        });
        return;
      }

      const replayKey = webhookReplayKey({
        provider,
        providerEventId: payload.eventId,
        bodyHash: verified.bodyHash,
      });

      try {
        const reserved = await reserveSwimWebhookReceipt({
          replayKey,
          providerKey: provider,
          providerEventId: payload.eventId,
          bodyHash: verified.bodyHash,
          warehouseId: payload.warehouseId,
          shipmentId: payload.shipmentId,
          expiresAt: new Date(Date.now() + RECEIPT_TTL_MS).toISOString(),
        });

        if (!reserved) {
          res.status(202).json({ accepted: true, duplicate: true });
          return;
        }

        const shipment = await getSwimShipment(payload.warehouseId, payload.shipmentId);
        if (!shipment) {
          res.status(404).json({ error: 'Target shipment was not found.' });
          return;
        }

        if (payload.trackingNumber && shipment.trackingNumber &&
            payload.trackingNumber.trim().toUpperCase() !== shipment.trackingNumber.trim().toUpperCase()) {
          res.status(409).json({ error: 'Tracking number does not match the target shipment.' });
          return;
        }

        const checkpoint = {
          id: newId('track'),
          carrierEventId: payload.eventId,
          status: payload.status,
          description: payload.description,
          location: payload.location,
          occurredAt: payload.occurredAt,
          estimatedDeliveryAt: payload.estimatedDeliveryAt,
          source: `provider:${provider}`,
          payloadHash: verified.bodyHash,
        };

        await addSwimTrackingCheckpoint(payload.warehouseId, payload.shipmentId, checkpoint);
        await appendSwimBusinessEvent({
          eventId: newId('evt'),
          warehouseId: payload.warehouseId,
          eventType: payload.status === 'EXCEPTION' ? 'SHIPMENT_DELAYED' : 'SHIPMENT_CHECKPOINT_RECORDED',
          aggregateType: 'shipment',
          aggregateId: payload.shipmentId,
          occurredAt: payload.occurredAt,
          payload: {
            provider,
            providerEventId: payload.eventId,
            status: payload.status,
            location: payload.location || null,
            source: checkpoint.source,
          },
        });

        res.status(202).json({ accepted: true, duplicate: false });
      } catch (error) {
        console.error('Tracking webhook ingestion failed:', {
          provider,
          eventId: payload.eventId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        res.status(500).json({ error: 'Unable to process tracking update.' });
      }
    },
  );

  return router;
}
