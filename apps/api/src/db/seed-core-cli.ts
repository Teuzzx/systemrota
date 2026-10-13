/**
 * Aplica apenas a carga base: perfis, permissoes e parametros operacionais.
 * NAO cria clientes, rotas ou usuarios -- nenhuma dado ficticio e criado aqui.
 *
 *   node dist/db/seed-core-cli.js
 */
import { loadEnv } from '../config/load-env';
import { PrismaClient } from '@prisma/client';
import { seedCore } from './seed-core';
import { loadConfig } from '../config/configuration';

// O .env preenche o que o ambiente nao fornecer; o ambiente sempre vence.
loadEnv();

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({ datasources: { db: { url: config.db.url } } });
  await prisma.$connect();
  await seedCore(prisma);
  console.log('Carga base aplicada: perfis, permissoes e parametros operacionais.');
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Falha ao aplicar carga base:', error instanceof Error ? error.message : error);
  process.exit(1);
});
