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
