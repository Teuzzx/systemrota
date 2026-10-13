# Arquitetura da Plataforma de Gestão Logística

Documento de referência da Fase 1 (análise e arquitetura). Descreve **o que
existe**, não o que foi planejado.

---

## 1. Visão geral

Três produtos sobre uma infraestrutura compartilhada:

```
┌──────────────────────┐      HTTPS/JSON      ┌─────────────────────────┐
│  App Android         │ ───────────────────► │  API (NestJS)           │
│  └─ falante          │  eventos + sync      │  ├─ regras de negócio   │
└──────────────────────┘                      │  ├─ WebSocket (tempo    │
                                                │  │  real, canais       │
┌──────────────────────┐      HTTPS/JSON      │  │  escopados)          │
│  Painel web          │ ───────────────────► │  └─ OpenAPI /api/docs   │
│  └─ administrador    │                      └───────────┬─────────────┘
└──────────────────────┘                                  │
                                                ┌─────────▼──────────┐
                                                │ PostgreSQL 16      │
                                                │ + PostGIS 3.4      │
                                                └────────────────────┘
```

O Android **não** é o dono da regra. Ele valida localmente para responder
rápido ao motorista, mas quem decide é a API: transição inválida volta 409 e
o app apenas reflete.

---

## 2. Módulos do backend

| Módulo | Responsabilidade | Regras que owns |
|---|---|---|
| `auth` | login, refresh rotativo, recuperação, RBAC | scrypt, lockout, anti-enumeração |
| `customers` | cadastro, busca espacial, duplicidades | classificação de coordenada |
| `imports` | CSV/XLSX em 10 etapas | idempotência, nunca sobrescrever sem regra |
| `routes` | rotas versionadas | versionamento, reorganização auditada |
| `optimization` | sugestão de sequência | Nearest Neighbor + 2-opt, exclusões com motivo |
| `journeys` | jornada e visita | máquinas de estado, tempos |
| `locations` | ingestão de ponto e evento | idempotência por `client*Id`, filtro de GPS |
| `alerts` | regras automáticas | dedupe, silêncio, ciclo de vida |
| `dashboard` / `reports` | indicadores e exportação | tudo derivado de dados persistidos |
| `settings` | parâmetros operacionais | limiares sobreponíveis |

**Regra de ouro:** regra de negócio nunca mora em controller nem em componente
de UI. Controllers validam entrada e chamam serviço; serviços aplicam regra.

---

## 3. Modelo de dados (resumo)

25 entidades. Pontos que merecem destaque:

- `users`, `roles`, `permissions`, `role_permissions`, `user_roles` — RBAC real
  em tabela, não em código.
- `customers.location` — `geography(Point,4326)` com índice **GiST**;
  populado por SQL explícito (tipo não suportado pelo Prisma).
  `geocodeStatus` ∈ {VALIDADO, PENDENTE, INVALIDO, AUSENTE}.
- `routes` + `route_versions` + `route_stops` — reorganização **sempre** cria
  nova versão, com `diff` (adicionados/removidos/reordenados) persistido.
- `journeys.route_version_at_start` — detecta que o admin alterou a rota
  durante o offline do motorista.
- `journey_events.client_event_id` **UNIQUE** — ledger append-only idempotente.
- `location_points.client_point_id` **UNIQUE** + `retained_until` — política de
  retenção aplicada por código (`purgeExpired`).
- `alerts.dedupe_key` **UNIQUE** — um alerta por fenômeno, não por polling.

### Regras no banco (não só na aplicação)
```sql
-- Uma jornada ativa por motorista: protege contra corrida entre 2 dispositivos.
CREATE UNIQUE INDEX "journeys_one_active_per_driver"
  ON "journeys" ("driverId")
  WHERE "status" IN ('EM_ANDAMENTO', 'PAUSADA');
```

---

## 4. Idempotência e offline-first

| Camada | Chave | Comportamento em reenvio |
|---|---|---|
| Fila local (Android) | `clientEventId` (UUID) | `OnConflictStrategy.IGNORE` |
| Eventos (API) | `JourneyEvent.clientEventId` UNIQUE | retorna `duplicates[]`, **não** contabiliza |
| Localização (API) | `LocationPoint.clientPointId` UNIQUE | conta `duplicates`, recalcula distância uma vez |
| Importação | checksum do arquivo + chave do lote | reaproveita o lote, não duplica clientes |

Fluxo: app grava local (Room) → WorkManager envia quando há rede → servidor
confirma → só então o app apaga da fila. Nada é descartado por falha de rede.

---

## 5. Cálculo de tempos (o coração do sistema)

Grandezas **separadas**, nunca somadas sem rótulo:

```
ATENDIMENTO   = fim do atendimento − início do atendimento
ESPERA        = início do atendimento − chegada
DESLOCAMENTO  = chegada ao próximo − saída do cliente anterior
JORNADA       = encerramento − início − pausas
PARADA NC     = intervalo não classificado por nenhum dos acima
```

Cada segmento carrega **qualidade**: `EXATA`, `ESTIMADA` (usa estimativa do
planejamento) ou `INCOMPLETA` (falta evento). O primeiro deslocamento é medido
a partir do início da jornada; o intervalo após a última visita fica como
parada não classificada — nunca é reclassificado como atendimento.

---

## 6. Segurança

| Controle | Implementação |
|---|---|
| Senha | scrypt + salt por usuário, `timingSafeEqual` (ADR-0003) |
| Sessão | access 15 min + refresh rotativo; reuso revoga a família |
| Autorização | `JwtAuthGuard` + `PermissionsGuard` no backend |
| Entrada | `ValidationPipe` com `whitelist` + `forbidNonWhitelisted` |
| SQL | Prisma parametrizado; raw só com `Prisma.join`/tagged template |
| Rate limit | global + limite apertado em `/api/auth` |
| Segredos | só em variável de ambiente; `.env.example` sem segredos |
| Logs | redator remove senha/token/chave antes de gravar auditoria |
| Enumeração de conta | login e recuperação devolvem resposta idêntica |
| Auditoria | toda alteração relevante grava ator, antes/depois, IP |

---

## 7. WebSockets

Autenticação no handshake (JWT). Canais escopados:
`operations` (admin/supervisor), `driver:{id}`, `journey:{id}`.
Um motorista **não** recebe o fluxo operacional. Snapshot periódico traz
`dataAgeSeconds` e `freshness` junto de cada posição.

---

## 8. Android

MVVM + Compose. Offline-first com Room + WorkManager; rastreamento por
FusedLocationProvider em **foreground service**, com notificação persistente,
intervalo adaptativo (15 s em movimento / 60 s parado) e desligamento ao fim
da jornada. Bloqueio de ações que distraem enquanto o veículo está em
movimento. Detalhes e limitações de compilação em `docs/ANDROID.md`.

---

## 9. Modo de verificação vs. produção

| Aspecto | Produção | Verificação |
|---|---|---|
| Banco | PostgreSQL 16 + PostGIS | PGlite (PostgreSQL 18 WASM) + PostGIS |
| Schema/migração | idênticos | idênticos |
| Transporte Prisma | engine nativo | driver adapter (node-postgres) |
| Mapas/rotas | OSRM/GraphHopper (a definir) | heurístico offline |

Justificativa e limitações: **ADR-0002**.

---

## 10. Como reproduzir a verificação

```bash
npm install          # raiz (workspaces)
npm run verify       # build + lint + testes de api e web
npm run dev:local    # sobe banco local, migra, aplica seed demo e inicia a API
```

Comandos individuais estão em `docs/RUNBOOK.md`.
