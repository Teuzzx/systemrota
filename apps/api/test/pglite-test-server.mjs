/**
 * Banco de teste em processo SEPARADO.
 *
 * Por que processo separado: o PGlite carrega seu bundle WASM via import()
 * dinamico, que o sandbox de modulos do Jest bloqueia sem
 * --experimental-vm-modules. Rodando o banco fora do Jest:
 *   - o PostgreSQL e real (PGlite + PostGIS), nao e mock;
 *   - migracoes, Prisma e testes usam o mesmo protocolo de wire;
 *   - e exatamente a topologia de producao (API -> Postgres por socket).
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PGLITE_TEST_PORT ?? 55432);
const dataDir = process.env.PGLITE_TEST_DATA_DIR ?? '';

const db = dataDir
  ? await PGlite.create({ dataDir, extensions: { postgis, pg_trgm } })
  : await PGlite.create({ extensions: { postgis, pg_trgm } });

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();

// A extensao PostGIS e criada pela propria migracao; aqui nao ha o que consultar.
process.stdout.write(`TEST_PGLITE_READY port=${port}\n`);

const shutdown = async () => {
  try { await server.stop(); } catch { /* encerrando */ }
  try { await db.close(); } catch { /* encerrando */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
