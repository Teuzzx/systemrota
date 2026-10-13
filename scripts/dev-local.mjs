#!/usr/bin/env node
/**
 * Sobe o ambiente local completo (sem Docker):
 *   1. banco PostgreSQL local (PGlite + PostGIS) em processo separado;
 *   2. aplicacao das migracoes;
 *   3. seed de demonstracao (identificado como DEMO);
 *   4. API em http://localhost:4000
 *
 * Uso: npm run dev:local
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps', 'api');
const PORT = Number(process.env.PGLITE_PORT ?? 54329);
const API_PORT = Number(process.env.API_PORT ?? 4000);

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DB_DRIVER: 'pglite',
  DB_TRANSPORT: 'pg-adapter',
  PGLITE_PORT: String(PORT),
  DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres?schema=public`,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'dev-only-insecure-access-secret-change-me',
  ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED ?? 'true',
  ROUTING_PROVIDER: process.env.ROUTING_PROVIDER ?? 'heuristic',
  PORT: String(API_PORT),
  PRISMA_LOG: process.env.PRISMA_LOG ?? '0',
};

function prismaCli() {
  const candidates = [
    join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
    join(API, 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('CLI do Prisma nao encontrada. Rode `npm install` na raiz.');
  return found;
}

/**
 * No npm workspaces as dependencias ficam hoisted na raiz. Procurar apenas em
 * apps/api/node_modules quebra o seed com MODULE_NOT_FOUND.
 */
function tsNodeBin() {
  const candidates = [
    join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js'),
    join(API, 'node_modules', 'ts-node', 'dist', 'bin.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('ts-node nao encontrado. Rode `npm install` na raiz.');
  return found;
}

function runNode(args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`codigo ${code}`))));
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  mkdirSync(join(API, '.pglite', 'local'), { recursive: true });

  console.log('> 1/4 iniciando banco local (PostgreSQL + PostGIS, via PGlite)...');
  const db = spawn(process.execPath, [join(API, 'src', 'db', 'pglite-dev.mjs')], {
    cwd: API,
    env: { ...env, PGLITE_TEST_PORT: String(PORT), PGLITE_DATA_DIR: join(API, '.pglite', 'local') },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const stop = () => { db.kill(); };
  process.on('SIGINT', () => { stop(); process.exit(0); });

  for (let i = 0; i < 60 && !(await portOpen(PORT)); i += 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await portOpen(PORT))) throw new Error('Banco local nao subiu a tempo.');

  console.log('> 2/4 gerando cliente Prisma e aplicando migracoes...');
  await runNode([prismaCli(), 'generate'], API);
  await runNode([prismaCli(), 'migrate', 'deploy'], API);

  console.log('> 3/4 aplicando carga de demonstracao (tudo marcado como DEMO)...');
  try {
    await runNode([tsNodeBin(), '-T', 'src/db/seed-demo.ts'], API);
  } catch {
    console.warn('   Seed demo falhou (pode ja existir). Seguindo sem seed.');
  }

  console.log(`> 4/4 iniciando API em http://localhost:${API_PORT}/api`);
  console.log(`   Documentacao: http://localhost:${API_PORT}/api/docs`);
  const api = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/main.ts'], {
    cwd: API, env, stdio: 'inherit',
  });
  api.on('exit', (code) => { stop(); process.exit(code ?? 0); });
}

main().catch((error) => {
  console.error('Falha ao subir o ambiente local:', error);
  process.exit(1);
});
