import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlatformAdminEmail } from '../server/security.js';

test('platform admin matching is explicit and case-insensitive', () => {
  const configured = 'owner@example.com, second@example.com';
  assert.equal(isPlatformAdminEmail('OWNER@example.com', configured), true);
  assert.equal(isPlatformAdminEmail('user@example.com', configured), false);
});

test('platform admin access fails closed when no allowlist is configured', () => {
  assert.equal(isPlatformAdminEmail('owner@example.com', ''), false);
});
