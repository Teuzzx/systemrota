# Deploy e operação

> **Opção A — Supabase (validada de verdade, ver seção 0).**
> **Opção B — Docker/autohospedado (abaixo):** o ambiente onde este projeto foi
> verificado **não tem Docker**, então os arquivos são o artefato de implantação
> reproduzível, ainda **não executado** aqui.

---

## 0. Supabase — caminho validado em PostgreSQL real

Esta opção **foi executada** e está registrada em
[ADR-0005](ADR-0005-migracao-postgres-gerenciado.md).

### 0.1 Ordem obrigatória

**1. Habilitar as extensões** (Dashboard → Database → Extensions, ou SQL como
`postgres`). Criar extensão exige superusuário; a aplicação não tem esse
privilégio, e com as extensões já ativas o `IF NOT EXISTS` da migração vira
no-op:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**2. Criar um role dedicado** (não use o superusuário `postgres` na aplicação):

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rota_app') THEN
    EXECUTE 'ALTER ROLE rota_app WITH LOGIN PASSWORD ''<senha-forte>''';
  ELSE
    EXECUTE 'CREATE ROLE rota_app WITH LOGIN PASSWORD ''<senha-forte>''';
  END IF;
END
$$;

GRANT ALL ON SCHEMA public TO rota_app;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO rota_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO rota_app;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO rota_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO rota_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO rota_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO rota_app;

-- necessarios para o Prisma migrate
GRANT CONNECT, TEMPORARY ON DATABASE postgres TO rota_app;
ALTER ROLE rota_app CREATEDB;
```

**3. Aplicar a migração:**

```bash
DATABASE_URL="postgresql://rota_app:<senha>@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
  DB_DRIVER=postgresql DB_TRANSPORT=engine \
  npm run db:migrate
```

**4. (Opcional) Carga de demonstração** — só em ambiente de teste; o seed se
recusa a rodar com `NODE_ENV=production`.

```bash
npm run db:seed:demo
```

### 0.2 Conecte pelo host direto, não pelo pooler

Use `db.<ref>.supabase.co:5432`. O pooler Supavisor
(`aws-0-<regiao>.pooler.supabase.com`) responde
`(ENOTFOUND) tenant/user <role>.<ref> not found` para roles criados via SQL —
ele exige que o usuário esteja registrado no pooler.

### 0.3 Sobre o IPv6

`db.<ref>.supabase.co` pode resolver **somente em IPv6**. Clientes Node
com IPv6 (Node ≥18, `autoSelectFamily`) conectam normalmente. Se a conexão
travar, é falta de rota IPv6 — teste com `Test-NetConnection`.

### 0.4 Backup

```bash
supabase db dump --db-url "postgresql://<role>:<senha>@db.<ref>.supabase.co:5432/postgres" -f backup.dump
```

Política de retenção: 90 dias para pontos brutos de localização, 24 meses para
agregados por hora. A limpeza roda por `POST /api/maintenance/purge-location`,
restrita a administrador — agende em cron/job.

---

## 0.5 · Publicar a API (Railway)

A Vercel não executa servidor Node contínuo, então a API (NestJS + WebSocket)
precisa de um host próprio. Railway é o caminho mais direto, e o `railway.json`
do repositório já aponta para o Dockerfile certo.

**No painel do Railway → New Project → Deploy from GitHub → `Teuzzx/systemrota`:**

1. **Settings → Config**
   - **Dockerfile Path:** `infra/Dockerfile.api` (o `railway.json` já declara isso)
   - **Root Directory:** deixe vazio — o build precisa da raiz do monorepo
   - **Healthcheck Path:** `/api/docs-json`

2. **Variáveis de ambiente** (obrigatórias):

   | Variável | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | `postgresql://rota_app:<senha>@db.<ref>.supabase.co:5432/postgres?sslmode=require` |
   | `JWT_ACCESS_SECRET` | `openssl rand -base64 48` (**mín. 32 caracteres**) |
   | `CORS_ORIGINS` | a URL do painel na Vercel, ex.: `https://seuapp.vercel.app` |
   | `ROUTING_PROVIDER` | `heuristic` |

   O `.env` **não** é enviado à Railway (está no `.dockerignore`); cada variável
   é digitada no painel. `JWT_ACCESS_SECRET` com menos de 32 caracteres, ou igual
   ao valor de desenvolvimento, **faz o boot falhar de propósito**.

3. Não defina `PORT`: a Railway injeta e a API já lê do ambiente.

4. Concluído, o Railway devolve algo como `https://sistema-rota-api.up.railway.app`.
   **Guarde essa URL** — é o valor de `API_INTERNAL_URL` da Vercel.

> **Migrations continuam sendo passo separado**, por decisão de projeto: uma
> migration quebrada não pode derrubar uma API em serviço. O schema do Supabase
> já foi aplicado e validado (seção 0). Para mudanças futuras, rode
> `npm run db:migrate` da sua máquina com o `DATABASE_URL` do Supabase, ou
> adicione um job de release no CI — **não** no start do container.

## 0.6 · Publicar o painel (Vercel)

1. [vercel.com/new](https://vercel.com/new) → importe `Teuzzx/systemrota`.

2. **Configure o monorepo:**

   | Campo | Valor |
   |---|---|
   | **Framework Preset** | Next.js |
   | **Root Directory** | `apps/web` |
   | **Install Command** | `cd ../.. && npm ci && npm run build -w @rota/shared && npm run build -w @rota/web` |

   O `Root Directory` muda o contexto de build: o painel depende de
   `@rota/shared`, que vive na raiz do monorepo.

3. **Variáveis de ambiente:**

   | Variável | Valor |
   |---|---|
   | `API_INTERNAL_URL` | `https://sua-api.up.railway.app` |
   | `NEXT_PUBLIC_API_URL` | **vazio** — para o painel usar o proxy interno `/api` |

   `NEXT_PUBLIC_API_URL` preenchido faz o navegador chamar a API direto, e o CORS
   deixa de passar pelo servidor.

4. Deploy. A Vercel devolve `https://seuapp.vercel.app`.

5. Volte ao Railway, ajuste `CORS_ORIGINS` com a URL final da Vercel e redeploy.

### Conferindo se os três serviços estão ligados

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sua-api.up.railway.app/api/docs-json
curl -i https://seuapp.vercel.app/api/dashboard/overview
```

Um **401** em `/api/dashboard/overview` vindo do domínio da Vercel é o sinal de
que painel → API está correto: a rota existe e exige autenticação.
Um **502/504** significa `API_INTERNAL_URL` errado ou API fora do ar.

---

## 1. Preparação (Docker)

```bash
cp .env.example .env
```

Obrigatório antes de qualquer `up`:

| Variável | Como gerar |
|---|---|
| `POSTGRES_PASSWORD` | senha forte do banco |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` (mín. 32 caracteres) |

## 2. Subir

```bash
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
```

**Migrations são passo separado, deliberadamente.** Uma migration quebrada não
pode derrubar uma API já em serviço.

## 3. Primeiros dados reais

```bash
# 1. Administrador inicial (crie um usuario por vez, com senha forte)
docker compose exec api node dist/db/create-admin-cli.js \
  --email admin@empresa.com --name "Administrador" --password "<senha-forte>"

# 2. Carga de perfis/permissões/parametros (não cria dados fictícios)
docker compose exec api node dist/db/seed-core-cli.js
```

O seed de **demonstração** é recusado em produção por design.

## 4. Backup

```bash
docker compose exec -T db pg_dump -U rota -Fc rota > backup-$(date +%F).dump
```
Restic Agro Hel backups diários, retenção mínima de 30 dias e **teste de
restauração mensal** (backup não testado não é backup).

Política de retenção de localização: 90 dias para pontos brutos, 24 meses para
agregados por hora (`LOCATION_RETENTION_DAYS` / `AGGREGATE_RETENTION_DAYS`).
A limpeza roda por `POST /api/maintenance/purge-location`, restrita a
administrador; agende em cron/job.

## 5. Monitoramento

- Healthcheck da API em `/api/docs-json`.
- Alertas de negócio já embutidas na plataforma (localização desatualizada, visita
  atrasada, jornada não encerrada, etc.).
- Alertas de infraestrutura (CPU, memória, disco, latência do banco) são
  responsabilidade do ambiente de hospedagem — ver PENDENCIAS P-03.

## 6. Segurança da implantação

- TLS obrigatório: o app Android não aceita tráfego claro
  (`usesCleartextTraffic="false"`).
- Banco e OSRM expostos apenas em `127.0.0.1` no compose.
- `JWT_ACCESS_SECRET` nunca entra no repositório nem na imagem.
- CORS restrito a `CORS_ORIGINS`.
- Nunca rode o banco em porta pública.
