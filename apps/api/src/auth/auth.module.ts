import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { PermissionsGuard } from './guards';

@Global()
@Module({
  imports: [
    JwtModule.register({
      // segredo e expiracao sao aplicados por chamada (AuthService / JwtAuthGuard)
      // para que o valor venha da configuracao validada no boot.
      global: true,
      signOptions: {},
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Ordem importa: autenticacao antes de autorizacao.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
