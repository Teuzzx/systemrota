/**
 * Otimizacao de rotas.
 *
 * IMPORTANTE (requisito do briefing): a otimizacao produz uma SUGESTAO
 * justificavel, nao uma promessa de rota matematicamente perfeita. Por isso
 * todo resultado carrega: distancia, duracao, clientes incluidos, clientes
 * nao incluidos COM MOTIVO, restricoes consideradas e diferenca em relacao a
 * sequencia anterior.
 *
 * O motor nao depende de nenhum servico externo: recebe um `RoutingProvider`.
 * O provider padrao (heuristico) funciona sem rede e sem credencial; provedores
 * comerciais/OSRM sao adapters e podem ser trocados sem reescrever o motor.
 */
import { haversineDistanceM, LatLon } from './geo';

export interface LegEstimate {
  distanceM: number;
  durationS: number;
  /** Verdadeiro quando a duracao veio da rede viaria. */
  networkBased: boolean;
}

/**
 * Geometria de um trajeto.
 *
 * `networkBased = false` significa que os pontos sao uma aproximacao em linha
 * reta, NAO o caminho pelas ruas. A interface existe para deixar essa distincao
 * visivel ate na tela: desenhar reta e chamar de rota seria apresentar estimativa
 * como dado.
 */
export interface RouteGeometry {
  points: LatLon[];
  /** Verdadeiro somente quando os pontos vieram da malha viaria. */
  networkBased: boolean;
}

export interface RoutingProvider {
  readonly name: string;
  readonly networkBased: boolean;
  estimateLeg(from: LatLon, to: LatLon): Promise<LegEstimate>;
  /**
   * Geometria do trajeto entre os pontos, na ordem dada.
   *
   * Opcional de proposito: nem todo provider tem malha viaria. Quando ausente,
   * a API responde com linha reta marcada como `networkBased: false`, e a tela
   * rotula como estimativa em vez de rota sobre a via.
   */
  geometry?(waypoints: LatLon[]): Promise<RouteGeometry>;
  /** Tempo de atendimento padrao quando cliente/route nao define valor. */
  defaultServiceS?: number;
}

/**
 * Provider heuristico offline: haversine x fator de sinuosidade, convertido em
 * tempo por faixa de velocidade. Serve para agrupamento, ordenacao inicial e
 * fallback. NAO substitui rede viaria; a duracao resultante e sempre marcada
 * como estimativa.
 */
export class HeuristicRoutingProvider implements RoutingProvider {
  readonly name = 'heuristic-offline';
  readonly networkBased = false;
  readonly defaultServiceS = 900;

  async estimateLeg(from: LatLon, to: LatLon): Promise<LegEstimate> {
    const straightM = haversineDistanceM(from, to);
    // Sinuosidade cresce com a distancia (rodovias principais vs. ruas de bairro).
    const detourFactor = straightM < 500 ? 1.35 : straightM < 5000 ? 1.28 : straightM < 50_000 ? 1.18 : 1.12;
    const distanceM = straightM * detourFactor;
    const speedMps = straightM < 2000 ? 7.8 : straightM < 20_000 ? 11.1 : 16.7; // 28/40/60 km/h
    return {
      distanceM: Math.round(distanceM),
      durationS: Math.round(distanceM / speedMps),
      networkBased: false,
    };
  }

  /**
   * Sem malha viaria: devolve os proprios pontos como linha reta e declara
   * `networkBased: false`. A distincao e o ponto — quem consome sabe que nao
   * pode apresentar isso como "rota".
   */
  async geometry(waypoints: LatLon[]): Promise<RouteGeometry> {
    return { points: waypoints.map((p) => ({ ...p })), networkBased: false };
  }
}

export interface OptimizableStop {
  id: string;
  customerId: string;
  position: LatLon | null;
  priority: number;
  serviceS: number;
  /** Janela de atendimento exigida pelo cliente, quando conhecida. */
  timeWindowStart?: Date | null;
  timeWindowEnd?: Date | null;
  /** Parada fixada pelo administrador: nao entra no reordenamento automatico. */
  pinned?: boolean;
}

export type ExclusionReason =
  | 'SEM_COORDENADAS'
  | 'JANELA_FORA'
  | 'LIMITE_PARADAS'
  | 'COORDENADA_INVALIDA';

export interface ExcludedStop {
  customerId: string;
  stopId: string;
  reason: ExclusionReason;
  detail: string;
}

export interface OptimizedStop {
  stopId: string;
  customerId: string;
  sequence: number;
  distanceFromPrevM: number;
  durationFromPrevS: number;
  plannedArrivalAt: Date;
  plannedDepartureAt: Date;
  legNetworkBased: boolean;
}

export interface OptimizeRouteInput {
  stops: readonly OptimizableStop[];
  origin: LatLon | null;
  destination: LatLon | null;
  returnToBase: boolean;
  startAt: Date;
  provider: RoutingProvider;
  defaultServiceS: number;
  safetyMarginS?: number;
  maxStops?: number;
  previousOrder?: readonly string[];
}

export interface OptimizeRouteResult {
  provider: string;
  algorithm: 'NEAREST_NEIGHBOR_2OPT';
  networkBased: boolean;
  included: OptimizedStop[];
  excluded: ExcludedStop[];
  totalDistanceM: number;
  totalTravelS: number;
  totalServiceS: number;
  estimatedDurationS: number;
  estimatedFinishAt: Date;
  /** Sequencia de customerIds sugerida (entrada para o administrador). */
  suggestedCustomerOrder: string[];
  diffFromPrevious: {
    added: string[];
    removed: string[];
    reordered: boolean;
    previousOrder: string[];
    distanceDeltaM: number | null;
  };
  constraints: string[];
  confidenceNote: string;
  isSuggestion: true;
}

const asDate = (d: Date | null | undefined): Date | null => (d ? new Date(d) : null);

/**
 * Agrupamento geografico por proximidade (grid). Nao decide a ordem final:
 * apenas organiza candidatos em grupos, como o exemplo do bairro Sao Jose.
 */
export function clusterByProximity(
  stops: readonly OptimizableStop[],
  cellSizeM = 800,
): Array<{ centroid: LatLon; stops: OptimizableStop[]; radiusM: number }> {
  const positioned = stops.filter((s) => s.position);
  const unpositioned = stops.filter((s) => !s.position);
  const cells = new Map<string, OptimizableStop[]>();
  for (const stop of positioned) {
    const key = `${Math.round((stop.position as LatLon).latitude * 111_000 / cellSizeM)}:${Math.round((stop.position as LatLon).longitude * 111_000 / cellSizeM)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(stop);
    else cells.set(key, [stop]);
  }
  const groups = [...cells.values()].map((bucket) => {
    const lat = bucket.reduce((a, s) => a + (s.position as LatLon).latitude, 0) / bucket.length;
    const lng = bucket.reduce((a, s) => a + (s.position as LatLon).longitude, 0) / bucket.length;
    const centroid = { latitude: lat, longitude: lng };
    const radiusM = Math.max(
      ...bucket.map((s) => haversineDistanceM(centroid, s.position as LatLon)),
      0,
    );
    return { centroid, stops: bucket, radiusM };
  });
  if (unpositioned.length > 0) {
    groups.push({ centroid: { latitude: 0, longitude: 0 }, stops: unpositioned, radiusM: 0 });
  }
  return groups;
}

/** Nearest Neighbor: solucao inicial. Puxa primeiro o vizinho mais proximo. */
export async function nearestNeighbor(
  stops: readonly OptimizableStop[],
  origin: LatLon | null,
  provider: RoutingProvider,
  legCache: Map<string, LegEstimate>,
): Promise<OptimizableStop[]> {
  const remaining = [...stops];
  const ordered: OptimizableStop[] = [];
  let current = origin;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestLeg: LegEstimate | null = null;
    for (let i = 0; i < remaining.length; i += 1) {
      const stop = remaining[i]!;
      if (!stop.position || !current) {
        // Sem coordenada valida: vai para o fim, sera excluida na montagem.
        if (bestLeg === null) { bestIndex = i; bestLeg = null; }
        continue;
      }
      const leg = await legBetween(current, stop.position, provider, legCache);
      if (!bestLeg || leg.durationS < bestLeg.durationS) {
        bestLeg = leg;
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;
    ordered.push(chosen);
    if (chosen.position) current = chosen.position;
  }
  return ordered;
}

/**
 * 2-opt: remove "arestas" cruzadas trocando dois trechos, ate nenhuma troca
 * melhore o custo total. Determinista (sem aleatoriedade) para que a mesma
 * entrada produza sempre a mesma sugestao.
 */
export async function twoOpt(
  order: readonly OptimizableStop[],
  origin: LatLon | null,
  provider: RoutingProvider,
  legCache: Map<string, LegEstimate>,
  maxPasses = 40,
): Promise<OptimizableStop[]> {
  const current = [...order];
  if (current.length < 4) return current;
  let improved = true;
  let pass = 0;
  while (improved && pass < maxPasses) {
    improved = false;
    pass += 1;
    for (let i = 0; i < current.length - 2; i += 1) {
      for (let k = i + 1; k < current.length - 1; k += 1) {
        const before = await routeCost(current, origin, provider, legCache);
        const candidate = [
          ...current.slice(0, i),
          ...current.slice(i, k + 1).reverse(),
          ...current.slice(k + 1),
        ];
        const after = await routeCost(candidate, origin, provider, legCache);
        if (after < before - 1e-6) {
          current.splice(0, current.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return current;
}

async function legBetween(
  from: LatLon,
  to: LatLon,
  provider: RoutingProvider,
  cache: Map<string, LegEstimate>,
): Promise<LegEstimate> {
  const key = `${from.latitude.toFixed(6)},${from.longitude.toFixed(6)}|${to.latitude.toFixed(6)},${to.longitude.toFixed(6)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const leg = await provider.estimateLeg(from, to);
  cache.set(key, leg);
  return leg;
}

async function routeCost(
  order: readonly OptimizableStop[],
  origin: LatLon | null,
  provider: RoutingProvider,
  cache: Map<string, LegEstimate>,
): Promise<number> {
  let cost = 0;
  let cursor = origin;
  for (const stop of order) {
    if (!stop.position || !cursor) continue;
    const leg = await legBetween(cursor, stop.position, provider, cache);
    cost += leg.durationS;
    cursor = stop.position;
  }
  return cost;
}

export async function optimizeRoute(input: OptimizeRouteInput): Promise<OptimizeRouteResult> {
  const {
    stops, origin, destination, returnToBase, startAt, provider, defaultServiceS,
    safetyMarginS = 0, maxStops, previousOrder = [],
  } = input;

  const constraints: string[] = [
    'Proximidade geographical usada apenas para agrupamento; ordem final minimiza tempo de deslocamento.',
    'Paradas fixadas pelo administrador nao sao reordenadas.',
  ];
  const excluded: ExcludedStop[] = [];
  const eligible: OptimizableStop[] = [];

  for (const stop of stops) {
    if (!stop.position) {
      excluded.push({
        customerId: stop.customerId,
        stopId: stop.id,
        reason: 'SEM_COORDENADAS',
        detail: 'Cliente sem coordenadas validas: nao pode ser usado no calculo de trajeto.',
      });
      continue;
    }
    const ws = asDate(stop.timeWindowStart);
    const we = asDate(stop.timeWindowEnd);
    if (ws && we && we.getTime() < startAt.getTime()) {
      excluded.push({
        customerId: stop.customerId,
        stopId: stop.id,
        reason: 'JANELA_FORA',
        detail: `Janela de atendimento encerrada em ${we.toISOString()}, antes do inicio da rota.`,
      });
      continue;
    }
    eligible.push(stop);
  }

  let pool = eligible;
  if (maxStops && eligible.length > maxStops) {
    constraints.push(`Limite de ${maxStops} paradas aplicado; excedentes ficaram de fora por ordem de prioridade e proximidade.`);
    const sortedByPriority = [...eligible].sort((a, b) => a.priority - b.priority);
    const dropped = sortedByPriority.slice(maxStops);
    pool = sortedByPriority.slice(0, maxStops);
    for (const stop of dropped) {
      excluded.push({
        customerId: stop.customerId,
        stopId: stop.id,
        reason: 'LIMITE_PARADAS',
        detail: 'Excedente ao limite de paradas da rota.',
      });
    }
  }

  const cache = new Map<string, LegEstimate>();
  const flexible = pool.filter((s) => !s.pinned);
  const pinned = pool.filter((s) => s.pinned);

  const firstLegs = await Promise.all(
    flexible.map(async (s) => ({
      stop: s,
      leg: origin && s.position ? await legBetween(origin, s.position, provider, cache) : null,
    })),
  );
  const orderedFlexible = await twoOpt(
    await nearestNeighbor(flexible, origin, provider, cache),
    origin,
    provider,
    cache,
  );
  // Paradas fixadas mantem sua posicao relativa e sao re-inseridas pela ordem
  // de prioridade para nao violar a decisao do administrador.
  let ordered: OptimizableStop[] = orderedFlexible;
  if (pinned.length > 0) {
    constraints.push(`${pinned.length} parada(s) fixada(s) mantida(s) na posicao definida pelo administrador.`);
    ordered = [...pinned, ...orderedFlexible].sort((a, b) => a.priority - b.priority);
  }

  if (returnToBase && destination) constraints.push('Retorno a base configurado: a ultima parada considera o destino.');
  else if (returnToBase && origin) constraints.push('Retorno a base configurado usando o ponto de partida como base.');
  if (firstLegs.some((l) => l.leg === null)) {
    constraints.push('Paradas sem ponto de partida calculado permanecem sem deslocamento estimado inicial.');
  }

  const included: OptimizedStop[] = [];
  let cursor = origin;
  let clock = new Date(startAt);
  let totalDistanceM = 0;
  let totalTravelS = 0;
  let totalServiceS = 0;

  for (const [index, stop] of ordered.entries()) {
    const position = stop.position as LatLon;
    let leg: LegEstimate = { distanceM: 0, durationS: 0, networkBased: provider.networkBased };
    if (cursor) {
      leg = await legBetween(cursor, position, provider, cache);
    }
    const arrival = new Date(clock.getTime() + leg.durationS * 1000);
    const serviceS = stop.serviceS > 0 ? stop.serviceS : defaultServiceS;
    const departure = new Date(arrival.getTime() + serviceS * 1000);
    included.push({
      stopId: stop.id,
      customerId: stop.customerId,
      sequence: index + 1,
      distanceFromPrevM: leg.distanceM,
      durationFromPrevS: leg.durationS,
      plannedArrivalAt: arrival,
      plannedDepartureAt: departure,
      legNetworkBased: leg.networkBased,
    });
    totalDistanceM += leg.distanceM;
    totalTravelS += leg.durationS;
    totalServiceS += serviceS;
    clock = departure;
    cursor = position;
  }

  if (returnToBase && destination) {
    const backLeg = await legBetween(cursor ?? origin ?? destination, destination, provider, cache);
    included.push({
      stopId: 'RETURN_TO_BASE',
      customerId: '__RETURN_TO_BASE__',
      sequence: included.length + 1,
      distanceFromPrevM: backLeg.distanceM,
      durationFromPrevS: backLeg.durationS,
      plannedArrivalAt: new Date(clock.getTime() + backLeg.durationS * 1000),
      plannedDepartureAt: new Date(clock.getTime() + backLeg.durationS * 1000),
      legNetworkBased: backLeg.networkBased,
    });
    totalDistanceM += backLeg.distanceM;
    totalTravelS += backLeg.durationS;
    clock = new Date(clock.getTime() + backLeg.durationS * 1000);
  }

  const suggestedOrder = included.filter((s) => s.customerId !== '__RETURN_TO_BASE__').map((s) => s.customerId);
  const added = suggestedOrder.filter((c) => !previousOrder.includes(c));
  const removed = previousOrder.filter((c) => !suggestedOrder.includes(c));
  const reordered =
    previousOrder.length > 0 &&
    previousOrder.filter((c) => suggestedOrder.includes(c)).join('|') !== suggestedOrder.join('|');

  const networkBased = provider.networkBased;
  const confidenceNote = networkBased
    ? 'Tempos de deslocamento calculados pela rede viaria do provedor configurado.'
    : 'Tempos de deslocamento sao ESTIMADOS por provider heuristico offline (sem rede viaria). Ative um provedor de rotas para precisao real.';

  return {
    provider: provider.name,
    algorithm: 'NEAREST_NEIGHBOR_2OPT',
    networkBased,
    included,
    excluded,
    totalDistanceM: Math.round(totalDistanceM),
    totalTravelS,
    totalServiceS,
    estimatedDurationS: totalTravelS + totalServiceS + safetyMarginS,
    estimatedFinishAt: new Date(clock.getTime() + safetyMarginS * 1000),
    suggestedCustomerOrder: suggestedOrder,
    diffFromPrevious: {
      added,
      removed,
      reordered,
      previousOrder: [...previousOrder],
      distanceDeltaM: null,
    },
    constraints,
    confidenceNote,
    isSuggestion: true,
  };
}
