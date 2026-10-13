/**
 * Processo standalone do PGlite para desenvolvimento local.
 * Mantem o PostgreSQL (WASM) + PostGIS vivo e o expoe por socket TCP.
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PGLITE_TEST_PORT ?? 54329);
const dataDir = process.env.PGLITE_DATA_DIR ?? '';

const db = dataDir
  ? await PGlite.create({ dataDir, extensions: { postgis, pg_trgm } })
  : await PGlite.create({ extensions: { postgis, pg_trgm } });

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
process.stdout.write(`[pglite-dev] PostgreSQL local (PostGIS) ouvindo em 127.0.0.1:${port}\n`);

const shutdown = async () => {
  try { await server.stop(); } catch { /* encerrando */ }
  try { await db.close(); } catch { /* encerrando */ }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
