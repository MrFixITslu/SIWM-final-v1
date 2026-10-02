export type SwimRole = 'admin' | 'manager' | 'operator' | 'viewer';

export type SwimPermission =
  | 'inventory.read'
  | 'inventory.adjust'
  | 'inventory.manage'
  | 'warehouse.read'
  | 'warehouse.manage'
  | 'suppliers.read'
  | 'suppliers.manage'
  | 'procurement.read'
  | 'procurement.write'
  | 'shipments.read'
  | 'shipments.write'
  | 'tracking.read'
  | 'tracking.write'
  | 'customs.read'
  | 'customs.calculate'
  | 'audit.read'
  | 'team.manage'
  | 'settings.manage'
  | 'destructive.manage';

const ROLE_PERMISSIONS: Record<SwimRole, ReadonlySet<SwimPermission>> = {
  admin: new Set<SwimPermission>([
    'inventory.read', 'inventory.adjust', 'inventory.manage',
    'warehouse.read', 'warehouse.manage',
    'suppliers.read', 'suppliers.manage',
    'procurement.read', 'procurement.write',
    'shipments.read', 'shipments.write',
    'tracking.read', 'tracking.write',
    'customs.read', 'customs.calculate',
    'audit.read', 'team.manage', 'settings.manage', 'destructive.manage',
  ]),
  manager: new Set<SwimPermission>([
    'inventory.read', 'inventory.adjust', 'inventory.manage',
    'warehouse.read',
    'suppliers.read', 'suppliers.manage',
    'procurement.read', 'procurement.write',
    'shipments.read', 'shipments.write',
    'tracking.read', 'tracking.write',
    'customs.read', 'customs.calculate',
    'audit.read',
  ]),
  operator: new Set<SwimPermission>([
    'inventory.read', 'inventory.adjust',
    'warehouse.read',
    'suppliers.read',
    'procurement.read',
    'shipments.read', 'shipments.write',
    'tracking.read', 'tracking.write',
    'customs.read', 'customs.calculate',
  ]),
  viewer: new Set<SwimPermission>([
    'inventory.read', 'warehouse.read', 'suppliers.read', 'procurement.read',
    'shipments.read', 'tracking.read', 'customs.read',
  ]),
};

export function normalizeRole(role: string | null | undefined): SwimRole {
  return role === 'admin' || role === 'manager' || role === 'operator' || role === 'viewer'
    ? role
    : 'viewer';
}

export function hasPermission(role: string | null | undefined, permission: SwimPermission): boolean {
  return ROLE_PERMISSIONS[normalizeRole(role)].has(permission);
}

export function permissionsForRole(role: string | null | undefined): SwimPermission[] {
  return [...ROLE_PERMISSIONS[normalizeRole(role)]];
}