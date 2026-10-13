import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { defaultDataDir, isPgliteRunning, startPglite } from '../db/pglite';

/**
 * Monta as opcoes do Prisma conforme o transporte configurado.
 *
 * - engine: binario nativo (producao com PostgreSQL). Suporta prepared
 *   statements e pool de conexoes.
 * - pg-adapter: node-postgres por baixo (verificacao local com PGlite). O SQL
 *   enviado e o MESMO; muda apenas o transporte do protocolo de wire.
 */
function buildPrismaOptions(config: AppConfig): Prisma.PrismaClientOptions {
  const log: Prisma.LogLevel[] =
    process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'];

  if (config.db.transport === 'pg-adapter') {
    const adapter = new PrismaPg({
      connectionString: config.db.url,
      // O servidor de socket do PGlite atende uma unica conexao por vez.
      max: 1,
    });
    return { adapter: adapter as never, log };
  }
  return { datasources: { db: { url: config.db.url } }, log };
}

/**
 * Cliente Prisma unico da aplicacao.
 *
 * Quando DB_DRIVER=pglite (modo de verificacao local), este servico sobe o
 * proprio PGlite com PostGIS no mesmo processo e o Prisma conecta por socket.
 * Isso nao e um banco simulado: e PostgreSQL real com PostGIS real, as mesmas
 * migracoes e as mesmas queries usadas em producao.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super(buildPrismaOptions(config));
  }

  async onModuleInit(): Promise<void> {
    if (this.config.db.driver === 'pglite') {
      const port = this.config.db.pglitePort;
      if (!(await isPgliteRunning(port))) {
        await startPglite({
          port,
          dataDir: this.config.db.pgliteDataDir ?? defaultDataDir(),
        });
        this.logger.log(`PGlite (PostgreSQL local + PostGIS) ativo na porta ${port}`);
      }
    }
    await this.$connect();
    const postgis = await this.$queryRaw<Array<{ version: string }>>`
      SELECT postgis_lib_version() AS version`;
    this.logger.log(
      `Banco conectado (${this.config.db.transport}). PostGIS ${postgis[0]?.version ?? 'nao detectado'}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Alvo sem credenciais, seguro para log. */
  get safeTarget(): string {
    if (this.config.db.driver === 'pglite') {
      return `pglite://127.0.0.1:${this.config.db.pglitePort}`;
    }
    try {
      const url = new URL(this.config.db.url);
      return `${url.protocol}//${url.hostname}:${url.port || 5432}${url.pathname}`;
    } catch {
      return 'postgresql://(alvo nao parseavel)';
    }
  }
}
