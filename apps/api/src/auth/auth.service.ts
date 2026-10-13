import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { DriverStatus, RoleKey, UserStatus } from '@prisma/client';
import { Permission, permissionsForRoles } from '@rota/shared';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { AuthPrincipal } from './guards';
import {
  checkPasswordPolicy,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from './password';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  roles: RoleKey[];
  driverId: string | null;
  permissions: Permission[];
  typ: 'access';
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    roles: RoleKey[];
    permissions: Permission[];
    driverId: string | null;
    mustChangePassword: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(
    email: string,
    password: string,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<AuthResult> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: {
        roles: { include: { role: true } },
        driver: true,
      },
    });

    // Mensagem generica: nao revela se o e-mail existe.
    const invalid = new UnauthorizedException('Credenciais invalidas.');

    if (!user) {
      // Custo constante: ainda calculamos um hash para nao vazar tempo por e-mail.
      await verifyPassword(password, `scrypt$16384$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`);
      await this.audit.record({ action: 'auth.login.failed', entity: 'User', actorEmail: normalized, ...meta });
      throw invalid;
    }
    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('Conta bloqueada. Procure o administrador.');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(
        `Conta temporariamente bloqueada por tentativas falhas. Tente novamente em ${Math.ceil(
          (user.lockedUntil.getTime() - Date.now()) / 60000,
        )} minuto(s).`,
      );
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const shouldLock = failures >= this.config.auth.maxFailedLogins;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: shouldLock ? 0 : failures,
          lockedUntil: shouldLock
            ? new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000)
            : user.lockedUntil,
        },
      });
      await this.audit.record({ action: 'auth.login.failed', entity: 'User', actorId: user.id, actorEmail: user.email, ...meta });
      throw invalid;
    }
    if (user.status === UserStatus.PENDING_ACTIVATION) {
      throw new ForbiddenException('Conta nao ativada. Defina a senha pelo link de recuperacao.');
    }
    if (
      user.roles.some((r) => r.role.key === RoleKey.MOTORISTA) &&
      user.driver &&
      user.driver.status !== DriverStatus.ATIVO
    ) {
      throw new ForbiddenException('Cadastro de motorista inativo. Procure o administrador.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });

    const principal = this.toPrincipal(user);
    const result = await this.issueTokens(principal, meta);
    await this.audit.record({
      action: 'auth.login.success',
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      actorRole: principal.roles.join(','),
      ...meta,
    });
    return result;
  }

  /**
   * Rotacao de refresh token. Reuso de um token ja revogado revoke a familia
   * inteira (sinal de token vazado).
   */
  async refresh(refreshToken: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<AuthResult> {
    if (!refreshToken) throw new UnauthorizedException('Refresh token ausente.');
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { roles: { include: { role: true } }, driver: true } } },
    });
    if (!stored) throw new UnauthorizedException('Sessao invalida.');

    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: 'auth.refresh.reuse_detected',
        entity: 'User',
        entityId: stored.userId,
        actorId: stored.userId,
        ...meta,
      });
      throw new UnauthorizedException('Sessao revogada por reuso de token.');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Sessao expirada. Autentique-se novamente.');
    }
    if (stored.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Conta nao ativa.');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const principal = this.toPrincipal(stored.user);
    const result = await this.issueTokens(principal, meta, stored.familyId);
    await this.audit.record({
      action: 'auth.refresh.success',
      entity: 'User',
      entityId: stored.userId,
      actorId: stored.userId,
      ...meta,
    });
    return result;
  }

  async logout(refreshToken: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<{ revoked: boolean }> {
    if (!refreshToken) return { revoked: false };
    const result = await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await this.audit.record({ action: 'auth.logout', entity: 'User', ...meta });
    }
    return { revoked: result.count > 0 };
  }

  async me(userId: string): Promise<AuthResult['user']> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } }, driver: true },
    });
    if (!user) throw new UnauthorizedException('Usuario nao encontrado.');
    const principal = this.toPrincipal(user);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: principal.roles,
      permissions: principal.permissions,
      driverId: principal.driverId,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ changed: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuario nao encontrado.');
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta.');
    const policy = checkPasswordPolicy(newPassword);
    if (!policy.ok) throw new ForbiddenException(policy.problems.join(' '));
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw new ForbiddenException('A nova senha deve ser diferente da atual.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
    });
    // Troca de senha invalida todas as sessoes.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ action: 'auth.password.changed', entity: 'User', entityId: userId, actorId: userId, ...meta });
    return { changed: true };
  }

  /**
   * Recuperacao de senha. A resposta e SEMPRE identica, exista ou nao o
   * usuario, para nao permitir enumeracao de contas.
   */
  async requestPasswordReset(
    email: string,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ accepted: true; token?: string }> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      this.logger.log(`Recuperacao solicitada para e-mail inexistente (resposta generica).`);
      return { accepted: true };
    }
    const token = randomToken(32);
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    await this.audit.record({ action: 'auth.password.reset_requested', entity: 'User', entityId: user.id, actorId: user.id, ...meta });
    // Em producao o envio real (e-mail) precisa de um provedor configurado.
    // O token e devolvido apenas fora de producao para permitir o fluxo de teste.
    return this.config.isProduction ? { accepted: true } : { accepted: true, token };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ reset: boolean }> {
    const policy = checkPasswordPolicy(newPassword);
    if (!policy.ok) throw new ForbiddenException(policy.problems.join(' '));
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Token de recuperacao invalido ou expirado.');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, status: UserStatus.ACTIVE },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({ action: 'auth.password.reset_completed', entity: 'User', entityId: stored.userId, actorId: stored.userId, ...meta });
    return { reset: true };
  }

  private toPrincipal(user: {
    id: string; email: string; name: string;
    roles: Array<{ role: { key: RoleKey } }>;
    driver: { id: string } | null;
  }): AuthPrincipal {
    const roles = user.roles.map((r) => r.role.key);
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      roles,
      permissions: permissionsForRoles(roles),
      driverId: user.driver?.id ?? null,
    };
  }

  private async issueTokens(
    principal: AuthPrincipal,
    meta: { ip?: string | null; userAgent?: string | null },
    familyId?: string,
  ): Promise<AuthResult> {
    const payload: AccessTokenPayload = {
      sub: principal.userId,
      email: principal.email,
      name: principal.name,
      roles: principal.roles,
      driverId: principal.driverId,
      permissions: principal.permissions,
      typ: 'access',
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.auth.accessSecret,
      expiresIn: this.config.auth.accessTtlSeconds,
    });
    const refreshToken = randomToken(48);
    const user = await this.prisma.user.findUnique({ where: { id: principal.userId } });
    await this.prisma.refreshToken.create({
      data: {
        userId: principal.userId,
        tokenHash: sha256(refreshToken),
        familyId: familyId ?? randomUUID(),
        expiresAt: new Date(Date.now() + this.config.auth.refreshTtlDays * 86_400_000),
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip ?? null,
      },
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.auth.accessTtlSeconds,
      user: {
        id: principal.userId,
        email: principal.email,
        name: principal.name,
        roles: principal.roles,
        permissions: principal.permissions,
        driverId: principal.driverId,
        mustChangePassword: user?.mustChangePassword ?? false,
      },
    };
  }
}
