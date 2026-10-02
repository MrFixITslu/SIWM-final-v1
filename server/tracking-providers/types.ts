import type { TrackingCheckpoint } from '../../src/domain/tracking.js';

export interface TrackingSubscriptionRequest {
  trackingNumber: string;
  carrierHint?: string;
  title?: string;
}

export interface TrackingSubscriptionResult {
  providerKey: string;
  externalTrackerId: string;
  trackingNumber: string;
  carrier?: string;
  checkpoints: TrackingCheckpoint[];
}

export interface ServerTrackingProvider {
  readonly providerKey: string;
  createSubscription(input: TrackingSubscriptionRequest): Promise<TrackingSubscriptionResult>;
  fetchTracking(input: {
    externalTrackerId: string;
    trackingNumber: string;
    carrier?: string;
  }): Promise<TrackingSubscriptionResult>;
}
