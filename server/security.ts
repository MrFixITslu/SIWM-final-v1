import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { verifyLiveUserAccess } from '../server-db.js';
import { hasPermission, type SwimPermission } from '../src/domain/permissions.js';

const isProduction = process.env.NODE_ENV === 'production';

function requiredSecret(name: string, developmentFallback: string): string {
  const value = process.env[name]?.trim();
  if (value && Buffer.byteLength(value, 'utf8') >= 32) return value;
  if (isProduction) {
    throw new Error(`FATAL: ${name} must be configured with at least 32 bytes in production.`);
  }
  console.warn(`WARNING: ${name} is not securely configured; using a development-only fallback.`);
  return developmentFallback;
}

export const JWT_SECRET = requiredSecret(
  'JWT_SECRET',
  'swim-development-only-jwt-secret-change-before-production',
);

export interface SessionClaims {
  id: string;
  email: string;
  name?: string;
  warehouseId: string;
  tokenVersion: number;
  role?: string;
}

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '12h',
    issuer: 'swim.v79',
    audience: 'swim-api',
  });
}

export const authenticateToken: RequestHandler = (req: any, res, next) => {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Access token required. Please sign in.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Access token required. Please sign in.' });
    return;
  }

  let decoded: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'swim.v79',
      audience: 'swim-api',
    });
    if (typeof verified === 'string') throw new Error('Unexpected JWT payload');
    decoded = verified;
  } catch {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  const id = typeof decoded.id === 'string' ? decoded.id : '';
  const warehouseId = typeof decoded.warehouseId === 'string' ? decoded.warehouseId : '';
  const tokenVersion = Number(decoded.tokenVersion);
  if (!id || !warehouseId || !Number.isInteger(tokenVersion) || tokenVersion < 1) {
    res.status(401).json({ error: 'Session claims are incomplete. Please sign in again.' });
    return;
  }

  void (async () => {
    try {
      const live = await verifyLiveUserAccess(id, warehouseId, tokenVersion);
      if (!live.valid) {
        if (live.reason === 'SESSION_REVOKED') {
          res.status(401).json({ error: 'This session has been revoked. Please sign in again.', code: 'SESSION_REVOKED' });
          return;
        }
        res.status(403).json({ error: 'Warehouse membership is no longer active.' });
        return;
      }
      req.user = {
        id,
        email: typeof decoded.email === 'string' ? decoded.email : '',
        name: typeof decoded.name === 'string' ? decoded.name : '',
        warehouseId,
        tokenVersion,
        role: live.role,
      };
      next();
    } catch (error) {
      // Fail closed. A database/authorization outage must never turn a signed JWT
      // into an authorization bypass.
      console.error('Live authorization check failed:', error);
      res.status(503).json({ error: 'Authorization service is temporarily unavailable. Please retry.' });
    }
  })();
};

export function requirePermission(permission: SwimPermission): RequestHandler {
  return (req: any, res, next) => {
    if (!req.user || !hasPermission(req.user.role, permission)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

export const writeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many write requests. Please slow down and retry.' },
});

export function validatePassword(password: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof password !== 'string') return { ok: false, error: 'Password is required.' };
  if (password.length < 12) return { ok: false, error: 'Password must be at least 12 characters long.' };
  if (password.length > 128) return { ok: false, error: 'Password must be 128 characters or fewer.' };
  const normalized = password.toLowerCase();
  const blocked = ['password123', 'letmein123456', 'qwerty123456', 'admin123456'];
  if (blocked.some((value) => normalized.includes(value))) {
    return { ok: false, error: 'Choose a less predictable password or passphrase.' };
  }
  return { ok: true };
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function newWarehouseCode(): string {
  return `SW-${crypto.randomInt(10_000_000, 100_000_000)}`;
}

export function isPlatformAdminEmail(
  email: string | null | undefined,
  configured = process.env.SWIM_PLATFORM_ADMIN_EMAILS || '',
): boolean {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return false;
  const allowed = new Set(
    configured.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(normalized);
}

export const requirePlatformAdmin: RequestHandler = (req: any, res, next) => {
  const configured = (process.env.SWIM_PLATFORM_ADMIN_EMAILS || '').trim();
  if (!configured) {
    res.status(503).json({ error: 'Platform administration is not configured.' });
    return;
  }
  if (!req.user || !isPlatformAdminEmail(req.user.email, configured)) {
    res.status(403).json({ error: 'Platform administrator access is required.' });
    return;
  }
  next();
};
