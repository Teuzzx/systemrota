/**
 * Permissoes no cliente: usadas APENAS para esconder acoes na interface.
 * A autorizacao real e do backend (nunca confie no frontend).
 */
import type { RoleKey } from './types';

export const NAV_ITEMS = [
  { href: '/painel', label: 'Dashboard', permission: 'journeys:read:all' },
  { href: '/painel/mapa', label: 'Mapa operacional', permission: 'locations:read:all' },
  { href: '/painel/motoristas', label: 'Motoristas', permission: 'drivers:read' },
  { href: '/painel/rotas', label: 'Rotas', permission: 'routes:read' },
  { href: '/painel/clientes', label: 'Clientes', permission: 'customers:read' },
  { href: '/painel/jornadas', label: 'Historico de jornadas', permission: 'journeys:read:all' },
  { href: '/painel/alertas', label: 'Alertas', permission: 'alerts:read' },
  { href: '/painel/relatorios', label: 'Relatorios', permission: 'reports:read' },
] as const;

const MATRIX: Record<RoleKey, readonly string[]> = {
  ADMINISTRADOR: [
    'users:read', 'users:write', 'drivers:read', 'drivers:write',
    'customers:read', 'customers:write', 'customers:import', 'customers:export',
    'routes:read', 'routes:write', 'routes:optimize', 'routes:publish',
    'journeys:read:all', 'locations:read:all', 'alerts:read', 'alerts:manage',
    'reports:read', 'settings:read', 'settings:write', 'audit:read',
  ],
  SUPERVISOR: [
    'drivers:read', 'customers:read', 'routes:read', 'journeys:read:all',
    'occurrences:read', 'alerts:read', 'reports:read',
  ],
  MOTORISTA: ['journeys:read:own', 'journeys:write:own', 'visits:write:own'],
};

export function grantedPermissions(
  roles: readonly RoleKey[],
  explicit: readonly string[] = [],
): Set<string> {
  const set = new Set<string>(explicit);
  for (const role of roles) for (const p of MATRIX[role] ?? []) set.add(p);
  return set;
}

export function can(
  roles: readonly RoleKey[],
  permissions: readonly string[],
  required: string,
): boolean {
  return grantedPermissions(roles, permissions).has(required);
}

export function visibleNavItems(
  roles: readonly RoleKey[],
  permissions: readonly string[] = [],
): typeof NAV_ITEMS[number][] {
  return NAV_ITEMS.filter((item) => can(roles, permissions, item.permission));
}

export function isDemoDataset(roles: readonly RoleKey[]): boolean {
  // O painel sinaliza banco de demonstracao; a API expoe isDemo por registro.
  void roles;
  return true;
}
