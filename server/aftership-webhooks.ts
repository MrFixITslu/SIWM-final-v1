import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  findSwimTrackingSubscriptionByProviderTracker,
  releaseSwimWebhookReceipt,
  reserveSwimWebhookReceipt,
  updateSwimTrackingSubscriptionSync,
} from '../server-db.js';
import { webhookReplayKey } from '../src/domain/webhooks.js';
import { applyProviderCheckpoints, refreshShipmentTracking } from './tracking-service.js';
import { verifyAndParseAfterShipWebhook } from './tracking-providers/aftership-webhook.js';

const MAX_BODY_BYTES = 1024 * 1024;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Tracking webhook rate limit exceeded.' },
});

export function createAfterShipWebhookRouter() {
  const router = Router();

  router.post(
    '/',
    limiter,
    express.raw({ type: 'application/json', limit: MAX_BODY_BYTES }),
    async (req: any, res) => {
      if (!Buffer.isBuffer(req.body)) {
        res.status(415).json({ error: 'AfterShip webhooks require application/json.' });
        return;
      }

      let verified;
      try {
        verified = verifyAndParseAfterShipWebhook(
          req.body,
          typeof req.headers['aftership-hmac-sha256'] === 'string'
            ? req.headers['aftership-hmac-sha256']
            : undefined,
        );
      } catch (error) {
        console.warn('Rejected AfterShip webhook:', {
          reason: error instanceof Error ? error.message : 'Verification failed',
        });
        res.status(401).json({ error: 'Webhook authentication failed.' });
        return;
      }

      const subscription = await findSwimTrackingSubscriptionByProviderTracker(
        'aftership',
        verified.externalTrackerId,
      );
      if (!subscription) {
        // Non-2xx intentionally asks AfterShip to retry. This covers the short race
        // where a create-tracker webhook can arrive before SWIM commits its subscription row.
        res.status(409).json({ error: 'Tracking subscription is not ready.' });
        return;
      }

      const replayKey = webhookReplayKey({
        provider: 'aftership',
        providerEventId: verified.eventId,
        bodyHash: verified.bodyHash,
      });
      const reserved = await reserveSwimWebhookReceipt({
        replayKey,
        providerKey: 'aftership',
        providerEventId: verified.eventId,
        bodyHash: verified.bodyHash,
        warehouseId: subscription.warehouseId,
        shipmentId: subscription.shipmentId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

      if (!reserved) {
        res.status(200).json({ accepted: true, duplicate: true });
        return;
      }

      try {
        let newCheckpointCount = 0;
        if (verified.checkpoints.length) {
          newCheckpointCount = await applyProviderCheckpoints({
            warehouseId: subscription.warehouseId,
            shipmentId: subscription.shipmentId,
            checkpoints: verified.checkpoints,
          });
          await updateSwimTrackingSubscriptionSync({
            warehouseId: subscription.warehouseId,
            shipmentId: subscription.shipmentId,
            status: 'ACTIVE',
          });
        } else {
          const refreshed = await refreshShipmentTracking({
            warehouseId: subscription.warehouseId,
            shipmentId: subscription.shipmentId,
          });
          newCheckpointCount = refreshed.newCheckpointCount;
        }

        res.status(200).json({
          accepted: true,
          duplicate: false,
          newCheckpointCount,
        });
      } catch (error) {
        try {
          await releaseSwimWebhookReceipt(replayKey);
        } catch (releaseError) {
          console.error('Unable to release failed AfterShip replay reservation:', {
            eventId: verified.eventId,
            reason: releaseError instanceof Error ? releaseError.message : 'Unknown error',
          });
        }
        console.error('AfterShip webhook processing failed:', {
          eventId: verified.eventId,
          shipmentId: subscription.shipmentId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
        res.status(503).json({ error: 'Tracking update could not be processed.' });
      }
    },
  );

  return router;
}
