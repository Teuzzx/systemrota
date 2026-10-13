/**
 * Calculo de tempos operacionais.
 *
 * Regra central: deslocamento, espera, atendimento, parada nao classificada e
 * jornada sao grandezas DISTINTAS e nunca devem ser somadas sem rotulo.
 * Todo calculo parte de eventos realmente registrados; lacunas produzem
 * medicao ESTIMADA ou INCOMPLETA, nunca um numero silenciosamente inventado.
 */
import { MeasurementQuality } from './enums';

export interface TimeSpan {
  /** Segundos. */
  seconds: number;
  quality: MeasurementQuality;
}

const EXACT: TimeSpan = { seconds: 0, quality: MeasurementQuality.EXATA };

function span(
  from: Date | null | undefined,
  to: Date | null | undefined,
  missingQuality: MeasurementQuality = MeasurementQuality.INCOMPLETA,
): TimeSpan | null {
  if (!from || !to) return null;
  const seconds = Math.round((to.getTime() - from.getTime()) / 1000);
  if (seconds < 0) return null;
  return { seconds, quality: MeasurementQuality.EXATA };
}

/** DURAÇÃO DO ATENDIMENTO = fim do atendimento - inicio do atendimento. */
export function serviceDuration(serviceStartedAt?: Date | null, serviceEndedAt?: Date | null): TimeSpan | null {
  return span(serviceStartedAt, serviceEndedAt);
}

/** TEMPO DE ESPERA = inicio do atendimento - chegada. */
export function waitDuration(arrivedAt?: Date | null, serviceStartedAt?: Date | null): TimeSpan | null {
  return span(arrivedAt, serviceStartedAt);
}

/**
 * TEMPO DE DESLOCAMENTO = chegada ao proximo cliente - saida do cliente anterior.
 * `plannedTravelS` e usado quando o evento real nao existe (app fechado,
 * ponto sem sinal): nesse caso a qualidade e ESTIMADA e o origem fica
 * registrado para auditoria.
 */
export function travelDuration(
  previousDepartureAt?: Date | null,
  arrivedAt?: Date | null,
  plannedTravelS?: number | null,
): TimeSpan | null {
  const exact = span(previousDepartureAt, arrivedAt);
  if (exact) return exact;
  if (typeof plannedTravelS === 'number' && plannedTravelS >= 0) {
    return { seconds: Math.round(plannedTravelS), quality: MeasurementQuality.ESTIMADA };
  }
  return null;
}

/** TEMPO TOTAL DA JORNADA = encerramento - inicio, descontando pausas. */
export function journeyTotal(
  startedAt: Date,
  endedAt?: Date | null,
  pauseTotalS = 0,
): TimeSpan | null {
  const raw = span(startedAt, endedAt);
  if (!raw) return null;
  return { seconds: Math.max(0, raw.seconds - pauseTotalS), quality: MeasurementQuality.EXATA };
}

export type SegmentKind =
  | 'ATENDIMENTO'
  | 'ESPERA'
  | 'DESLOCAMENTO'
  | 'PARADA_NAO_CLASSIFICADA'
  | 'PAUSA';

export interface TimeSegment {
  kind: SegmentKind;
  seconds: number;
  quality: MeasurementQuality;
  visitSequence: number | null;
  customerId: string | null;
}

export interface VisitTimeInput {
  sequence: number;
  customerId: string;
  arrivedAt?: Date | null;
  serviceStartedAt?: Date | null;
  serviceEndedAt?: Date | null;
  /** Saida da visita = fim do atendimento (ou saida manual registrada). */
  departedAt?: Date | null;
  plannedTravelS?: number | null;
}

export interface JourneyTimeBreakdown {
  segments: TimeSegment[];
  totals: Record<SegmentKind, number>;
  totalJourneyS: number | null;
  measuredS: number;
  unclassifiedS: number;
  /** Soma dos segmentos x total da jornada: divergencia nao explicada. */
  discrepancyS: number | null;
  quality: MeasurementQuality;
}

const EMPTY_TOTALS = (): Record<SegmentKind, number> => ({
  ATENDIMENTO: 0,
  ESPERA: 0,
  DESLOCAMENTO: 0,
  PARADA_NAO_CLASSIFICADA: 0,
  PAUSA: 0,
});

/**
 * Reconstroi a linha do tempo da jornada a partir das visitas, classificando
 * cada intervalo. Intervalos que nao se encaixam em nenhuma categoria ficam
 * explicitamente como PARADA_NAO_CLASSIFICADA (nunca contabilizados como
 * atendimento ou deslocamento por automacao).
 */
export function buildTimeBreakdown(
  journeyStartedAt: Date,
  journeyEndedAt: Date | null,
  visits: readonly VisitTimeInput[],
  pauseTotalS = 0,
): JourneyTimeBreakdown {
  const segments: TimeSegment[] = [];
  const totals = EMPTY_TOTALS();
  const ordered = [...visits].sort((a, b) => a.sequence - b.sequence);

  let cursor: Date | null = journeyStartedAt;
  let previousDeparture: Date | null = null;
  let hasEstimated = false;
  let hasIncomplete = false;

  const push = (kind: SegmentKind, seconds: number, visitSequence: number | null, customerId: string | null, quality: MeasurementQuality) => {
    if (seconds <= 0) return;
    segments.push({ kind, seconds, quality, visitSequence, customerId });
    totals[kind] += seconds;
    if (quality === MeasurementQuality.ESTIMADA) hasEstimated = true;
    if (quality === MeasurementQuality.INCOMPLETA) hasIncomplete = true;
  };

  for (const visit of ordered) {
    // O primeiro trecho e medido a partir do inicio da jornada: sem isso o
    // deslocamento inicial seria descartado.
    const departureReference = previousDeparture ?? journeyStartedAt;
    const travel = travelDuration(departureReference, visit.arrivedAt, visit.plannedTravelS);
    if (travel) {
      push('DESLOCAMENTO', travel.seconds, visit.sequence, visit.customerId, travel.quality);
    } else {
      // Sem chegada nao ha como medir o trecho: fica declarado como incompleto,
      // nunca preenchido com um numero inventado.
      hasIncomplete = true;
    }

    if (visit.arrivedAt) {
      const wait = waitDuration(visit.arrivedAt, visit.serviceStartedAt);
      if (wait) push('ESPERA', wait.seconds, visit.sequence, visit.customerId, wait.quality);
      else hasIncomplete = true;
    } else {
      hasIncomplete = true;
    }

    const service = serviceDuration(visit.serviceStartedAt, visit.serviceEndedAt);
    if (service) push('ATENDIMENTO', service.seconds, visit.sequence, visit.customerId, service.quality);
    else if (visit.serviceStartedAt || visit.arrivedAt) hasIncomplete = true;

    const departed = visit.departedAt ?? visit.serviceEndedAt ?? null;
    if (departed) {
      cursor = departed;
      previousDeparture = departed;
    }
  }

  // Intervalo entre a ultima visita e o encerramento da jornada.
  if (cursor && journeyEndedAt && journeyEndedAt.getTime() > cursor.getTime()) {
    const gapS = Math.round((journeyEndedAt.getTime() - cursor.getTime()) / 1000);
    push('PARADA_NAO_CLASSIFICADA', gapS, null, null, MeasurementQuality.INCOMPLETA);
  }

  if (pauseTotalS > 0) push('PAUSA', pauseTotalS, null, null, MeasurementQuality.EXATA);

  const totalJourney = journeyTotal(journeyStartedAt, journeyEndedAt, pauseTotalS);
  const measuredS = Object.values(totals).reduce((acc, v) => acc + v, 0);
  const unclassifiedS = totals.PARADA_NAO_CLASSIFICADA;
  const discrepancyS =
    totalJourney && !journeyEndedAt ? null : totalJourney ? totalJourney.seconds - measuredS : null;

  return {
    segments,
    totals,
    totalJourneyS: totalJourney?.seconds ?? null,
    measuredS,
    unclassifiedS,
    discrepancyS,
    quality: hasIncomplete
      ? MeasurementQuality.INCOMPLETA
      : hasEstimated
        ? MeasurementQuality.ESTIMADA
        : MeasurementQuality.EXATA,
  };
}

export function median(values: readonly number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1]! + valid[mid]!) / 2 : valid[mid]!;
}

export function mean(values: readonly number[]): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * TEMPO RESTANTE ESTIMADO = deslocamentos + atendimentos + pausas + margem.
 * `confidence` reflete a qualidade dos dados: sem historico suficiente a
 * previsao e declarada de baixa confiabilidade (nunca horario garantido).
 */
export interface RemainingEstimateInput {
  now: Date;
  remainingLegs: readonly { distanceM: number; durationS: number }[];
  remainingServicesS: number;
  remainingPausesS: number;
  safetyMarginS: number;
  historicalServiceDurationsS?: readonly number[] | null;
}

export interface RemainingEstimate {
  estimatedRemainingS: number;
  estimatedFinishAt: Date;
  remainingDistanceM: number;
  remainingStops: number;
  confidence: 'BAIXA' | 'MEDIA' | 'ALTA';
  confidenceReason: string;
  isEstimate: true;
}

export function estimateRemaining(input: RemainingEstimateInput): RemainingEstimate {
  const travelS = input.remainingLegs.reduce((acc, leg) => acc + Math.max(0, leg.durationS), 0);
  const totalS =
    travelS + Math.max(0, input.remainingServicesS) + Math.max(0, input.remainingPausesS) + Math.max(0, input.safetyMarginS);
  const finish = new Date(input.now.getTime() + totalS * 1000);
  const historical = input.historicalServiceDurationsS ?? [];
  let confidence: RemainingEstimate['confidence'] = 'BAIXA';
  let confidenceReason = 'Sem historico de atendimentos: estimativa baseada apenas em medias configuradas.';
  if (historical.length >= 10) {
    confidence = 'ALTA';
    confidenceReason = `Historico com ${historical.length} atendimentos medidos.`;
  } else if (historical.length >= 3) {
    confidence = 'MEDIA';
    confidenceReason = `Historico com ${historical.length} atendimentos medidos; media ainda instavel.`;
  }
  return {
    estimatedRemainingS: totalS,
    estimatedFinishAt: finish,
    remainingDistanceM: Math.round(input.remainingLegs.reduce((a, l) => a + Math.max(0, l.distanceM), 0)),
    remainingStops: input.remainingLegs.length,
    confidence,
    confidenceReason,
    isEstimate: true,
  };
}
