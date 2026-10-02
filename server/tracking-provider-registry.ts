import type { ServerTrackingProvider } from './tracking-providers/types.js';
import { AfterShipTrackingProvider } from './tracking-providers/aftership.js';

export function configuredTrackingProvider(): ServerTrackingProvider {
  const provider = (process.env.SWIM_TRACKING_PROVIDER || '').trim().toLowerCase();
  if (!provider) throw new Error('No SWIM tracking provider is configured.');
  if (provider === 'aftership') return new AfterShipTrackingProvider();
  throw new Error('Configured SWIM tracking provider is not supported.');
}
