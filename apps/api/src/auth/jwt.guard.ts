import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { AccessTokenPayload } from './auth.service';
import { AuthPrincipal, IS_PUBLIC_KEY } from './guards';

/**
 * Autenticacao por JWT de curta duracao.
 * Rotacao de refresh token em AuthService. Sem passport: menos dependencias e
 * menos superficie de ataque.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { principal?: AuthPrincipal }>();
    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Token de acesso ausente.');
    }
    const token = header.slice(7).trim();
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.auth.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Token de acesso invalido ou expirado.');
    }
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Tipo de token invalido.');
    }
    request.principal = {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      roles: payload.roles,
      permissions: payload.permissions,
      driverId: payload.driverId,
    };
    return true;
  }
}
