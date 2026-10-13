/**
 * Matriz de permissoes. A UI usa esta matriz para esconder acoes, mas a
 * validacao real acontece no backend (JwtAuthGuard + PermissionsGuard).
 * Esconder um botao nunca substitui a verificacao no servidor.
 */
import { RoleKey } from './enums';

export const Permission = {
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',

  DRIVERS_READ: 'drivers:read',
  DRIVERS_WRITE: 'drivers:write',

  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_WRITE: 'customers:write',
  CUSTOMERS_IMPORT: 'customers:import',
  CUSTOMERS_EXPORT: 'customers:export',

  ROUTES_READ: 'routes:read',
  ROUTES_WRITE: 'routes:write',
  ROUTES_OPTIMIZE: 'routes:optimize',
  ROUTES_PUBLISH: 'routes:publish',

  JOURNEYS_READ_ALL: 'journeys:read:all',
  JOURNEYS_READ_OWN: 'journeys:read:own',
  JOURNEYS_WRITE_OWN: 'journeys:write:own',

  VISITS_WRITE_OWN: 'visits:write:own',

  OCCURRENCES_READ: 'occurrences:read',
  OCCURRENCES_WRITE_OWN: 'occurrences:write:own',

  LOCATIONS_READ_ALL: 'locations:read:all',
  LOCATIONS_READ_OWN: 'locations:read:own',

  ALERTS_READ: 'alerts:read',
  ALERTS_MANAGE: 'alerts:manage',

  REPORTS_READ: 'reports:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  AUDIT_READ: 'audit:read',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ADMIN_ALL: Permission[] = Object.values(Permission);

/**
 * SUPERVISOR: leitura operacional, sem escrita administrativa e, por padrao,
 * sem acesso a historico bruto de localizacao de outros motoristas
 * (exige autorizacao explicita - ver docs/PENDENCIAS.md).
 */
const SUPERVISOR_PERMISSIONS: Permission[] = [
  Permission.DRIVERS_READ,
  Permission.CUSTOMERS_READ,
  Permission.ROUTES_READ,
  Permission.JOURNEYS_READ_ALL,
  Permission.OCCURRENCES_READ,
  Permission.ALERTS_READ,
  Permission.REPORTS_READ,
];

const DRIVER_PERMISSIONS: Permission[] = [
  Permission.JOURNEYS_READ_OWN,
  Permission.JOURNEYS_WRITE_OWN,
  Permission.VISITS_WRITE_OWN,
  Permission.OCCURRENCES_WRITE_OWN,
  Permission.LOCATIONS_READ_OWN,
];

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  [RoleKey.ADMINISTRADOR]: ADMIN_ALL,
  [RoleKey.SUPERVISOR]: SUPERVISOR_PERMISSIONS,
  [RoleKey.MOTORISTA]: DRIVER_PERMISSIONS,
};

export function permissionsForRoles(roles: readonly RoleKey[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  return [...set];
}

export function roleHasPermission(role: RoleKey, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function can(
  roles: readonly RoleKey[],
  permissions: readonly Permission[],
  required: Permission,
): boolean {
  const granted = new Set(permissionsForRoles(roles));
  for (const p of permissions) granted.add(p);
  return granted.has(required);
}
