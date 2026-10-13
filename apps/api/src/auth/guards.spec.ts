import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleKey } from '@prisma/client';
import { Permission } from '@rota/shared';
import {
  PermissionsGuard,
  Public,
  RequireAnyPermission,
  RequirePermissions,
  RequireRoles,
} from './guards';

/**
 * Testes do guard de permissao.
 *
 * Foco no ponto que ja causou bug: `RequirePermissions(A, B)` significa E,
 * enquanto o padrao "próprio OU todos" precisa de OU. Confundir os dois
 * trancava a jornada do proprio motorista.
 */

type Handler = (...args: never[]) => unknown;

function contextFor(handler: Handler, cls: unknown = class {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

let principal: {
  userId: string;
  email: string;
  name: string;
  roles: RoleKey[];
  permissions: Permission[];
  driverId: string | null;
};

const reflector = new Reflector();
const guard = new PermissionsGuard(reflector);

const admin: typeof principal = {
  userId: 'u-admin',
  email: 'admin@teste.invalid',
  name: 'Admin',
  roles: [RoleKey.ADMINISTRADOR],
  permissions: [],
  driverId: null,
};

const driver: typeof principal = {
  userId: 'u-driver',
  email: 'motorista@teste.invalid',
  name: 'Motorista',
  roles: [RoleKey.MOTORISTA],
  permissions: [],
  driverId: 'drv-1',
};

function run(handler: Handler, who: typeof principal, cls?: unknown): boolean {
  principal = who;
  return guard.canActivate(contextFor(handler, cls));
}

describe('PermissionsGuard', () => {
  it('rota publica passa sem principal', () => {
    class C {}
    Public()(C.prototype as never, 'm', Object.getOwnPropertyDescriptor(C.prototype, 'm')!);
    principal = undefined as unknown as typeof principal;
    expect(guard.canActivate(contextFor(() => undefined, C))).toBe(true);
  });

  describe('semantica E (RequirePermissions)', () => {
    it('nega quando falta uma das varias exigidas', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequirePermissions(Permission.JOURNEYS_READ_OWN, Permission.ROUTES_READ)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      // O motorista tem apenas a primeira.
      expect(() => run(M.prototype.m, driver, C)).toThrow(ForbiddenException);
    });

    it('aceita quem tem todas', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequirePermissions(Permission.JOURNEYS_READ_OWN, Permission.ROUTES_READ)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      const both: typeof principal = { ...driver, permissions: [Permission.ROUTES_READ] };
      expect(run(M.prototype.m, both, C)).toBe(true);
    });
  });

  describe('semantica OU (RequireAnyPermission)', () => {
    it('aceita o motorista pela permissao "proprio"', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequireAnyPermission(Permission.JOURNEYS_READ_OWN, Permission.ROUTES_READ)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      expect(run(M.prototype.m, driver, C)).toBe(true);
    });

    it('aceita o administrador pela permissao "todos"', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequireAnyPermission(Permission.JOURNEYS_READ_OWN, Permission.ROUTES_READ)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      expect(run(M.prototype.m, admin, C)).toBe(true);
    });

    it('nega quem nao tem nenhuma das duas', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequireAnyPermission(Permission.ROUTES_READ, Permission.LOCATIONS_READ_ALL)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      expect(() => run(M.prototype.m, driver, C)).toThrow(ForbiddenException);
    });

    it('a mensagem lista as alternativas, nao "faltando"', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequireAnyPermission(Permission.ROUTES_READ, Permission.ROUTES_WRITE)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      expect(() => run(M.prototype.m, driver, C)).toThrow(/requer uma de/);
    });
  });

  describe('perfis', () => {
    it('RequireRoles aceita um dos perfis', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequireRoles(RoleKey.ADMINISTRADOR, RoleKey.SUPERVISOR)(
        M.prototype,
        'm',
        Object.getOwnPropertyDescriptor(M.prototype, 'm')!,
      );
      expect(run(M.prototype.m, admin, C)).toBe(true);
      expect(() => run(M.prototype.m, driver, C)).toThrow(ForbiddenException);
    });

    it('sem exigencia, passa', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      expect(run(M.prototype.m, driver, C)).toBe(true);
    });

    it('sem principal autenticado, nega', () => {
      class C {}
      class M {
        m() {
          return undefined;
        }
      }
      RequireRoles(RoleKey.ADMINISTRADOR)(M.prototype, 'm', Object.getOwnPropertyDescriptor(M.prototype, 'm')!);
      principal = undefined as unknown as typeof principal;
      expect(() => guard.canActivate(contextFor(M.prototype.m, C))).toThrow(ForbiddenException);
    });
  });
});