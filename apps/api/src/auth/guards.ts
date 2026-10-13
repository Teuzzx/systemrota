import { createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RoleKey } from '@prisma/client';
import { Permission, permissionsForRoles } from '@rota/shared';

export interface AuthPrincipal {
  userId: string;
  email: string;
  name: string;
  roles: RoleKey[];
  permissions: Permission[];
  driverId: string | null;
}

export const IS_PUBLIC_KEY = 'rota:isPublic';
/** Marca rota como publica. Applied via @Public(). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRED_PERMISSIONS_KEY = 'rota:permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

export const REQUIRED_ROLES_KEY = 'rota:roles';
export const RequireRoles = (...roles: RoleKey[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

/** Injeta o principal autenticado nos handlers. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request & { principal?: AuthPrincipal }>();
    const principal = request.principal;
    if (!principal) {
      throw new ForbiddenException('Contexto autenticado ausente.');
    }
    return principal;
  },
);

/**
 * OBRIGATORIO: verificar permissao no backend.
 * A UI esconder botoes e conveniencia, nunca controle de acesso.
 *
 * O @Injectable() e essencial: sem decorator na classe, o TypeScript nao emite
 * os metadados de injecao e o Reflector chegaria indefinido.
 */
@Injectable()
export class PermissionsGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<RoleKey[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: AuthPrincipal }>();
    const principal = request.principal;
    if (!principal) throw new ForbiddenException('Autenticacao necessaria.');

    if (requiredRoles?.length) {
      const ok = requiredRoles.some((role) => principal.roles.includes(role));
      if (!ok) {
        throw new ForbiddenException(
          `Perfil nao autorizado. Requer: ${requiredRoles.join(' ou ')}.`,
        );
      }
    }
    if (required?.length) {
      const granted = new Set<Permission>([
        ...permissionsForRoles(principal.roles),
        ...principal.permissions,
      ]);
      const missing = required.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        throw new ForbiddenException(`Permissao negada: ${missing.join(', ')}.`);
      }
    }
    return true;
  }
}
