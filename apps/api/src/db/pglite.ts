/**
 * Gerenciador do PostgreSQL local de verificacao.
 *
 * PGlite e o mesmo PostgreSQL compilado para WebAssembly, com a extensao
 * PostGIS real. Exposto por um servidor de socket que fala o protocolo de
 * wire do PostgreSQL, o Prisma conecta exatamente igual connectaria em um
 * PostgreSQL de producao: mesma string de conexao, mesmas migracoes, mesmos
 * tipos geoespaciais e as mesmas queries.
 *
 * Este e o MODO DE VERIFICACAO LOCAL. O MODO DE PRODUCAO e o PostgreSQL +
 * PostGIS em infra/docker-compose.yml (mesmo schema, mesmas migracoes).
 * Ver docs/ADR-0002.md.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export const DEFAULT_TEST_PORT = 55432;
export const DEFAULT_DEV_PORT = 54329;
export const TEST_PROBE_PORT = DEFAULT_TEST_PORT;

export interface PgliteHandle {
  db: PGlite;
  server: PGLiteSocketServer;
  port: number;
  stop: () => Promise<void>;
}

export function localDatabaseUrl(port: number): string {
  // Parametros especificos do MODO DE VERIFICACAO com PGlite:
  //  - pgbouncer=true desativa prepared statements nomeados (o PGlite via socket
  //    nao os aceita reaproveitados entre conexoes);
  //  - connection_limit=1 porque o servidor de socket do PGlite atende uma
  //    unica conexao por vez.
  // Em PostgreSQL de producao NAO se usa nenhum dos dois: prepared statements
  // e pool de conexoes sao desejaveis (ver .env.example e infra/).
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?schema=public&pgbouncer=true&connection_limit=1`;
}

/**
 * O handle vive em globalThis de proposito: o Jest cria um registro de modulos
 * novo por arquivo de teste, e o PGlite precisa ser o MESMO processo/servidor
 * entre globalSetup, os testes e o teardown.
 */
const GLOBAL_KEY = '__rotaPgliteHandle';

function getActive(): PgliteHandle | null {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as PgliteHandle | null ?? null;
}

function setActive(handle: PgliteHandle | null): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = handle;
}

/** Aguarda o socket aceitar conexoes (evita corrida com o Prisma CLI). */
async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await isPgliteRunning(port)) return;
    if (Date.now() > deadline) {
      throw new Error(`PGlite nao ficou disponivel na porta ${port} em ${timeoutMs}ms.`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Sobe o PGlite com PostGIS e o publica na porta informada.
 * Sem `dataDir` (ou ':memory:') mantem tudo em RAM: cada execucao comeca zerada.
 */
export async function startPglite(options: {
  port: number;
  dataDir?: string;
}): Promise<PgliteHandle> {
  const current = getActive();
  if (current && current.port === options.port) return current;

  const dataDir = options.dataDir;
  if (dataDir && dataDir !== ':memory:') {
    const dir = resolve(dataDir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  // Sem dataDir o PGlite roda em memoria: cada execucao comeca zerada.
  const extensions = { postgis, pg_trgm };
  const db = dataDir && dataDir !== ':memory:'
    ? await PGlite.create({ dataDir, extensions })
    : await PGlite.create({ extensions });

  const server = new PGLiteSocketServer({ db, port: options.port, host: '127.0.0.1' });
  await server.start();
  await waitForPort(options.port);

  const handle: PgliteHandle = {
    db,
    server,
    port: options.port,
    stop: async () => {
      try { await server.stop(); } catch { /* ja encerrado */ }
      try { await db.close(); } catch { /* ja encerrado */ }
      setActive(null);
    },
  };
  setActive(handle);
  return handle;
}

export async function stopPglite(): Promise<void> {
  const current = getActive();
  if (!current) return;
  await current.stop();
  setActive(null);
}

export async function isPgliteRunning(port: number): Promise<boolean> {
  const current = getActive();
  if (current && current.port === port) return true;
  const net = await import('node:net');
  return new Promise<boolean>((resolvePromise) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(400);
    socket.on('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.on('error', () => { socket.destroy(); resolvePromise(false); });
    socket.on('timeout', () => { socket.destroy(); resolvePromise(false); });
  });
}

export function defaultDataDir(): string {
  return join(process.cwd(), '.pglite', 'local');
}
