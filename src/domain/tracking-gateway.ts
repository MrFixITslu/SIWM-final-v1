import { z } from 'zod';

export const trackingGatewayStatus = z.enum([
  'LABEL_CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_FORWARDER',
  'CUSTOMS',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'EXCEPTION',
  'RETURNED',
  'UNKNOWN',
]);

const isoDateTime = z.string().datetime({ offset: true });

export const trackingGatewayEnvelopeSchema = z.object({
  eventId: z.string().trim().min(1).max(180),
  warehouseId: z.string().trim().min(1).max(80),
  shipmentId: z.string().trim().min(1).max(80),
  trackingNumber: z.string().trim().min(1).max(220).optional(),
  status: trackingGatewayStatus,
  description: z.string().trim().min(1).max(1000),
  location: z.string().trim().max(500).optional(),
  occurredAt: isoDateTime,
  estimatedDeliveryAt: isoDateTime.optional(),
}).strict();

export type TrackingGatewayEnvelope = z.infer<typeof trackingGatewayEnvelopeSchema>;

export function parseTrackingGatewayEnvelope(value: unknown): TrackingGatewayEnvelope {
  const parsed = trackingGatewayEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    const error = new Error('Tracking webhook payload is invalid.');
    (error as any).issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw error;
  }
  return parsed.data;
}
