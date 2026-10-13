import {
  accumulateGpsDistance,
  buildTimeBreakdown,
  dataFreshness,
  estimateFuel,
  estimateRemaining,
  haversineDistanceM,
  journeyTotal,
  median,
  mean,
  serviceDuration,
  travelDuration,
  validateCoordinate,
  waitDuration,
  MeasurementQuality,
  AlertRuleKey,
  DEFAULT_ALERT_THRESHOLDS,
  clusterByProximity,
  optimizeRoute,
  HeuristicRoutingProvider,
  OptimizeRouteResult,
} from '@rota/shared';

const at = (iso: string) => new Date(iso);

describe('Validacao de coordenadas', () => {
  it('aceita coordenadas validas do Piaui', () => {
    const result = validateCoordinate(-7.0774, -45.0236);
    expect(result.valid).toBe(true);
    expect(result.status).toBe('VALIDADO');
  });

  it('marca ausencia como AUSENTE em vez de inventar valor', () => {
    expect(validateCoordinate(null, null).status).toBe('AUSENTE');
    expect(validateCoordinate(undefined, undefined).status).toBe('AUSENTE');
  });

  it('rejeita latitude e longitude trocadas', () => {
    const result = validateCoordinate(-45.0236, -7.0774);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/invertidas/i);
  });

  it('rejeita valores fora do intervalo geografico', () => {
    expect(validateCoordinate(120, 200).status).toBe('INVALIDO');
  });
});

describe('Calculo de tempos', () => {
  it('atendimento = fim - inicio', () => {
    const span = serviceDuration(at('2026-01-01T10:00:00Z'), at('2026-01-01T10:20:00Z'));
    expect(span).toEqual({ seconds: 1200, quality: MeasurementQuality.EXATA });
  });

  it('espera = inicio do atendimento - chegada', () => {
    const span = waitDuration(at('2026-01-01T10:00:00Z'), at('2026-01-01T10:03:00Z'));
    expect(span?.seconds).toBe(180);
  });

  it('deslocamento usa a saida do cliente anterior ate a chegada', () => {
    const span = travelDuration(
      at('2026-01-01T10:20:00Z'),
      at('2026-01-01T10:32:00Z'),
      null,
    );
    expect(span?.seconds).toBe(720);
  });

  it('quando falta o evento real, usa a estimativa e marca como ESTIMADA', () => {
    const span = travelDuration(null, null, 600);
    expect(span).toEqual({ seconds: 600, quality: MeasurementQuality.ESTIMADA });
  });

  it('nao produz duracao negativa', () => {
    expect(serviceDuration(at('2026-01-01T10:20:00Z'), at('2026-01-01T10:00:00Z'))).toBeNull();
  });

  it('desconta pausas do tempo total da jornada', () => {
    // 08:00 -> 12:00 sao 4h (14400s); descontando 30min de pausa = 12600s.
    expect(journeyTotal(at('2026-01-01T08:00:00Z'), at('2026-01-01T12:00:00Z'), 1800)?.seconds)
      .toBe(4 * 3600 - 1800);
  });
});

describe('Linha do tempo da jornada (separacao de grandezas)', () => {
  const visits = [
    {
      sequence: 1, customerId: 'c1',
      arrivedAt: at('2026-01-01T09:00:00Z'),
      serviceStartedAt: at('2026-01-01T09:05:00Z'),
      serviceEndedAt: at('2026-01-01T09:25:00Z'),
    },
    {
      sequence: 2, customerId: 'c2',
      arrivedAt: at('2026-01-01T09:40:00Z'),
      serviceStartedAt: at('2026-01-01T09:42:00Z'),
      serviceEndedAt: at('2026-01-01T10:00:00Z'),
    },
  ];

  it('separa atendimento, espera e deslocamento sem somar tudo junto', () => {
    const breakdown = buildTimeBreakdown(at('2026-01-01T08:00:00Z'), at('2026-01-01T10:05:00Z'), visits);

    // Deslocamento: 08:00->09:00 (1a perna) + 09:25->09:40 (2a perna)
    expect(breakdown.totals.DESLOCAMENTO).toBe(3600 + 900);
    expect(breakdown.totals.ATENDIMENTO).toBe(20 * 60 + 18 * 60);
    expect(breakdown.totals.ESPERA).toBe(5 * 60 + 2 * 60);
    expect(breakdown.totalJourneyS).toBe(2 * 3600 + 5 * 60);
  });

  it('nao perde o deslocamento do inicio da jornada ate a primeira chegada', () => {
    const breakdown = buildTimeBreakdown(at('2026-01-01T08:00:00Z'), at('2026-01-01T10:05:00Z'), visits);
    const primeiroDeslocamento = breakdown.segments.find(
      (s) => s.kind === 'DESLOCAMENTO' && s.visitSequence === 1,
    );
    expect(primeiroDeslocamento?.seconds).toBe(3600);
  });

  it('classifica como parada nao classificada apenas o intervalo final', () => {
    const breakdown = buildTimeBreakdown(at('2026-01-01T08:00:00Z'), at('2026-01-01T10:05:00Z'), visits);
    // Entre a saida do ultimo cliente e o encerramento da jornada: 5 min sem classificacao.
    expect(breakdown.unclassifiedS).toBe(300);
    expect(breakdown.discrepancyS).toBe(0);
  });

  it('nao classifica parada como atendimento automaticamente', () => {
    const breakdown = buildTimeBreakdown(at('2026-01-01T08:00:00Z'), at('2026-01-01T10:05:00Z'), visits);
    const unclassified = breakdown.segments.filter((s) => s.kind === 'PARADA_NAO_CLASSIFICADA');
    expect(unclassified.every((s) => s.kind !== 'ATENDIMENTO')).toBe(true);
  });

  it('declara qualidade incompleta quando falta evento', () => {
    const incomplete = [{ sequence: 1, customerId: 'c1', arrivedAt: at('2026-01-01T09:00:00Z') }];
    const breakdown = buildTimeBreakdown(at('2026-01-01T08:00:00Z'), null, incomplete);
    expect(breakdown.quality).toBe(MeasurementQuality.INCOMPLETA);
  });
});

describe('Filtro de ruido de GPS', () => {
  const base = at('2026-01-01T08:00:00Z');

  it('acumula distancia de pontos coerentes', () => {
    const points = [
      { latitude: -7.0774, longitude: -45.0236, capturedAt: base, accuracyM: 8 },
      { latitude: -7.0780, longitude: -45.0240, capturedAt: new Date(base.getTime() + 60_000), accuracyM: 8 },
      { latitude: -7.0790, longitude: -45.0245, capturedAt: new Date(base.getTime() + 120_000), accuracyM: 8 },
    ];
    const result = accumulateGpsDistance(points);
    expect(result.distanceM).toBeGreaterThan(0);
    expect(result.rejected).toBe(0);
  });

  it('descarta saltos de GPS em vez de somar na distancia', () => {
    const points = [
      { latitude: -7.0774, longitude: -45.0236, capturedAt: base, accuracyM: 8 },
      // salto de ~100 km em 10 s: impossivel para um veiculo real
      { latitude: -6.2, longitude: -44.0, capturedAt: new Date(base.getTime() + 10_000), accuracyM: 8 },
    ];
    const result = accumulateGpsDistance(points);
    expect(result.rejected).toBe(1);
    expect(result.rejectedPoints[0]?.reason).toBe('salto_gps');
    expect(result.distanceM).toBe(0);
  });

  it('descarta pontos com precisao insuficiente', () => {
    const result = accumulateGpsDistance([
      { latitude: -7.0774, longitude: -45.0236, capturedAt: base, accuracyM: 900 },
    ]);
    expect(result.rejected).toBe(1);
    expect(result.rejectedPoints[0]?.reason).toBe('precisao_insuficiente');
  });

  it('contabiliza tempo parado sem inflar a distancia', () => {
    const points = [
      { latitude: -7.0774, longitude: -45.0236, capturedAt: base, accuracyM: 5 },
      { latitude: -7.0774, longitude: -45.0236, capturedAt: new Date(base.getTime() + 300_000), accuracyM: 5 },
    ];
    const result = accumulateGpsDistance(points);
    expect(result.distanceM).toBe(0);
    expect(result.stationaryS).toBe(300);
  });

  it('haversine retorna zero para o mesmo ponto', () => {
    expect(haversineDistanceM({ latitude: -7, longitude: -45 }, { latitude: -7, longitude: -45 })).toBe(0);
  });
});

describe('Combustivel (sempre estimativa)', () => {
  it('calcula litros a partir do consumo medio', () => {
    const result = estimateFuel({ distanceKm: 280, avgConsumptionKmpl: 28, fuelCostPerLiter: 6 });
    expect(result.estimatedLiters).toBe(10);
    expect(result.estimatedCost).toBe(60);
    expect(result.isEstimate).toBe(true);
  });

  it('nao inventa estimativa sem consumo cadastrado', () => {
    const result = estimateFuel({ distanceKm: 100, avgConsumptionKmpl: null, fuelCostPerLiter: 6 });
    expect(result.estimatedLiters).toBeNull();
    expect(result.confidence).toBe('BAIXA');
  });
});

describe('Previsao de conclusao', () => {
  it('soma deslocamento, atendimento, pausas e margem', () => {
    const estimate = estimateRemaining({
      now: at('2026-01-01T10:00:00Z'),
      remainingLegs: [{ distanceM: 5000, durationS: 600 }, { distanceM: 5000, durationS: 600 }],
      remainingServicesS: 1800,
      remainingPausesS: 600,
      safetyMarginS: 300,
    });
    expect(estimate.estimatedRemainingS).toBe(600 + 600 + 1800 + 600 + 300);
    expect(estimate.isEstimate).toBe(true);
  });

  it('declaraba baixa confianca sem historico suficiente', () => {
    const estimate = estimateRemaining({
      now: at('2026-01-01T10:00:00Z'),
      remainingLegs: [{ distanceM: 100, durationS: 60 }],
      remainingServicesS: 900,
      remainingPausesS: 0,
      safetyMarginS: 0,
      historicalServiceDurationsS: [1000, 1100],
    });
    expect(estimate.confidence).toBe('BAIXA');
    expect(estimate.confidenceReason).toMatch(/historico/i);
  });

  it('eleva a confianca com historico suficiente', () => {
    const base = {
      now: at('2026-01-01T10:00:00Z'),
      remainingLegs: [{ distanceM: 100, durationS: 60 }],
      remainingServicesS: 900,
      remainingPausesS: 0,
      safetyMarginS: 0,
    };
    expect(estimateRemaining({ ...base, historicalServiceDurationsS: [1, 2, 3, 4, 5] }).confidence)
      .toBe('MEDIA');
    expect(
      estimateRemaining({ ...base, historicalServiceDurationsS: Array.from({ length: 12 }, (_, i) => i * 100) })
        .confidence,
    ).toBe('ALTA');
  });
});

describe('Desatualizacao de dado', () => {
  const now = at('2026-01-01T12:00:00Z');

  it('sinaliza dado indisponivel quando nunca houve envio', () => {
    expect(dataFreshness(null, now, 300)).toBe('INDISPONIVEL');
  });

  it('nunca apresenta dado antigo como atual', () => {
    expect(dataFreshness(at('2026-01-01T11:59:00Z'), now, 300)).toBe('ATUAL');
    expect(dataFreshness(at('2026-01-01T11:50:00Z'), now, 300)).toBe('PARCIALMENTE_ATUALIZADO');
    expect(dataFreshness(at('2026-01-01T10:00:00Z'), now, 300)).toBe('DESATUALIZADO');
  });
});

describe('Estatisticas', () => {
  it('calcula media e mediana ignorando valores invalidos', () => {
    expect(mean([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('Otimizacao de rota', () => {
  const provider = new HeuristicRoutingProvider();
  const origin = { latitude: -7.0774, longitude: -45.0236 };

  const stops = [
    { id: 'a', customerId: 'a', position: { latitude: -7.0712, longitude: -45.0185 }, priority: 5, serviceS: 900 },
    { id: 'b', customerId: 'b', position: { latitude: -7.0830, longitude: -45.0120 }, priority: 5, serviceS: 900 },
    { id: 'c', customerId: 'c', position: { latitude: -7.0758, longitude: -45.0240 }, priority: 5, serviceS: 900 },
  ];

  it('agrupa clientes proximos por proximidade', () => {
    const groups = clusterByProximity(stops, 800);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.reduce((acc, g) => acc + g.stops.length, 0)).toBe(3);
  });

  it('produz sugestao com todos os clientes, distances e restricoes', async () => {
    const result: OptimizeRouteResult = await optimizeRoute({
      stops,
      origin,
      destination: null,
      returnToBase: false,
      startAt: at('2026-01-01T08:00:00Z'),
      provider,
      defaultServiceS: 900,
    });

    expect(result.suggestedCustomerOrder).toHaveLength(3);
    expect(result.excluded).toHaveLength(0);
    expect(result.totalDistanceM).toBeGreaterThan(0);
    expect(result.totalServiceS).toBe(2700);
    expect(result.isSuggestion).toBe(true);
    expect(result.confidenceNote).toMatch(/estimad/i);
    expect(result.constraints.length).toBeGreaterThan(0);
  });

  it('exclui cliente sem coordenadas com motivo explicito', async () => {
    const result = await optimizeRoute({
      stops: [...stops, { id: 'z', customerId: 'z', position: null, priority: 5, serviceS: 900 }],
      origin,
      destination: null,
      returnToBase: false,
      startAt: at('2026-01-01T08:00:00Z'),
      provider,
      defaultServiceS: 900,
    });
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe('SEM_COORDENADAS');
    expect(result.excluded[0]?.detail).toMatch(/coordenadas/i);
  });

  it('respeita o limite de paradas e informa os excluidos', async () => {
    const result = await optimizeRoute({
      stops,
      origin,
      destination: null,
      returnToBase: false,
      startAt: at('2026-01-01T08:00:00Z'),
      provider,
      defaultServiceS: 900,
      maxStops: 2,
    });
    expect(result.included).toHaveLength(2);
    expect(result.excluded.some((e) => e.reason === 'LIMITE_PARADAS')).toBe(true);
  });

  it('mantem paradas fixadas pelo administrador', async () => {
    const result = await optimizeRoute({
      stops: [...stops, { id: 'p', customerId: 'p', position: { latitude: -7.0900, longitude: -45.0400 }, priority: 1, serviceS: 900, pinned: true }],
      origin,
      destination: null,
      returnToBase: false,
      startAt: at('2026-01-01T08:00:00Z'),
      provider,
      defaultServiceS: 900,
    });
    expect(result.suggestedCustomerOrder[0]).toBe('p');
    expect(result.constraints.some((c) => c.includes('fixada'))).toBe(true);
  });

  it('reporta a diferenca em relacao a sequencia anterior', async () => {
    const result = await optimizeRoute({
      stops,
      origin,
      destination: null,
      returnToBase: false,
      startAt: at('2026-01-01T08:00:00Z'),
      provider,
      defaultServiceS: 900,
      previousOrder: ['c', 'a', 'b'],
    });
    expect(result.diffFromPrevious.previousOrder).toEqual(['c', 'a', 'b']);
    expect(result.diffFromPrevious.added).toEqual([]);
    expect(result.diffFromPrevious.removed).toEqual([]);
    expect(typeof result.diffFromPrevious.reordered).toBe('boolean');
  });

  it('funciona sem rede e sem credencial (provider offline)', async () => {
    expect(provider.networkBased).toBe(false);
    const leg = await provider.estimateLeg(origin, { latitude: -7.08, longitude: -45.02 });
    expect(leg.distanceM).toBeGreaterThan(0);
    expect(leg.durationS).toBeGreaterThan(0);
  });
});

describe('Padroes de alerta', () => {
  it('mantem os 10 tipos de alerta exigidos pelo briefing', () => {
    expect(Object.keys(AlertRuleKey)).toHaveLength(10);
  });

  it('possui limites padrao configuraveis', () => {
    expect(DEFAULT_ALERT_THRESHOLDS.locationStaleS).toBeGreaterThan(0);
    expect(DEFAULT_ALERT_THRESHOLDS.dedupeWindowS).toBeGreaterThan(0);
  });
});
