# Runbook — comandos reproduzíveis

Todos os comandos rodam a partir da **raiz** do repositório, em Node puro
(sem Docker, sem `psql`, sem JDK).

---

## 0. Instalação

```bash
npm install
```
Instala os workspaces (`packages/shared`, `apps/api`, `apps/web`).

## 1. Verificação completa (o que a CI executa)

```bash
npm run verify
```
Executa, em ordem: build do shared, typecheck + build + lint + testes da API,
typecheck + lint + testes + build da web. Imprime PASS/FAIL por etapa e sai com
código diferente de zero se algo falhar.

## 2. Comandos individuais

### Backend
```bash
npm run db:generate      # gera o cliente Prisma
npm run build:api        # compila TypeScript para apps/api/dist
npm run typecheck -w @rota/api
npm run lint -w @rota/api
npm run test:api         # suíte completa (sobe PostgreSQL real via PGlite)
```

### Web
```bash
npm run build:web        # next build
npm run typecheck -w @rota/web
npm run lint -w @rota/web
npm run test:web         # vitest
```

### Contratos compartilhados
```bash
npm run build:shared     # tsc -> packages/shared/dist
```

## 3. Banco local (verificação)

```bash
npm run db:pglite        # sobe PostgreSQL+PostGIS em processo próprio (porta 54329)
npm run db:migrate       # aplica as migrações
npm run db:seed:demo     # carga de DEMONSTRAÇÃO (tudo com isDemo=true)
npm run db:seed:demo -- --help  # (não há flags: o script é intencionalmente simples)
```

O seed de demonstração **recusa** executar se `NODE_ENV=production` ou se
`ALLOW_DEMO_SEED` não estiver habilitado.

### Geração da migração
```bash
node scripts/generate-migration.mjs
```
Regenera `apps/api/prisma/migrations/0001_init/migration.sql` a partir do
schema, acrescentando extensões, índices GiST e a regra de "uma jornada ativa
por motorista". Valida a ausência de BOM (BOM quebra o parser do Postgres).

## 4. Desenvolvimento

```bash
npm run dev:local        # banco + migrações + seed demo + API em :4000
npm run dev:web          # painel em :3000 (em outro terminal)
```
Documentação interativa da API: <http://localhost:4000/api/docs>

## 5. Diagnóstico

```bash
# SQL da API (inclusive as raw espaciais)
$env:PRISMA_LOG=1; npm run dev:local
```

## 6. Produção (Docker)

```bash
cp .env.example .env     # preencha POSTGRES_PASSWORD e JWT_ACCESS_SECRET
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
```
O `docker compose up` **não** aplica migrations automaticamente: uma falha de
migration não pode derrubar uma API que já estava no ar. Detalhes e backup em
`docs/DEPLOY.md`.

## 7. Android

Requer JDK 17 + Android SDK, que **não existem** neste ambiente.
Ver `docs/ANDROID.md` para build, testes e geração de APK assinado.
