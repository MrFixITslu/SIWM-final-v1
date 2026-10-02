import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, normalizeRole } from '../src/domain/permissions.js';

test('unknown roles fail down to viewer', () => {
  assert.equal(normalizeRole('super-admin'), 'viewer');
  assert.equal(hasPermission('super-admin', 'team.manage'), false);
  assert.equal(hasPermission('super-admin', 'inventory.read'), true);
});

test('operators can execute warehouse work but cannot administer tenants', () => {
  assert.equal(hasPermission('operator', 'inventory.adjust'), true);
  assert.equal(hasPermission('operator', 'tracking.write'), true);
  assert.equal(hasPermission('operator', 'team.manage'), false);
  assert.equal(hasPermission('operator', 'destructive.manage'), false);
});

test('admin retains explicit destructive permission', () => {
  assert.equal(hasPermission('admin', 'destructive.manage'), true);
});