# ADR-0005 — Migração portável para Postgres gerenciado (validação real no Supabase)

**Status:** aceito · **Data:** 2026-10-13

## Contexto

O [ADR-0002](ADR-0002-banco.md) definiu dois modos de banco: PGlite na
verificação local e PostgreSQL+PostGIS em produção. A migração
`0001_init` era gerada por `scripts/generate-migration.mjs`, que concatena a
saída do `prisma migrate diff` com cabeçalho e cauda próprios.

A validação real em PostgreSQL gerenciado ficou pendente (T-01 em
[PENDENCIAS.md](PENDENCIAS.md)), porque o ambiente de desenvolvimento não tem
Docker nem `psql`. Quando a migração foi finalmente aplicada em um PostgreSQL
real (Supabase, projeto próprio), ela **abortou**:

```
ERROR: permission denied for database postgres   (SQLSTATE 42501)
```

Nenhum teste local pegou isso: o PGlite executa como dono do banco.

## Causa raiz

O `prisma migrate diff` emite, no topo da migração:

```sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";
```

O schema `public` já existe por padrão em todo PostgreSQL — a instrução é
redundante. O problema é que o **PostgreSQL executa a verificação de ACL do
schema antes de decidir que pode pular a criação**. O `IF NOT EXISTS` não
protege contra isso.

Em Postgres local/PGlite o `postgres` é dono do banco e do schema, então a
checagem passa. Em Postgres gerenciado (Supabase, RDS, Cloud SQL, Neon) o
schema `public` pertence a `pg_database_owner` — pseudo-role que resolve para
o **dono do banco**, não para o role da aplicação. Um role dedicado, sem ser
dono do banco, reprova na checagem e a migração inteira morre.

Verificado empiricamente no projeto Supabase:

```
owner do schema public: pg_database_owner
owner da base de dados (postgres): postgres        <- diferente
role da aplicacao (rota_app): sem acesso ao schema public
```

## Decisão

**Remover a linha na geração, não no arquivo.**

`scripts/generate-migration.mjs` agora descarta o `CREATE SCHEMA` emitido pelo
Prisma e **falha a geração** se sobrar algum. A trava existe porque corrigir
só o `migration.sql` seria perdido na próxima regeneração — que qualquer
desenvolvedor executa sem pensar.

```js
const body = raw.replace(/^\s*CREATE SCHEMA\s+(IF NOT EXISTS\s+)?"[^"]+"\s*;\s*$/gim, '').trimEnd();
if (/^\s*CREATE SCHEMA\b/im.test(body)) { /* aborta com exit 1 */ }
```

O mesmo padrão de trava já existia para o BOM (ver ADR-0002, item 5).

### Extensions em Postgres gerenciado

A migração mantém `CREATE EXTENSION IF NOT EXISTS postgis;`, mas **criar**
extensão exige superusuário no Supabase. Com a extensão já habilitada no
projeto, o `IF NOT EXISTS` vira no-op e roda sem privilégio. A ordem de
implantação obrigatória está registrada no cabeçalho da própria migração e em
[DEPLOY.md](DEPLOY.md):

1. Habilitar `postgis` e `pg_trgm` (Dashboard → Database → Extensions, ou SQL
   como `postgres`).
2. Só então rodar `prisma migrate deploy`.

## Validação executada (não presumida)

Aplicado de fato no projeto Supabase `sueewpwagfebwexyavrm`
(`sa-east-1`, PostgreSQL 17.11, PostGIS 3.3.7):

| Verificação | Resultado |
|---|---|
| `prisma migrate deploy` | `All migrations have been successfully applied` |
| Tabelas | 31 |
| Enums | 21 |
| Índices | 97 |
| Índice GiST `customers_location_gist` | presente |
| Índice GiST `location_points_location_gist` | presente |
| `journeys_one_active_per_driver` (regra de negócio) | presente |
| `location` tipada como `geography` | `customers` e `location_points` |
| `ST_Distance` real | 1563.20 m entre dois pontos de Picos/PI |
| App + `ST_DWithin` via API | 200, filtro espacial operante |
| Demo seed | 6 clientes, 4 rotas, 1 motorista |

O role da aplicação (`rota_app`) é **sem superusuário**, o que mantém o
princípio do menor privilégio — a senha do `postgres` do Supabase não foi
alterada.

## Consequências

- **Bom:** a migração agora roda em Postgres gerenciado, não só em
  desenvolvimento. Bug de portabilidade encontrado **antes** da implantação.
- **Bom:** a trava no gerador impede a reintrodução do problema.
- **Bom:** pendência T-01 parcialmente fechada — a migração foi validada em
  PostgreSQL real, com PostGIS real. O que segue pendente é rodar a **suíte
  de testes** contra esse mesmo servidor (a suíte usa PGlite em memória, por
  isolamento — ver abaixo).
- **Ruim:** a suíte continua rodando contra PGlite, então o CI **não**
  detectaria sozinho uma regressão de portabilidade. Mitigação: o gerador
  trava, e a validação em Postgres real está documentada como passo de
  implantação.

## Alternativas descartadas

- **`ALTER SCHEMA public OWNER TO <role_app>`:** resolveria o sintoma, mas
  altera a propriedade do schema no banco gerenciado do cliente. É uma
  mudança com efeito colateral maior que remover uma linha redundante.
- **Dar `GRANT ALL ON DATABASE postgres` ao role da aplicação:** já é feito
  (`CONNECT` + `TEMPORARY`) e **não resolve** — o bloqueio é de propriedade
  do schema, não de privilégio na base.
- **Deixar o `IF NOT EXISTS` e documentar o erro:** transfere um defeito
  conhecido para quem vai fazer a implantação.