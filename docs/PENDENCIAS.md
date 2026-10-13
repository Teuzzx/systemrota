# PENDÊNCIAS — decisões que dependem do cliente

Nenhuma destas pendências bloqueia o desenvolvimento ou a verificação local.
Todas bloqueiam, em algum grau, a **implantação em produção**. Para cada uma:
o que falta, por que bloqueia, o que o código assume hoje e o que é preciso
entregar.

---

## P-01 · Formato de exportação do sistema comercial existente
**Bloqueia:** importação real dos clientes em produção.
**Motivo:** a importação foi construída com detecção automática de cabeçalho,
mas os nomes reais das colunas do sistema Max Planck são desconhecidos.
**Assumido no código:** mapeamento automático por alias pt-BR
(`estabelecimento`, `nome fantasia`, `bairro`, `cidade`, `latitude`,
`longitude`, `identificador`…). O administrador sempre confirma e ajusta o
mapeamento antes de confirmar — nada é importado às cegas.
**Necessário do cliente:** um arquivo de exemplo (CSV ou XLSX) com os dados
reais e **dados fictícios** se preferir; mais o dicionário de campos.

## P-02 · Provedor de mapas e roteamento
**Bloqueia:** tempo de deslocamento real por rede viária.
**Motivo:** OSRM exige baixar e manter dados de rota; GraphHopper/Google/Mapbox
exigem credencial e têm custo.
**Assumido no código:** provider heurístico **offline**, sem chave e sem rede.
Toda estimativa sai rotulada como estimada. A troca é uma variável de ambiente
(`ROUTING_PROVIDER`), sem mudança de código — ver ADR-0004.
**Necessário do cliente:** decidir entre OSRM self-hosted (custo de servidor,
sem limite de uso) ou API comercial (custo por requisição).

> **Resolvido pela metade em 2026-10-13 — base cartográfica.** O mapa SVG
> offline foi substituído por **Leaflet + OpenStreetMap**, sem chave e sem
> custo. Ruas, bairros, cidades e estradas reais aparecem com zoom e
> deslocamento; a atribuição ODbL é exibida e os provedores comerciais
> (MapTiler, Stadia) estão declarados mas **desativados**, aguardando
> autorização. Trocar de provedor é uma entrada em
> `apps/web/src/lib/map/providers.ts` + `NEXT_PUBLIC_TILE_PROVIDER`.
>
> **O que continua pendente é o trajeto sobre a via.** O backend agora expõe
> `POST /api/routing/geometry`, que devolve geometria real do OSRM
> (`overview=full`). Sem `ROUTING_PROVIDER=osrm` e `OSRM_BASE_URL`, a resposta
> é linha reta com `networkBased: false` e o painel rotula como **estimativa** —
> nunca como rota. Para ativar: rodar um OSRM self-hosted (grátis) ou contratar
> um serviço. Enquanto isso, **o mapa mostra ruas reais, mas os trajetos
> desenhados são retas estimadas**, e a tela avisa isso explicitamente.

## P-03 · Domínio, HTTPS e hospedagem
**Bloqueia:** emissão de APK confiável e operação em produção.
**Motivo:** Android exige HTTPS para tráfego claro; sem domínio não há como
distribuir.
**Assumido no código:** `API_INTERNAL_URL` e `NEXT_PUBLIC_API_URL` por
ambiente; Android recebe a URL por `buildConfigField`.
**Necessário do cliente:** domínio/subdomínio, decisão de hospedagem
(h VPS gerenciada, nuvem, on-premise) e quem opera.

> **Meio resolvido em 2026-10-13 — o banco já não é pendência.** O
> PostgreSQL/PostGIS foi implantado e validado num projeto Supabase próprio
> (`sa-east-1`, PostgreSQL 17.11 + PostGIS 3.3.7), com role dedicado e menor
> privilégio. Passos exatos em [DEPLOY.md](DEPLOY.md) seção 0 e em
> [ADR-0005](ADR-0005-migracao-postgres-gerenciado.md).
>
> O que continua aberto é **onde a API roda**. Supabase não hospeda servidor
> Node contínuo (WebSocket + Prisma), então a API precisa de Railway, Fly.io,
> Render ou uma VPS. O painel pode ir para a Vercel — mas **sozinho ele não
> funciona**: o painel faz proxy de `/api` para `API_INTERNAL_URL`, então sem a
> API no ar todas as telas dão erro. São 3 serviços, não 1:
> Vercel (painel) + hospedagem Node (API) + Supabase (banco, já feito).

## P-04 · Assinatura do APK
**Bloqueia:** build de release e atualizações futuras.
**Motivo:** Android exige que updates de APK tenham **a mesma chave de
assinatura**. Sem chave registrada, atualizações буду exigir reinstalação.
**Assumido no código:** build de release sem keystore configurado — a
distribuição inicial é o APK em modo debug/instalação manual.
**Necessário do cliente:** gerar e **guardar com segurança** o keystore, definir
quem é dono da chave, definir política de rotação e decidir se haverá alias.

## P-05 · Política de privacidade e consentimento (LGPD)
**Bloqueia:** uso real do rastreamento com motoristas.
**Motivo:** localização de motorista é dado sensível. O briefing pede rastreio
"transparente, com finalidade definida e durante períodos autorizados".
**Assumido no código:** rastreamento **apenas durante jornada ativa**
(`tracking.onlyDuringJourney`), retenção padrão de 90 dias com agregados
horários preservados por 24 meses, limite de quem vê histórico por papel, e
auditoria de acesso. Falta o documento legal e o registro de consentimento.
**Necessário do cliente:** política de privacidade aprovada, termo de
consentimento assinado pelos motoristas, e definição de quem é controlador.

## P-06 · Fonte e atualização do preço de combustível
**Bloqueia:** relatório de custo em reais.
**Motivo:** o sistema estima litros por km/l cadastrado por veículo; o preço
depende de fonte (ANP, posto, convênio).
**Assumido no código:** `Vehicle.fuelCostPerLiter` cadastrado manualmente;
relatório sempre rotulado como **estimativa**, nunca despesa registrada.
**Necessário do cliente:** fonte do preço e frequência de atualização.

## P-07 · Quem pode reordenar a rota durante a execução
**Bloqueia:** regra de negócio do conflito de versão.
**Motivo:** se o admin altera a rota com o motorista em campo, a sequência
diverge. O código **não** sobrescreve o trabalho do motorista e registra
`ROUTE_VERSION_CONFLICT`.
**Assumido no código:** qualquer alteração cria nova versão; o app é avisado e
**pede revisão ao motorista**. Nenhuma parada é cancelada automaticamente.
**Necessário do cliente:** decidir se a reorganização durante a jornada exige
confirmação do motorista, e se paradas são removidas ou apenas
reordenadas.

## P-08 · Integração futura por API com o sistema comercial
**Bloqueia:** nada hoje.
**Motivo:** o briefing proíbe assumir que existe API.
**Assumido no código:** importação por arquivo apenas; `externalId` +
`sourceSystem` já identificam a origem para deduplicação quando a API existir.
**Necessário do cliente:** documentação da API, se e quando houver.

## P-09 · Regras operacionais por categoria de cliente
**Bloqueia:** tempo de atendimento mais preciso.
**Motivo:** o briefing cita "tempo médio por cliente, categoria ou tipo de
visita".
**Assumido no código:** `Customer.defaultServiceS` por cliente; sem isso usa
`DEFAULT_SERVICE_SECONDS` (900 s) e o relatório mostra o tamanho da amostra e
a confiança.
**Necessário do cliente:** tabela de categorias e tempos médios reais.

## P-10 · Política de atualização do aplicativo Android
**Bloqueia:** distribuição de atualizações.
**Motivo:** link de instalação inicial está previsto; atualizações exigem
decisão de versionamento e, possivelmente, loja interna.
**Assumido no código:** `versionCode`/`versionName` manual; sem auto-update.
**Necessário do cliente:** definir se haverá loja interna, MDM ou atualização
manual por link, e quem aprova cada versão.

---

## Pendências técnicas (não dependem do cliente, mas do ambiente)

- **T-01 · Validar contra PostgreSQL real.** ~~A migração não rodava em Postgres
  gerenciado~~ — **RESOLVIDO em parte (2026-10-13)**: a migração foi aplicada e
  validada em um Supabase real (PostgreSQL 17.11 + PostGIS 3.3.7): 31 tabelas,
  21 enums, 97 índices, GiST e `ST_DWithin` conferidos. Isso revelou e corrigiu
  um bug de portabilidade (`CREATE SCHEMA "public"`), documentado em
  [ADR-0005](ADR-0005-migracao-postgres-gerenciado.md).
  **Ainda pendente:** a *suíte de testes* continua rodando contra PGlite (por
  isolamento), ou seja, o CI não pega regressão de portabilidade sozinho.
  Recomendação: rodar `npm run test -w @rota/api` com `DATABASE_URL` apontando
  para o Supabase antes de cada release.
- **T-02 · Compilar e testar o app Android.** Não há JDK nem Android SDK
  neste ambiente. O código e os testes JVM unitários estão escritos, mas
  **não foram compilados nem executados**. Ver `docs/ANDROID.md`.
- **T-03 · Migração de senha para argon2id** (opcional, ver ADR-0003).
