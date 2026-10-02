import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  hashWorkspaceInvitationToken,
  invitationIsActive,
  invitedEmailMatches,
  isAssignableWorkspaceRole,
  maskInvitationEmail,
} from '../src/domain/invitations.js';

test('invitation tokens are stored as deterministic hashes, not raw bearer secrets', () => {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = hashWorkspaceInvitationToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashWorkspaceInvitationToken(token), hash);
});

test('invitation lifecycle rejects expired, accepted, and revoked invitations', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assert.equal(invitationIsActive({ expiresAt: '2026-10-02T12:00:00Z' }, now), true);
  assert.equal(invitationIsActive({ expiresAt: '2026-09-30T12:00:00Z' }, now), false);
  assert.equal(invitationIsActive({ expiresAt: '2026-10-02T12:00:00Z', acceptedAt: '2026-10-01T11:00:00Z' }, now), false);
  assert.equal(invitationIsActive({ expiresAt: '2026-10-02T12:00:00Z', revokedAt: '2026-10-01T11:00:00Z' }, now), false);
});

test('workspace invitations only allow explicit authorization roles', () => {
  assert.equal(isAssignableWorkspaceRole('operator'), true);
  assert.equal(isAssignableWorkspaceRole('admin'), true);
  assert.equal(isAssignableWorkspaceRole('engineer'), false);
  assert.equal(isAssignableWorkspaceRole('super-admin'), false);
});

test('invitation email matching is normalized and preview email is masked', () => {
  assert.equal(invitedEmailMatches('User@Example.com ', ' user@example.com'), true);
  assert.equal(invitedEmailMatches('user@example.com', 'other@example.com'), false);
  assert.equal(maskInvitationEmail('customer@example.com'), 'cu******@example.com');
});