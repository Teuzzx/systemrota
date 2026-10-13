import { describe, expect, it } from 'vitest';
import { can, grantedPermissions, NAV_ITEMS, visibleNavItems } from './permissions';
import type { RoleKey } from './types';

describe('Permissoes por perfil', () => {
  it('administrador tem acesso completo', () => {
    const roles: RoleKey[] = ['ADMINISTRADOR'];
    for (const item of NAV_ITEMS) {
      expect(can(roles, [], item.permission)).toBe(true);
    }
    expect(can(roles, [], 'audit:read')).toBe(true);
  });

  it('supervisor tem leitura operacional sem escrita administrativa', () => {
    const roles: RoleKey[] = ['SUPERVISOR'];
    expect(can(roles, [], 'journeys:read:all')).toBe(true);
    expect(can(roles, [], 'reports:read')).toBe(true);
    expect(can(roles, [], 'routes:write')).toBe(false);
    expect(can(roles, [], 'settings:write')).toBe(false);
    expect(can(roles, [], 'users:write')).toBe(false);
  });

  it('motorista nao ve itens administrativos na navegacao', () => {
    const roles: RoleKey[] = ['MOTORISTA'];
    expect(visibleNavItems(roles)).toHaveLength(0);
  });

  it('permissoes concedidas pelo servidor complementam o perfil', () => {
    const roles: RoleKey[] = ['SUPERVISOR'];
    expect(can(roles, [], 'routes:write')).toBe(false);
    // Concessao explicita registrada no banco.
    expect(can(roles, ['routes:write'], 'routes:write')).toBe(true);
  });

  it('agrupa permissoes sem duplicar', () => {
    const set = grantedPermissions(['ADMINISTRADOR', 'ADMINISTRADOR'], ['customers:read']);
    expect(set.has('customers:read')).toBe(true);
    expect(set.size).toBeGreaterThan(10);
  });

  it('nenhum perfil recebe permissao de outro por acidente', () => {
    expect(can(['SUPERVISOR'], [], 'locations:read:all')).toBe(false);
    expect(can(['MOTORISTA'], [], 'alerts:manage')).toBe(false);
  });
});
