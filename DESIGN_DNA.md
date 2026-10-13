# DESIGN DNA — Plataforma de Gestão Logística

Identidade visual própria para um sistema interno de despacho. **Não utiliza
marca, logotipo ou elemento visual da Max Planck.** Inspiração declarada:
instrumentação de painel operacional (avião, CTC, logistics control tower) —
denso, funcional, legível sob luz forte e em telas baratas de frota.

Palavra-guia: **precisão antes de decoração**.

---

## 1. Princípios

1. **Densidade éua mudança.** O operador precisa ver muitos clientes, status e
   horários numa tela. Espaço em branco é luxo; aqui é desperdício de área útil.
2. **Cor carrega significado, nunca ornamento.** Verde = concluído/ok.
   Âmbar = atenção. Vermelho = crítico. Azul = em andamento. Cinza = sem dado.
   **Cinza não é "cinza decorativo": significa "sem dado"**, e é sempre
   rotulado como tal.
3. **Nada pulsa, nada brilha.** Sem gradientes, sem glassmorphism, sem sombra
   difusa, sem animação decorativa. A única animação permitida é a transição de
   estado real (linha muda de cor quando o dado chega).
4. **Tipografia é a interface.** Hierarquia por peso e tamanho, não por cor.
5. **Mobile de campo é um produto diferente**, não o painel encolhido.

---

## 2. Tipografia

| Uso | Família | Tamanho | Peso | Tracking |
|---|---|---|---|---|
| Dados numéricos (indicadores) | `IBM Plex Mono` | 28–36px | 600 | -0.02em |
| Tabelas / valores | `IBM Plex Mono` | 13px | 400/500 | 0 |
| Títulos de tela | `Inter` | 20px | 600 | -0.01em |
| Seções / labels | `Inter` | 11px | 600 uppercase | 0.08em |
| Corpo | `Inter` | 14px | 400 | 0 |
| Botão de campo (app) | `Inter` | 18px | 700 | 0 |

- **IBM Plex Mono para todo número.** Alinhamento vertical de colunas de
  horário e distância sem esforço; leitura de `-07.0774` sem ambiguidade.
- Números tabulares (`font-variant-numeric: tabular-nums`) em tabelas.
- Escala: 11 / 13 / 14 / 16 / 20 / 28 / 36. Nada entre.

---

## 3. Cor

### 3.1 Superfícies (tema escuro — padrão em painel de operação)

| Token | Hex | Uso |
|---|---|---|
| `--bg-base` | `#0E1116` | fundo da aplicação |
| `--bg-surface` | `#151A21` | cards, tabelas |
| `--bg-raised` | `#1C222B` | hover, cabeçalho de tabela |
| `--border-subtle` | `#242B36` | divisórias |
| `--border-strong` | `#39424F` | borda de foco/hover |

### 3.2 Texto

| Token | Hex | Uso |
|---|---|---|
| `--text-primary` | `#E6EAF0` | conteúdo principal |
| `--text-secondary` | `#98A2B3` | rótulos, secundário |
| `--text-muted` | `#5F6B7A` | sem dado, desabilitado |
| `--text-inverse` | `#0E1116` | texto sobre cor de ação |

### 3.3 Semânticas

| Token | Hex | Significado |
|---|---|---|
| `--status-ok` | `#2FA36B` | concluído, dentro do previsto |
| `--status-ok-dim` | `#1B3D2C` | fundo de badge ok |
| `--status-progress` | `#3D7BE8` | em andamento, conectado |
| `--status-progress-dim` | `#16294A` | fundo |
| `--status-warn` | `#D99A2B` | atraso, atenção, estimativa |
| `--status-warn-dim` | `#3D3016` | fundo |
| `--status-critical` | `#D6494B` | crítico, falha |
| `--status-critical-dim` | `#3D1A1C` | fundo |
| `--status-neutral` | `#5F6B7A` | **sem dado** |
| `--status-neutral-dim` | `#1C222B` | fundo |
| `--accent` | `#5AC8D6` | ação primária, link, foco |
| `--accent-dim` | `#123038` | fundo |

> **Regra dura:** nenhuma cor é usada fora da tabela acima. Sem "roxo de IA",
> sem azul-claro genérico, sem gradiente azul→roxo.
> **Acento ciano é a única cor "de marca"** e só aparece em ação e foco.

### 3.4 Tema claro (app de campo — uso sob sol forte)

| Token | Hex |
|---|---|
| `--bg-base` | `#F4F6F8` |
| `--bg-surface` | `#FFFFFF` |
| `--text-primary` | `#12171E` |
| `--text-secondary` | `#4A5563` |
| `--border-subtle` | `#D8DEE6` |

Semânticas mantidas (mesmos matizes, mais escuros para contraste em sol):
`ok #1F7A4C`, `progress #1D5FBF`, `warn #9A6606`, `critical #B3261E`,
`neutral #6B7683`.

### 3.5 Contraste

- Texto primário sobre superfície: ≥ 7:1 (AAA).
- Badge de status: texto e fundo ≥ 4.5:1.
- **Nunca** comunicar status só por cor — sempre ícone + rótulo textual.

---

## 4. Forma e densidade

- Raio: **6px** (padrão), 4px (inputs/badges), 10px (modais). Nada arredondado
  em "pílula" exceto badges.
- Espaçamento: escala de **4px** — 4 / 8 / 12 / 16 / 24 / 32 / 48.
- Altura de linha de tabela: **36px** (web), **56px** (app de campo).
- Borda: 1px `--border-subtle`. Sem sombra exceto modal (`0 8px 24px rgba(0,0,0,.4)`).
- Ícones: traço 1.5px, cantos arredondados, grade de 24px. Sem ícone decorativo.

---

## 5. Componentes-assinatura

1. **`MetricTile`** — número em mono 28–36px, rótulo uppercase 11px, e uma
   **linha de contexto** obrigatória ("12 de 18 concluídos", "há 4 min"). Sem a
   linha de contexto o tile não é renderizado: número solto é enganoso.
2. **`StatusBadge`** — ponto de 6px + rótulo em maiúsculas + cor semântica.
   Rótulo é obrigatório ("CONCLUÍDO", "SEM DADO", "ATRASADO").
3. **`FreshnessStrip`** — para qualquer dado de tempo real: barra de 2px cuja
   cor vai de `ok` → `warn` → `critical` conforme a idade do dado, com o texto
   "há 3 min" ao lado. **Nunca** mostrar posição antiga como atual.
4. **`DataTable`** — zebra sutil (linha par `--bg-raised` 40%), coluna de
   número alinhada à direita em mono, ordenação por clique no header,
   sticky header.
5. **`RouteSequence`** — lista vertical de paradas com conector de linha,
   número da sequência em círculo, e estado da parada por cor+rótulo.

---

## 6. Movimento

- Duração: **120ms** (hover/estado), **180ms** (transição de painel).
- Easing: `cubic-bezier(.2,0,.2,1)`.
- **Proibido:** bounce, spring, parallax, gradiente animado, auto-play.
- Animação só quando reflete mudança de dado: linha da tabela que muda de cor,
  badge que entra. Nada se move enquanto o dado não muda.

---

## 7. Anti-AI (regras de rejeição)

| Proibido | Motivo |
|---|---|
| Gradiente em botão/card | ruído visual sem significado |
| Emoji como ícone de status | ilegível em tela de campo e inconsistente |
| Texto "Bem-vindo de volta!" | texto genérico de demonstração |
| Card com borda dupla + sombra + glow |سه camadas de decoratividade |
| Métrica gigante sem contexto | número solto não é informação |
| Estado "vazio" com ilustração | em painel de operação, vazio = 0 clientes |
| Ícone de mapa genérico azul | mapa é dado, não enfeite |
| Animação de entrada em lista | atrasa leitura de dados |
| Escala de cor rainbow para status | destrói a hierarquia |

---

## 8. Mapa operacional

- Renderização **SVG determinística** com projeção equirretangular ajustada ao
  bounding box dos pontos — funciona **sem chave, sem rede e sem tile provider**.
- Posição do motorista: círculo 10px com anel de 2px na cor de status.
- Trajeto registrado: polilinha 2px sólida; trajeto **planejado**: 2px
  tracejado. Nunca misturar os dois sem rótulo.
- Cliente: losango 8px. Concluído = `ok`, pendente = `neutral`, atual =
  `progress` com pulso desativado.
- Selo de desatualização: anel tracejado ao redor do marcador + texto "há N min".
- Adapter documentado para MapLibre/Mapbox quando houver credencial
  (`MapCanvas` accepts a `TileProvider`); o padrão offline é o renderizador SVG.

---

## 9. App de campo (Android) — regras adicionais

- Alvo de toque mínimo **56×56px**; botão primário de jornada com **72px** de
  altura.
- Alto contraste (tema claro) e texto ≥ 16px.
- **Ações que distraem ficam bloqueadas em movimento.** Registrar ocorrência,
  editar observação e sair da jornada exigem confirmação com o veículo
  parado; o app informa "Estacione o veículo para continuar".
- Cada tela mostra, sempre: estado da conexão, estado da sincronização e
  permissão de localização — em uma faixa fixa, nunca escondida.
- Sem animação que impeça leitura rápida; sem carrossel.

---

## 10. Identidade de marca

- Nome do sistema: **Rota** (nome interno provisório, substituível).
- Sem logotipo literal; a "marca" é o padrão de dados —mono, tags de status e
  a linha de freshness. É mais difícil de copiar e mais útil na operação.
