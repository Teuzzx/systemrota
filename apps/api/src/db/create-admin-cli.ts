/**
 * Cria um administrador inicial. Executar uma unica vez, manualmente.
 *
 *   node dist/db/create-admin-cli.js --email admin@empresa.com --name "Nome"
 *
 * Nao cria dados ficticios: exige e-mail e senhaisdigitada explicitamente.
 */
import { loadEnv } from '../config/load-env';
import { PrismaClient, RoleKey } from '@prisma/client';
import { hashPassword, checkPasswordPolicy } from '../auth/password';
import { seedCore } from './seed-core';
import { loadConfig } from '../config/configuration';

// O .env preenche o que o ambiente nao fornecer; o ambiente sempre vence.
loadEnv();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const index = args.indexOf(`--${flag}`);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const email = get('email');
  const name = get('name');
  const password = get('password');

  if (!email || !name) {
    throw new Error('Uso: node dist/db/create-admin-cli.js --email <email> --name "<nome>" [--password <senha>]');
  }
  if (!password) {
    throw new Error('Informe --password. Este script nao gera senha automatica para evitar acesso com senha conhecida.');
  }

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) throw new Error(`Senha invalida: ${policy.problems.join(' ')}`);

  const config = loadConfig();
  const prisma = new PrismaClient({ datasources: { db: { url: config.db.url } } });
  await prisma.$connect();

  await seedCore(prisma);

  const normalized = email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email: normalized } })) {
    throw new Error(`Ja existe um usuario com o e-mail ${normalized}.`);
  }

  const user = await prisma.user.create({
    data: {
      email: normalized,
      name: name.trim(),
      passwordHash: await hashPassword(password),
      status: 'ACTIVE',
      mustChangePassword: false,
      isDemo: false,
      roles: { create: [{ role: { connect: { key: RoleKey.ADMINISTRADOR } } }] },
    },
  });
  await prisma.administrator.create({
    data: { userId: user.id, department: null, canManageSettings: true, isDemo: false },
  });

  console.log(`Administrador criado: ${user.email} (id ${user.id})`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Falha ao criar administrador:', error instanceof Error ? error.message : error);
  process.exit(1);
});
