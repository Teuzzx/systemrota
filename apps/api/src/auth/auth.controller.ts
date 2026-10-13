import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuthResult, AuthService } from './auth.service';
import { CurrentUser, Public } from './guards';
import { AuthPrincipal } from './guards';

class LoginDto {
  @IsEmail({}, { message: 'Informe um e-mail valido.' })
  @MaxLength(180)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

class RefreshDto {
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}

class ForgotPasswordDto {
  @IsEmail({}, { message: 'Informe um e-mail valido.' })
  @MaxLength(180)
  email!: string;
}

class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/, {
    message: 'A senha deve ter ao menos 8 caracteres, com letra minuscula, maiuscula e digito.',
  })
  newPassword!: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200)
  currentPassword!: string;

  @IsString() @MinLength(8) @MaxLength(200)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/, {
    message: 'A senha deve ter ao menos 8 caracteres, com letra minuscula, maiuscula e digito.',
  })
  newPassword!: string;
}

function requestMeta(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  };
}

@ApiTags('Autenticacao')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Autentica o usuario e emite access + refresh token.' })
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.login(dto.email, dto.password, requestMeta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotaciona o refresh token. Reuso de token revoga a familia.' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.refresh(dto.refreshToken, requestMeta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga o refresh token informado.' })
  logout(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.logout(dto.refreshToken, requestMeta(req));
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Solicita recuperacao de senha.',
    description: 'Resposta sempre identica para nao permitir enumeracao de contas.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const result = await this.auth.requestPasswordReset(dto.email, requestMeta(req));
    // Mensagem unica, independente de o e-mail existir.
    return {
      accepted: true,
      message: 'Se o e-mail estiver cadastrado, enviaremos as instrucoes de recuperacao.',
      // Somente fora de producao, para permitir o fluxo de teste automatizado.
      token: result.token ?? null,
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Define nova senha usando token de recuperacao.' })
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto.token, dto.newPassword, requestMeta(req));
  }

  @Get('me')
  @ApiOperation({ summary: 'Dados do usuario autenticado e suas permissoes efetivas.' })
  me(@CurrentUser() principal: AuthPrincipal) {
    return this.auth.me(principal.userId);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Troca a senha do usuario autenticado e encerra as sessoes.' })
  changePassword(
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(principal.userId, dto.currentPassword, dto.newPassword, requestMeta(req));
  }
}
