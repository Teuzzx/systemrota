# Escopo e requisitos do produto

Consolida o produto em termos verificáveis: o que entra, o que **não** entra,
quem faz o quê e como cada fluxo é provado.

---

## 1. Objetivo

Permitir que o administrador acompanhe a operação logística **sem precisar
ligar para os motoristas**, com base em eventos realmente registrados pelo
aplicativo. Nenhum indicador é inventado; quando não há dado, a interface diz
"sem dado".

## 2. Não-objetivos (v1)

- Não substitui nem modifica o sistema comercial existente.
- Não presume que existe API do sistema comercial.
- Não rastreia o motorista fora da jornada ativa.
- Não automatiza decisão de fraude: GPS é indício, não prova.
- Não gera relatório com informação inventada.

## 3. Papéis e permissões

| Capacidade | ADMINISTRADOR | SUPERVISOR | MOTORISTA |
|---|:--:|:--:|:--:|
| Ver e gerenciar usuários/motoristas | ✔ | — | — |
| Importar e exportar clientes | ✔ | — | — |
| Criar/editar/publicar rotas | ✔ | — | — |
| Ver rotas e clientes | ✔ | ✔ | apenas os da própria rota |
| Iniciar/encerrar jornada | — | — | ✔ (própria) |
| Registrar chegada/atendimento | — | — | ✔ (própria) |
| Ler jornada de **outro** motorista | ✔ | ✔ (autorizado) | **nunca** |
| Localização de terceiros | ✔ | — | apenas a própria |
| Alertas: ler / gerenciar | ✔ / ✔ | ✔ / — | — |
| Configurações e auditoria | ✔ | — | — |

A tabela é implementada em `packages/shared/src/permissions.ts` e **validada no
backend** (`PermissionsGuard`). A UI usa a mesma matriz apenas para esconder
ações.

## 4. Casos de uso rastreados

| ID | Caso | Provado por |
|---|---|---|
| UC-001 | Administrador autentica e recebe permissões efetivas | `auth-security.e2e-spec.ts` |
| UC-002 | Administrador cadastra motorista com senha inicial obrigatória | `auth-security.e2e-spec.ts` |
| UC-003 | Importação CSV/XLSX em 10 etapas, com prévia e duplicidades | `import-optimization-alerts.e2e-spec.ts` |
| UC-004 | Coordenada ausente/invertida é sinalizada, nunca inventada | `domain.spec.ts`, `import-...-alerts` |
| UC-005 | Criar rota, atribuir motorista, publicar | `e2e-operational-flow.e2e-spec.ts` |
| UC-006 | Iniciar jornada (uma por motorista) | `e2e-operational-flow.e2e-spec.ts` |
| UC-007 | Registrar chegada, início e fim de atendimento | `e2e-operational-flow.e2e-spec.ts` |
| UC-008 | Calcular atendimento/espera/deslocamento separados | `domain.spec.ts`, `e2e-...` |
| UC-009 | Ingerir localização com filtro de ruído e idade do dado | `e2e-...`, `domain.spec.ts` |
| UC-010 | Reenvio do mesmo lote não duplica contabilização | `e2e-...`, `import-...-alerts` |
| UC-011 | Sugestão de rota com exclusões **e motivos** | `import-optimization-alerts.e2e-spec.ts` |
| UC-012 | Alertas com dado verificável, dedupe e ciclo de vida | `import-optimization-alerts.e2e-spec.ts` |
| UC-013 | Motorista não acessa dados alheios | `auth-security.e2e-spec.ts` |
| UC-014 | Conflito de versão de rota após alteração durante offline | `import-optimization-alerts.e2e-spec.ts` |

## 5. Estados e transições

**Jornada:** `NAO INICIADA → EM ANDAMENTO → {PAUSADA → EM ANDAMENTO} →
{FINALIZADA | CANCELADA}`. Estados terminais não aceitam saída. Aplicação +
índice único parcial no banco.

**Visita:** `PLANEJADA → {EM DESLOCAMENTO | CHEGADA REGISTRADA} →
{CHEGADA REGISTRADA → EM ATENDIMENTO} → CONCLUÍDA`, com saídas laterais
`NÃO REALIZADA` e `CANCELADA`. **Concluir exige chegada e início registrados.**
Repetir o mesmo estado é reconhecido como duplicado, não como erro fatal nem
como nova contabilização.

Tabela completa: `packages/shared/src/stateMachines.ts` (e o espelho em
`apps/android/.../domain/StateMachines.kt`).

## 6. Glossário

| Termo | Significado no sistema |
|---|---|
| Jornada | período de trabalho do motorista, de início a encerramento |
| Visita | atendimento planejado a um cliente dentro de uma jornada |
| Deslocamento | intervalo entre a saída de um cliente e a chegada ao próximo |
| Espera | chegada registrada até o início efetivo do atendimento |
| Atendimento | início até o fim do atendimento ao cliente |
| Parada não classificada | tempo que não se encaixa em nenhum dos anteriores |
| Planejamento | versão da rota com clientes, ordem e estimativas |
| Versão da rota | revisão imutável do planejamento; toda mudança cria uma |
| Fonte do evento | GPS ou MANUAL, com justificativa quando manual |
| Dados demo | linhas com `isDemo=true`; nunca representam a operação real |

## 7. Critérios de aceitação por fase

| Fase | Critério verificável | Comando |
|---|---|---|
| 1 Arquitetura | ADRs, schema, contratos e runbook escritos | `ls docs/` |
| 2 Backend | Fluxo E2E da seção 21 do briefing passa | `npm run test:api` |
| 3 Web | 8 telas compilam e testes de UI passam | `npm run build:web && npm run test:web` |
| 4 Android | Código e testes JVM escritos (compilação pendente de JDK) | ver `docs/ANDROID.md` |
| 5 Otimização | Sugestão com exclusões e motivos | `import-optimization-alerts.e2e-spec.ts` |
| 6 Integração | Lint + typecheck limpos nos dois apps | `npm run verify` |
| 7 Implantação | Dockerfiles e compose prontos | `docker compose config` |

## 8. Telas

**Web (desktop-first, denso):** login · dashboard · mapa operacional ·
motoristas · planejamento de rotas · clientes · histórico de jornadas ·
relatórios · alertas.

**Android (uso em veículo):** login · início · minha rota · detalhe do cliente ·
histórico da jornada · configurações. Alvos de toque ≥56 dp, alto contraste e
bloqueio de ações que distraem durante o deslocamento.

## 9. Estados de interface obrigatórios

Carregando · erro com "tentar novamente" · lista vazia com texto explicativo ·
sem conexão · dados desatualizados (com idade) · permissão negada ·
sincronização pendente (com contagem). Nenhum botão decorativo: toda ação
visível executa ou está marcada como futura.
