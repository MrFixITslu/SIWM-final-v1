import test from 'node:test';
import assert from 'node:assert/strict';
import { formatForwarderDestination, forwarderSupportsMode } from '../src/domain/forwarders.js';

test('freight forwarder mode support respects active status and configured modes', () => {
  assert.equal(forwarderSupportsMode({ active:true, serviceModes:['AIR','OCEAN'] }, 'AIR'), true);
  assert.equal(forwarderSupportsMode({ active:true, serviceModes:['AIR'] }, 'OCEAN'), false);
  assert.equal(forwarderSupportsMode({ active:false, serviceModes:[] }, 'AIR'), false);
});

test('freight forwarder destination is human readable', () => {
  assert.equal(formatForwarderDestination({
    name:'Miami Consolidation Hub',
    facilityCode:'MIA-01',
    address:'123 Cargo Way',
    countryCode:'US',
  }), 'Miami Consolidation Hub · MIA-01 · 123 Cargo Way · US');
});
