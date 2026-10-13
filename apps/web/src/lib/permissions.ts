/**
 * Permissoes no cliente: usadas APENAS para esconder acoes na interface.
 * A autorizacao real e do backend (nunca confie no frontend).
 */
import type { RoleKey } from './types';

/**
 * Itens de navegacao, agrupados pela frequencia de uso na operacao.
 * O agrupamento importa: quem despacha rota precisa ver "quem esta em
 * jornada" e "onde ele esta" sem passar pelas telas de cadastro.
 *
 * `icon` e a chave do componente em components/icons.tsx (nao o componente
 * direto) para manter este arquivo livre de JSX.
 */
export const NAV_GROUPS = [
  { id: 'operacao', label: 'Operacao' },
  { id: 'planejamento', label: 'Planejamento' },
  { id: 'analise', label: 'Analise' },
] as const;

export type NavGroupId = (typeof NAV_GROUPS)[number]['id'];

export const NAV_ITEMS = [
  { href: '/painel', label: 'Dashboard', group: 'operacao', icon: 'gauge', permission: 'journeys:read:all' },
  { href: '/painel/mapa', label: 'Mapa operacional', group: 'operacao', icon: 'map', permission: 'locations:read:all' },
  { href: '/painel/motoristas', label: 'Motoristas', group: 'operacao', icon: 'users', permission: 'drivers:read' },
  { href: '/painel/rotas', label: 'Rotas', group: 'planejamento', icon: 'route', permission: 'routes:read' },
  { href: '/painel/clientes', label: 'Clientes', group: 'planejamento', icon: 'store', permission: 'customers:read' },
  { href: '/painel/jornadas', label: 'Historico de jornadas', group: 'analise', icon: 'clock', permission: 'journeys:read:all' },
  { href: '/painel/alertas', label: 'Alertas', group: 'analise', icon: 'bell', permission: 'alerts:read' },
  { href: '/painel/relatorios', label: 'Relatorios', group: 'analise', icon: 'chart', permission: 'reports:read' },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavIconName = NavItem['icon'];

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

/**
 * Agrupa os itens visiveis pela ordem de NAV_GROUPS.
 * Grupos sem itens visiveis saem da lista — um cabecalho vazio so ocupa espaco.
 */
export function groupNav(
  items: readonly (typeof NAV_ITEMS)[number][],
): Array<{ id: NavGroupId; label: string; items: (typeof NAV_ITEMS)[number][] }> {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => item.group === group.id),
  })).filter((group) => group.items.length > 0);
}

export function isDemoDataset(roles: readonly RoleKey[]): boolean {
  // O painel sinaliza banco de demonstracao; a API expoe isDemo por registro.
  void roles;
  return true;
}
