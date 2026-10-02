import {
  CarrierAdapter,
  TrackingRegistrationResult,
  normalizeProviderStatus,
  sortCheckpoints
} from '../tracking.js';
import type { CarrierTrackingSnapshot } from '../domain.js';
import { normalizeTrackingNumber } from '../security.js';

const DEFAULT_BASE_URL = 'https://api.aftership.com/tracking/2026-07';

interface AfterShipTrackingObject {
  id?: string;
  tracking_number?: string;
  slug?: string;
  tag?: string;
  subtag?: string;
  subtag_message?: string;
  expected_delivery?: string;
  estimated_delivery_date?: string;
  delivery_date?: string;
  last_updated_at?: string;
  updated_at?: string;
  checkpoints?: any[];
  order_id?: string;
  custom_fields?: Record<string, string>;
}

function unwrapTracking(payload: any): AfterShipTrackingObject {
  return payload?.data?.tracking || payload?.tracking || payload?.data || payload || {};
}

function checkpointTime(cp: any): string {
  const candidate =
    cp?.checkpoint_time ||
    cp?.created_at ||
    cp?.event_time ||
    cp?.time ||
    new Date().toISOString();
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function checkpointCountry(cp: any): string | undefined {
  const raw = String(
    cp?.country_iso2 ||
    cp?.country_code ||
    cp?.country_iso3 ||
    ''
  ).trim().toUpperCase();
  return raw.length === 2 ? raw : undefined;
}

function normalizeTrackingObject(obj: AfterShipTrackingObject): CarrierTrackingSnapshot {
  const trackingNumber = normalizeTrackingNumber(obj.tracking_number || '');
  const carrierCode = String(obj.slug || 'UNKNOWN').trim().toUpperCase();
  const rawStatus = obj.subtag || obj.tag || 'UNKNOWN';
  const checkpoints = Array.isArray(obj.checkpoints) ? obj.checkpoints : [];

  return {
    carrierCode,
    trackingNumber,
    status: normalizeProviderStatus(rawStatus),
    eta: obj.expected_delivery || obj.estimated_delivery_date || obj.delivery_date || undefined,
    lastUpdatedAt: obj.last_updated_at || obj.updated_at || undefined,
    checkpoints: sortCheckpoints(
      checkpoints.map((cp: any) => ({
        trackingNumber,
        carrierCode,
        status: normalizeProviderStatus(cp?.subtag || cp?.tag || cp?.status || cp?.message),
        statusDetail: String(cp?.subtag_message || cp?.message || cp?.checkpoint_message || '').trim() || undefined,
        location: String(cp?.location || cp?.city || '').trim() || undefined,
        countryCode: checkpointCountry(cp),
        eventTime: checkpointTime(cp),
        source: 'AFTERSHIP',
        rawProviderStatus: String(cp?.subtag || cp?.tag || cp?.status || '').slice(0, 160) || undefined,
        providerEventId: String(cp?.id || cp?.checkpoint_id || '').trim() || undefined
      }))
    )
  };
}

async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  let payload: any = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }
  }
  if (!res.ok) {
    const message =
      payload?.meta?.message ||
      payload?.message ||
      payload?.error ||
      `AfterShip request failed with HTTP ${res.status}.`;
    throw new Error(String(message));
  }
  return payload;
}

export function createAfterShipAdapter(
  apiKey: string,
  baseUrl = DEFAULT_BASE_URL
): CarrierAdapter {
  if (!apiKey) throw new Error('AfterShip API key is required.');

  const request = async (path: string, init?: RequestInit) => {
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'as-api-key': apiKey,
        ...(init?.headers || {})
      },
      signal: AbortSignal.timeout(12_000)
    });
  };

  return {
    code: 'AFTERSHIP',

    canHandle(trackingNumber: string) {
      try {
        normalizeTrackingNumber(trackingNumber);
        return true;
      } catch {
        return false;
      }
    },

    async registerTracking(trackingNumber, options): Promise<TrackingRegistrationResult> {
      const normalized = normalizeTrackingNumber(trackingNumber);
      const body: Record<string, unknown> = {
        tracking_number: normalized
      };
      if (options?.carrierCode) body.slug = options.carrierCode.trim().toLowerCase();
      if (options?.shipmentId) body.order_id = options.shipmentId;
      if (options?.warehouseId) {
        body.custom_fields = { swim_warehouse_id: options.warehouseId };
      }

      const response = await request('/trackings', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const payload = await parseJsonResponse(response);
      const tracking = unwrapTracking(payload);
      const providerTrackingId = String(tracking.id || '').trim();
      if (!providerTrackingId) {
        throw new Error('AfterShip did not return a tracking ID.');
      }
      return {
        providerTrackingId,
        snapshot: normalizeTrackingObject({
          ...tracking,
          tracking_number: tracking.tracking_number || normalized
        })
      };
    },

    async fetchTracking(trackingNumber, providerTrackingId): Promise<CarrierTrackingSnapshot> {
      const normalized = normalizeTrackingNumber(trackingNumber);
      if (!providerTrackingId) {
        throw new Error('AfterShip tracking ID is required to refresh this shipment.');
      }
      const response = await request(`/trackings/${encodeURIComponent(providerTrackingId)}`, {
        method: 'GET'
      });
      const payload = await parseJsonResponse(response);
      return normalizeTrackingObject({
        ...unwrapTracking(payload),
        tracking_number: unwrapTracking(payload).tracking_number || normalized
      });
    },

    async parseWebhook(payload: any): Promise<TrackingRegistrationResult[]> {
      const eventId = String(payload?.event_id || '').trim();
      const tracking = payload?.msg || payload?.data?.tracking || payload?.tracking;
      if (!tracking) return [];
      const providerTrackingId = String(tracking.id || tracking.tracking_id || '').trim();
      if (!providerTrackingId) return [];

      const snapshot = normalizeTrackingObject(tracking);
      if (eventId && snapshot.checkpoints.length > 0) {
        const lastIndex = snapshot.checkpoints.length - 1;
        snapshot.checkpoints[lastIndex] = {
          ...snapshot.checkpoints[lastIndex],
          providerEventId: eventId
        };
      }
      return [{ providerTrackingId, snapshot }];
    }
  };
}
