# ADR-0004 — Provedor de rotas plugável, padrão heurístico offline

**Status:** aceito · **Data:** 2026-10-12

## Contexto
O briefing exige que a otimização **não** use apenas distância em linha reta
para calcular duração real, e que avalie OSRM, GraphHopper ou provedores
comerciais por cobertura, licenciamento, custo e confiabilidade.

Mas o sistema precisa ser **verificável agora**, sem credencial e sem rede.
Assumir um serviço externo sem testá-lo seria exatamente o que o briefing
proíbe ("não considerar um serviço externo funcional sem testar").

## Decisão
Interface `RoutingProvider` (em `packages/shared/src/optimization.ts`) com
implementações intercambiáveis:

| Provider | Rede | Credencial | Custo | Quando usar |
|---|---|---|---|---|
| `heuristic-offline` (**padrão**) | não | não | zero | verificação, desenvolvimento, operação sem provedor |
| `osrm` | sim (self-hosted) | não | servidor próprio | produção com dados viários próprios |
| `graphhopper` | sim (API) | sim | por requisição | quando cobertura comercial for necessária |

O `RoutingService` escolhe o provider por `ROUTING_PROVIDER`. Se um provider
de rede falhar, ele **cai para o heurístico e marca o resultado como
estimado** — nunca inventa um número.

## Por que o padrão é heurístico
- O motor de otimização (Nearest Neighbor + 2-opt) é **independente** do
  provider: recebe `estimateLeg()` e produz a sequência.
- Distância em linha reta é usada para **agrupamento** (como o briefing
  permite) e como base do provider heurístico, sempre rotulada como estimativa.
- O resultado exibido ao administrador carrega `confidenceNote` dizendo
  explicitamente que o tempo é estimado.

## Consequências
- **Bom:** o sistema é verificável de ponta a ponta sem nenhuma credencial.
- **Bom:** trocar de provedor é uma variável de ambiente, não uma mudança de
  código.
- **Ruim:** sem provider de rede, os tempos de deslocamento são aproximações.
  Isso está sinalizado na UI e nos relatórios.
- **Pendente do cliente:** escolha e orcamento do provedor — ver
  `docs/PENDENCIAS.md`.

## Alternativas descartadas
- **Mapbox/GoogleDirections como padrão:** exige chave e custo por requisição;
  viola a regra de não inventar/assumir serviço.
- **OSRM como padrão obrigatório:** exige baixar dados de rota (centenas de
  MB a vários GB) e mantê-los atualizados; não é viável como padrão.
- **Somente distância em linha reta, sem provider:** o briefing proíbe usar
  linha reta como duração real de deslocamento.
