import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  createUser,
  createWarehouse,
  findUnlinkedWarehousesByAdminEmail,
  findUserByEmail,
  findUserByHubWarehouseIdentity,
  findWarehouseByHubOrganizationId,
  linkUserWarehouseHubIdentity,
  linkWarehouseToHubOrganization,
  seedWarehouseData,
} from './server-db.js';

const MAX_SKEW_MS = 5 * 60 * 1000;

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : '';
}

function bodyHash(body: string) {
  return crypto.createHash('sha256').update(body || '').digest('hex');
}

function canonicalMessage(method: string, pathname: string, timestamp: string, body: string) {
  return [method.toUpperCase(), pathname, timestamp, bodyHash(body)].join('\n');
}

function safeEqualHex(leftValue: string, rightValue: string) {
  try {
    const left = Buffer.from(leftValue, 'hex');
    const right = Buffer.from(rightValue, 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function verifyHubPlatformRequest(req: Request, res: Response, next: NextFunction) {
  const secret = clean(process.env.V79_PLATFORM_SHARED_SECRET);
  const timestamp = clean(req.get('x-v79-timestamp'));
  const signature = clean(req.get('x-v79-signature'));
  const serviceId = clean(req.get('x-v79-service-id'));

  if (secret.length < 32) {
    return res.status(503).json({ error: 'V79 platform integration is not configured.' });
  }
  if (serviceId !== 'v79-hub' || !timestamp || !signature) {
    return res.status(401).json({ error: 'Invalid V79 platform credentials.' });
  }
  const when = Number(timestamp);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > MAX_SKEW_MS) {
    return res.status(401).json({ error: 'Expired V79 platform request.' });
  }

  const pathname = new URL(req.originalUrl, 'http://v79.internal').pathname;
  const body = ['GET', 'HEAD'].includes(req.method.toUpperCase())
    ? ''
    : ((req as any).rawBody?.toString('utf8') || JSON.stringify(req.body ?? {}));
  const expected = crypto
    .createHmac('sha256', secret)
    .update(canonicalMessage(req.method, pathname, timestamp, body))
    .digest('hex');

  if (!safeEqualHex(expected, signature)) {
    return res.status(401).json({ error: 'Invalid V79 platform signature.' });
  }
  next();
}

export async function consumeHubLaunchTicket(ticket: string) {
  const baseUrl = clean(process.env.V79_HUB_INTERNAL_URL);
  const secret = clean(process.env.V79_SIWM_LAUNCH_SECRET);
  if (!baseUrl) throw new Error('V79_HUB_INTERNAL_URL is not configured.');
  if (secret.length < 32) throw new Error('V79_SIWM_LAUNCH_SECRET must be at least 32 characters.');

  const pathname = '/api/platform/session/consume';
  const body = JSON.stringify({ ticket, product: 'siwm' });
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac('sha256', secret)
    .update(canonicalMessage('POST', pathname, timestamp, body))
    .digest('hex');

  const response = await fetch(new URL(pathname, baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-v79-service-id': 'v79-siwm',
      'x-v79-timestamp': timestamp,
      'x-v79-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(5000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `V79 Hub returned HTTP ${response.status}`);
  if (payload?.entitlement?.product !== 'siwm' || !payload?.entitlement?.enabled) {
    throw new Error('V79 SIWM entitlement was not granted.');
  }
  return payload;
}

export function hubPublicUrl() {
  return clean(process.env.V79_HUB_PUBLIC_URL) || 'https://hub.v79sl.com';
}

export async function provisionHubWarehouse(hubSession: any) {
  const organizationId = String(hubSession?.organization?.id || '').trim();
  const organizationName = String(hubSession?.organization?.name || '').trim();
  const hubUserId = String(hubSession?.user?.id || '').trim();
  const email = String(hubSession?.user?.email || '').trim().toLowerCase();
  const name = String(hubSession?.user?.name || email.split('@')[0] || '').trim();

  if (
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(organizationId) ||
    organizationName.length < 1 || organizationName.length > 100 ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(hubUserId) ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    name.length < 1 || name.length > 100 ||
    hubSession?.role !== 'owner'
  ) {
    throw new Error('Invalid V79 Hub SIWM owner identity.');
  }

  let warehouse = await findWarehouseByHubOrganizationId(organizationId);

  if (!warehouse) {
    const legacyCandidates = await findUnlinkedWarehousesByAdminEmail(email);
    if (legacyCandidates.length > 1) {
      throw new Error('Multiple legacy SIWM warehouses match this owner. Resolve the mapping before linking.');
    }
    if (legacyCandidates.length === 1) {
      warehouse = legacyCandidates[0];
      await linkWarehouseToHubOrganization(warehouse.id, organizationId);
    }
  }

  if (!warehouse) {
    const warehouseId = `wh-hub-${crypto.randomBytes(8).toString('hex')}`;
    const code = `HUB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await createWarehouse({
      id: warehouseId,
      name: organizationName,
      code,
      address: '',
      email,
      contact_name: name,
    });
    await linkWarehouseToHubOrganization(warehouseId, organizationId);
    await seedWarehouseData(warehouseId);
    warehouse = await findWarehouseByHubOrganizationId(organizationId);
  }

  if (!warehouse) throw new Error('SIWM warehouse provisioning failed.');

  let user = await findUserByHubWarehouseIdentity(warehouse.id, hubUserId);
  if (!user) user = await findUserByEmail(email);

  if (!user) {
    user = {
      id: `usr-hub-${crypto.randomBytes(8).toString('hex')}`,
      email,
      name,
      warehouseId: warehouse.id,
      provider: 'v79-hub',
      tokenVersion: 1,
    };
    await createUser(user);
  }

  await linkUserWarehouseHubIdentity(user.id, warehouse.id, hubUserId, 'admin');

  return {
    organizationId,
    hubUserId,
    warehouseId: warehouse.id,
    userId: user.id,
    email,
    name,
    tokenVersion: user.tokenVersion || 1,
  };
}
