import { normalizeCarrierStatus, type TrackingCheckpoint } from '../../src/domain/tracking.js';
import type { ServerTrackingProvider, TrackingSubscriptionRequest, TrackingSubscriptionResult } from './types.js';

const BASE_URL = 'https://api.aftership.com/tracking/2026-07';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function requireApiKey(): string {
  const value = process.env.AFTERSHIP_API_KEY?.trim();
  if (!value || value.length < 12) throw new Error('AfterShip tracking provider is not configured.');
  return value;
}

function safeTrackerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9A-Za-z_-]{1,128}$/.test(value)) {
    throw new Error('AfterShip returned an invalid tracking ID.');
  }
  return value;
}

function safeTrackingNumber(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value.trim() : fallback.trim();
  if (!candidate || candidate.length > 220) throw new Error('AfterShip returned an invalid tracking number.');
  return candidate;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function checkpointLocation(checkpoint: any): string | undefined {
  const pieces = [
    checkpoint?.location,
    checkpoint?.city,
    checkpoint?.state,
    checkpoint?.country_region || checkpoint?.country_name,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  return pieces.length ? [...new Set(pieces)].join(', ') : undefined;
}

export function mapAfterShipCheckpoints(tracking: any): TrackingCheckpoint[] {
  const checkpoints = Array.isArray(tracking?.checkpoints) ? tracking.checkpoints : [];
  const trackingEta =
    isoOrUndefined(tracking?.estimated_delivery) ||
    isoOrUndefined(tracking?.expected_delivery) ||
    isoOrUndefined(tracking?.expected_delivery_date);

  return checkpoints.flatMap((checkpoint: any, index: number) => {
    const occurredAt =
      isoOrUndefined(checkpoint?.checkpoint_time) ||
      isoOrUndefined(checkpoint?.created_at);
    if (!occurredAt) return [];

    const description =
      (typeof checkpoint?.message === 'string' && checkpoint.message.trim()) ||
      (typeof checkpoint?.raw_tag === 'string' && checkpoint.raw_tag.trim()) ||
      (typeof checkpoint?.tag === 'string' && checkpoint.tag.trim()) ||
      'Carrier tracking update';

    const rawStatus = [
      checkpoint?.tag,
      checkpoint?.subtag,
      checkpoint?.raw_tag,
      description,
    ].filter(Boolean).join(' ');

    const carrierEventId =
      (typeof checkpoint?.hash === 'string' && checkpoint.hash.trim()) ||
      (typeof checkpoint?.id === 'string' && checkpoint.id.trim()) ||
      `aftership:${index}:${occurredAt}`;

    return [{
      carrierEventId: carrierEventId.slice(0, 180),
      status: normalizeCarrierStatus(rawStatus, description),
      description: description.slice(0, 1000),
      location: checkpointLocation(checkpoint)?.slice(0, 500),
      occurredAt,
      estimatedDeliveryAt: isoOrUndefined(checkpoint?.estimated_delivery) || trackingEta,
      source: 'provider:aftership',
    }];
  });
}

function extractTracking(payload: any): any {
  const tracking = payload?.data?.tracking ?? payload?.tracking ?? payload?.data;
  if (!tracking || typeof tracking !== 'object' || Array.isArray(tracking)) {
    throw new Error('AfterShip returned an unexpected response.');
  }
  return tracking;
}

async function requestAfterShip(path: string, options: RequestInit): Promise<any> {
  if (!path.startsWith('/')) throw new Error('AfterShip request path is invalid.');
  const url = new URL(path, BASE_URL);
  if (url.origin !== 'https://api.aftership.com') throw new Error('AfterShip request host is invalid.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'as-api-key': requireApiKey(),
        ...(options.headers || {}),
      },
    });

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('AfterShip response exceeded the size limit.');
    }

    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('AfterShip response exceeded the size limit.');
    }

    let payload: any = {};
    if (body) {
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error('AfterShip returned invalid JSON.');
      }
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const error = new Error(
        retryable
          ? 'AfterShip is temporarily unavailable. Please retry.'
          : 'AfterShip rejected the tracking request.',
      );
      (error as any).statusCode = response.status;
      (error as any).retryable = retryable;
      throw error;
    }

    return payload;
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('AfterShip request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class AfterShipTrackingProvider implements ServerTrackingProvider {
  readonly providerKey = 'aftership';

  async createSubscription(input: TrackingSubscriptionRequest): Promise<TrackingSubscriptionResult> {
    const trackingNumber = input.trackingNumber.trim();
    if (!trackingNumber || trackingNumber.length > 220) {
      throw new Error('A valid tracking number is required.');
    }

    const tracking: Record<string, unknown> = { tracking_number: trackingNumber };
    if (input.carrierHint?.trim()) tracking.slug = input.carrierHint.trim().toLowerCase().slice(0, 80);
    if (input.title?.trim()) tracking.title = input.title.trim().slice(0, 120);

    const payload = await requestAfterShip('/trackings', {
      method: 'POST',
      body: JSON.stringify({ tracking }),
    });
    const result = extractTracking(payload);

    return {
      providerKey: this.providerKey,
      externalTrackerId: safeTrackerId(result.id),
      trackingNumber: safeTrackingNumber(result.tracking_number, trackingNumber),
      carrier: typeof result.slug === 'string' ? result.slug.slice(0, 100) : input.carrierHint,
      checkpoints: mapAfterShipCheckpoints(result),
    };
  }

  async fetchTracking(input: {
    externalTrackerId: string;
    trackingNumber: string;
    carrier?: string;
  }): Promise<TrackingSubscriptionResult> {
    const trackerId = safeTrackerId(input.externalTrackerId);
    const payload = await requestAfterShip(
      `/trackings/${encodeURIComponent(trackerId)}?fields=checkpoints&lang=en`,
      { method: 'GET' },
    );
    const result = extractTracking(payload);

    return {
      providerKey: this.providerKey,
      externalTrackerId: safeTrackerId(result.id || trackerId),
      trackingNumber: safeTrackingNumber(result.tracking_number, input.trackingNumber),
      carrier: typeof result.slug === 'string' ? result.slug.slice(0, 100) : input.carrier,
      checkpoints: mapAfterShipCheckpoints(result),
    };
  }
}
