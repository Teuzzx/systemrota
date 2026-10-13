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
/** Semantica E: o chamador precisa de TODAS as permissoes listadas. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Semantica OU: basta UMA das permissoes listadas.
 *
 * Existe separada da anterior porque os dois casos aparecem de verdade no
 * projeto, e misturar os dois num so decorador ja causou bug: o padrao
 * "proprio OU todos" (`journeys:read:own` OU `journeys:read:all`) escrito com
 * `RequirePermissions` exige as DUAS — e como nenhum perfil tem as duas, nem
 * o motorista conseguia abrir a propria jornada nem o administrador a de
 * outrem. O guard calcula "quais faltam" (filter), nao "falta alguma".
 *
 * Ao criar rota com escopo "proprio ou todos", use ESTE decorador.
 */
export const REQUIRED_ANY_PERMISSION_KEY = 'rota:permissionsAny';
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_ANY_PERMISSION_KEY, permissions);

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
    const requiredAny = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_ANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<RoleKey[]>(REQUIRED_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !requiredAny?.length && !requiredRoles?.length) return true;

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
      // AND: todas precisam estar concedidas.
      const missing = required.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        throw new ForbiddenException(`Permissao negada: ${missing.join(', ')}.`);
      }
    }
    if (requiredAny?.length) {
      const granted = new Set<Permission>([
        ...permissionsForRoles(principal.roles),
        ...principal.permissions,
      ]);
      // OR: uma basta.
      const ok = requiredAny.some((p) => granted.has(p));
      if (!ok) {
        throw new ForbiddenException(
          `Permissao negada: requer uma de ${requiredAny.join(', ')}.`,
        );
      }
    }
    return true;
  }
}
