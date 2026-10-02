import crypto from 'crypto';
import type { SwimRole } from './permissions.js';

export const WORKSPACE_INVITE_TTL_HOURS = 72;
const ASSIGNABLE_ROLES = new Set<SwimRole>(['admin', 'manager', 'operator', 'viewer']);

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAssignableWorkspaceRole(role: unknown): role is SwimRole {
  return typeof role === 'string' && ASSIGNABLE_ROLES.has(role as SwimRole);
}

export function hashWorkspaceInvitationToken(token: string): string {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw new Error('Invitation token is malformed.');
  }
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function maskInvitationEmail(email: string): string {
  const normalized = normalizeInvitationEmail(email);
  const [local, domain] = normalized.split('@');
  if (!local || !domain) return '***';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function invitationIsActive(
  invitation: { expiresAt: string | Date; acceptedAt?: string | Date | null; revokedAt?: string | Date | null },
  now = new Date(),
): boolean {
  if (invitation.acceptedAt || invitation.revokedAt) return false;
  const expires = new Date(invitation.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now.getTime();
}

export function invitedEmailMatches(invitedEmail: string, suppliedEmail: string): boolean {
  const expected = Buffer.from(normalizeInvitationEmail(invitedEmail), 'utf8');
  const supplied = Buffer.from(normalizeInvitationEmail(suppliedEmail), 'utf8');
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}