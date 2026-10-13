# ADR-0001 — Monorepo com npm workspaces

**Status:** aceito · **Data:** 2026-10-12

## Contexto
O projeto tem três entregáveis que precisam compartilhar contratos: backend
(NestJS/Prisma), painel web (Next.js) e app Android (Kotlin). O contrato
compartilhado é pequeno e estável (enums de estado, matriz de permissões,
fórmulas de tempo, filtros de GPS).

## Decisão
Monorepo com npm workspaces:

```
packages/shared   contratos e lógica de domínio pura (TypeScript)
apps/api          NestJS + Prisma + PostgreSQL/PostGIS
apps/web          Next.js + React + Tailwind
apps/android      Kotlin/Compose (fora do build npm)
infra/            Dockerfiles e docker-compose de produção
```

`packages/shared` é TypeScript puro e é a **única** fonte de verdade para:
máquinas de estado de jornada e visita, matriz de permissões, validação de
coordenadas, filtro de GPS, cálculo de tempos, algoritmo de otimização,
políticas de alerta e formatadores.

## Consequências
- **Bom:** regra de negócio escrita uma vez; web e API não divergem. O Android
  reproduz a mesma regra em Kotlin e ambos são cobertos por testes.
- **Bom:** `npm install` único; build e CI simples.
- **Ruim:** o app Android não participa do build npm — exige JDK + Android SDK.
  Documentado em `docs/ANDROID.md`.
- **Ruim:** workspaces exigem atenção a `hoisting` de dependências; o
  `pg_trgm` precisou de declaração de tipos própria
  (`src/types/pglite-contrib.d.ts`).

## Alternativas descartadas
- **Monorepo Nx/Turbo:** ganho de cacheJustification para 3 pacotes é pequeno
  em relação ao custo de adoption e à versão de Node exigida.
- **Contratos gerados (OpenAPI → client):** continuaria necessário para
  Android; não resolve o problema da regra de negócio duplicada.
- **Backend que serve o app web e o Android via BFF:** não resolve o
  compartilhamento de domínio e adiciona uma camada.
