import type { ShipmentMode } from './shipping.js';

export interface FreightForwarderRecord {
  id: string;
  warehouseId: string;
  name: string;
  countryCode: string;
  facilityCode?: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  accountReference?: string;
  receivingInstructions?: string;
  serviceModes: ShipmentMode[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function forwarderSupportsMode(
  forwarder: Pick<FreightForwarderRecord, 'active' | 'serviceModes'>,
  mode: ShipmentMode,
): boolean {
  return forwarder.active && (forwarder.serviceModes.length === 0 || forwarder.serviceModes.includes(mode));
}

export function formatForwarderDestination(
  forwarder: Pick<FreightForwarderRecord, 'name' | 'facilityCode' | 'address' | 'countryCode'>,
): string {
  return [
    forwarder.name,
    forwarder.facilityCode,
    forwarder.address,
    forwarder.countryCode,
  ].filter(Boolean).join(' · ');
}
