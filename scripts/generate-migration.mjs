#!/usr/bin/env node
/**
 * Gera a migracao inicial do banco a partir de prisma/schema.prisma.
 *
 * Por que um script e nao um comando solto:
 *  - `prisma migrate diff` roda 100% offline (nao precisa de banco);
 *  - o arquivo e escrito em UTF-8 SEM BOM (BOM quebra o parser do Postgres);
 *  - as extensoes espaciais, os indices GiST e a regra de "uma jornada ativa
 *    por motorista" sao acrescentados de forma versionada e reproduzivel.
 *
 * Uso: node scripts/generate-migration.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..', 'apps', 'api');
const schemaPath = join(apiRoot, 'prisma', 'schema.prisma');
const migrationDir = join(apiRoot, 'prisma', 'migrations', '0001_init');
const migrationFile = join(migrationDir, 'migration.sql');

if (!existsSync(schemaPath)) {
  console.error(`schema.prisma nao encontrado em ${schemaPath}`);
  process.exit(1);
}

function findPrismaCli() {
  const candidates = [
    join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    join(apiRoot, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error('CLI do Prisma nao encontrado. Rode `npm install` na raiz.');
}

const raw = execFileSync(
  process.execPath,
  [findPrismaCli(), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'],
  {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://unused/unused' },
  },
).replace(/^\uFEFF/, '');

const HEAD = `-- Migracao inicial gerada por scripts/generate-migration.mjs
-- (prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma)
--
-- PostGIS e obrigatorio: as colunas geography(Point,4326) dependem dele.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

`;

const TAIL = `
-- ====================== INDICES ESPACIAIS (GiST) ======================
CREATE INDEX "customers_location_gist" ON "customers" USING GIST ("location");
CREATE INDEX "location_points_location_gist" ON "location_points" USING GIST ("location");

-- ====================== REGRAS NO BANCO ================================
-- Regra de negocio no banco: um motorista nao pode ter duas jornadas
-- simultaneas. Complementa a validacao da aplicacao e protege contra
-- corrida entre dois dispositivos do mesmo motorista.
CREATE UNIQUE INDEX "journeys_one_active_per_driver"
  ON "journeys" ("driverId")
  WHERE "status" IN ('EM_ANDAMENTO', 'PAUSADA');

-- Busca textual de clientes por nome (trigram).
CREATE INDEX "customers_trade_name_trgm"
  ON "customers" USING GIN ("tradeName" gin_trgm_ops);
`;

mkdirSync(migrationDir, { recursive: true });
const sql = HEAD + raw.trimEnd() + TAIL;
writeFileSync(migrationFile, sql, 'utf8');

const bytes = Buffer.from(sql, 'utf8');
const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
console.log(`Migracao gerada: ${migrationFile}`);
console.log(`Bytes: ${bytes.length} | BOM: ${hasBom ? 'PRESENTE (ERRO)' : 'ausente (ok)'}`);
if (hasBom) process.exit(1);
