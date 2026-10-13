/**
 * Prepara o banco de teste ANTES de qualquer arquivo de teste.
 *
 * Sobe o PostgreSQL real (PGlite + PostGIS) em processo proprio, aplica as
 * migracoes de producao e encerra tudo no teardown. Os testes conectam por
 * socket exatamente como a API faria contra um PostgreSQL de verdade.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

const API_ROOT = join(__dirname, '..');
const TEST_PORT = 55432;
// URL do banco de teste. O transporte da aplicacao e o driver adapter
// (node-postgres), definido por DB_TRANSPORT.
export const TEST_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres?schema=public`;

let child: ChildProcess | null = null;

function prismaCli(): string {
  const candidates = [
    join(API_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
    join(API_ROOT, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('CLI do Prisma nao encontrada. Rode npm install na raiz.');
  return found;
}

function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Banco de teste nao subiu na porta ${port}.`));
          return;
        }
        setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

function portIsOpen(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  // O banco de teste e externo: a API deve se conectar, nunca iniciar o PGlite.
  process.env.DB_DRIVER = 'postgresql';
  // PGlite: usa o driver adapter (node-postgres), estavel com o socket do PGlite.
  process.env.DB_TRANSPORT = 'pg-adapter';
  process.env.PGLITE_PORT = String(TEST_PORT);
  process.env.JWT_ACCESS_SECRET = 'test-secret-com-tamanho-minimo-de-32-caracteres';
  process.env.ALLOW_DEMO_SEED = 'true';
  process.env.ROUTING_PROVIDER = 'heuristic';
  process.env.CORS_ORIGINS = 'http://localhost:3000';

  const serverScript = join(API_ROOT, 'test', 'pglite-test-server.mjs');
  if (!(await portIsOpen(TEST_PORT))) {
    child = spawn(process.execPath, [serverScript], {
      cwd: API_ROOT,
      env: { ...process.env, PGLITE_TEST_PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => process.stdout.write(`[pglite] ${d}`));
    child.stderr?.on('data', (d) => process.stderr.write(`[pglite] ${d}`));
    child.on('exit', (code, signal) => {
      process.stdout.write(`[pglite] processo encerrado code=${code} signal=${signal}\n`);
    });
    child.on('error', (err) => {
      process.stderr.write(`[pglite] erro ao spawnar: ${String(err)}\n`);
    });
  }

  await waitForPort(TEST_PORT);

  const clientIndex = join(API_ROOT, '..', '..', 'node_modules', '.prisma', 'client', 'index.js');
  if (!existsSync(clientIndex)) {
    execFileSync(process.execPath, [prismaCli(), 'generate'], {
      cwd: API_ROOT, stdio: 'inherit', env: process.env,
    });
  }
  execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
    cwd: API_ROOT, stdio: 'inherit', env: process.env,
  });
}

export function stopTestServer(): void {
  if (child && !child.killed) child.kill();
  child = null;
}
