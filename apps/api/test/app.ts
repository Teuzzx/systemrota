// reflect-metadata e obrigatorio ANTES de qualquer decorator do Nest: sem ele
// o container nao consegue ler os metadados de injecao de dependencias.
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/configuration';
import { loadConfig } from '../src/config/configuration';
import { PrismaService } from '../src/common/prisma.service';
import { setTestPrisma } from './fixtures';

export interface TestApp {
  app: INestApplication;
  close: () => Promise<void>;
}

/**
 * Cria a aplicacao Nest completa (banco real, guards reais, validacao real).
 * A autenticacao NUNCA e desabilitada nos testes: os testes usam login real.
 */
export async function createTestApp(): Promise<TestApp> {
  process.env.NODE_ENV = 'test';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.init();
  // O PGlite aceita uma unica conexao por vez: os testes reutilizam o mesmo
  // PrismaClient da aplicacao em vez de abrir um segundo.
  setTestPrisma(app.get(PrismaService));
  return {
    app,
    close: async () => {
      await app.close();
    },
  };
}

export function testConfig() {
  return loadConfig();
}

export const APP_CONFIG_TOKEN = APP_CONFIG;
