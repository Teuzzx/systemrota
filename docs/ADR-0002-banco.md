# ADR-0002 — Dois modos de banco: PostgreSQL+PostGIS em produção, PGlite na verificação

**Status:** aceito · **Data:** 2026-10-12

## Contexto
O alvo de produção é PostgreSQL 16 + PostGIS 3.4, com consultas espaciais
reais (`ST_DWithin`, índice GiST). O ambiente de desenvolvimento e de teste
deste projeto **não tem Docker, nem `psql`, nem serviço de PostgreSQL
instalado**. Ainda assim, a verificação precisa exercitar SQL de verdade,
tipos geoespaciais e constraints — um banco em memória de mentira não prova
nada sobre PostGIS, índice GiST ou trigger.

## Decisão
Um único schema e uma única migração, dois modos de execução:

| | Produção | Verificação local |
|---|---|---|
| Banco | PostgreSQL 16 + PostGIS 3.4 | PGlite (PostgreSQL 18 em WASM) + PostGIS 3.6 |
| Schema | `apps/api/prisma/schema.prisma` | **o mesmo arquivo** |
| Migração | `prisma migrate deploy` | **o mesmo comando** |
| Consultas espaciais | `ST_DWithin`, `ST_Distance`, GiST | **as mesmas** |
| Transporte do Prisma | engine nativo | driver adapter (node-postgres) |

O PGlite é exposto por um servidor de socket que fala o protocolo de wire do
PostgreSQL, então o Prisma conecta como se fosse um servidor comum.

## Limitações do PGlite encontradas na prática (e contornadas)
1. **Prepared statements nomeados.** O engine nativo do Prisma usa
   `PREPARE s0`, que o PGlite não reaproveita entre conexões →
   `prepared statement "s0" already exists`. Contorno: `DB_TRANSPORT=pg-adapter`
   (node-postgres), que é o transporte padrão quando `DB_DRIVER=pglite`.
   **Produção usa `engine`**, com prepared statements e pool de conexões.
2. **Uma conexão por vez.** O servidor de socket do PGlite atende uma única
   conexão; por isso os testes compartilham **um** `PrismaClient`.
3. **Carregamento do bundle WASM por `import()` dinâmico**, bloqueado no
   sandbox de módulos do Jest. Contorno: o banco de teste roda em **processo
   separado** (`test/pglite-test-server.mjs`), iniciado no `globalSetup`.
4. **Extensões contrib precisam ser carregadas em JS** antes de
   `CREATE EXTENSION`. Contorno: `postgis` e `pg_trgm` são importados no
   bootstrap do PGlite.
5. **CSV/SQL gravados com BOM quebram o parser do Postgres.** Por isso a
   migração é gerada por `scripts/generate-migration.mjs`, que valida a
   ausência de BOM.

## Consequências
- **Bom:** os testes de integração e E2E rodam contra PostgreSQL real com
  PostGIS, sem Docker e sem serviço instalado.
- **Bom:** a migração é validada de verdade a cada execução da suíte.
- **Ruim:** a verificação não exercita o *engine nativo* do Prisma. O
  restante do SQL é idêntico; o risco residual é baixo e está registrado
  como pendência de validação em ambiente com PostgreSQL real.
- **Ruim:** limitações de conexão do PGlite não representam produção —
  a aplicação em produção opera com pool de conexões.

## Alternativas descartadas
- **SQLite via Prisma:** não tem PostGIS, nem `geography`, nem `ST_DWithin`.
  Quebraria o requisito de consulta espacial real.
- **Repositório em memória com testes de contrato:** não executa SQL; não
  pega erro de migration, índice ou tipo.
- **Exigir Docker na máquina de desenvolvimento:** indisponível neste
  ambiente e não é requisito do cliente.
