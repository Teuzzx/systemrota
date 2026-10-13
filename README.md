# Rota — Plataforma de Gestão Logística

Sistema de despacho de rotas para operação de representação comercial:
app Android para motoristas, painel web administrativo e backend com banco
geoespacial.

**Este repositório é um sistema real**: há persistência, autenticação,
regras de negócio, idempotência, testes automatizados e deploy. Não é uma
maquete. Onde não foi possível executar (Android, Docker), isso está dito de
forma explícita.

---

## Começar (sem Docker, sem banco instalado)

```bash
npm install
npm run verify      # build + lint + testes de API e web
npm run dev:local   # banco local + migrations + seed demo + API em :4000
```

Documentação da API em <http://localhost:4000/api/docs> ·
Painel em `npm run dev:web` (<http://localhost:3000>).

## Estrutura

```
apps/
  api/        NestJS + Prisma + PostgreSQL/PostGIS
  web/        Next.js + React + Tailwind (painel administrativo)
  android/    Kotlin/Compose (motorista) — ver docs/ANDROID.md
packages/
  shared/     contratos e regras de domínio puras (TypeScript)
infra/        Dockerfiles e docker-compose de produção
docs/         arquitetura, ADRs, escopo, pendências, runbook, deploy
scripts/      verificação, dev local, geração de migration
DESIGN_DNA.md direção de arte (aplicada no painel e no app)
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | arquitetura, módulos, modelo de dados, idempotência, segurança |
| [`docs/SCOPE.md`](docs/SCOPE.md) | escopo, papéis, casos de uso, critérios de aceitação |
| [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md) | o que depende do cliente e do ambiente |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | comandos reproduzíveis |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | implantação, backup, operação |
| [`docs/ANDROID.md`](docs/ANDROID.md) | build do app e limitações de verificação |
| [`DESIGN_DNA.md`](DESIGN_DNA.md) | identidade visual e regras de interface |
| `docs/ADR-000{1..4}` | decisões: monorepo, banco, hash de senha, rotas |

## Princípios que o código respeita

- **Nada é inventado.** Indicador sem dado aparece como "sem dado"; estimativa
  é rotulada; coordenada ausente vira pendência, nunca é preenchida.
- **Regra fora da UI.** Máquinas de estado, permissões, tempos e filtros de GPS
  vivem em `packages/shared` e são testados; a tela só reflete.
- **Offline-first de verdade.** Eventos têm identificador do dispositivo e são
  idempotentes no servidor; reenvio não duplica contabilização.
- **Verificação honesta.** O que rodou está no resumo de verificação; o que
  não rodou está em `docs/PENDENCIAS.md`.
