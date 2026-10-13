/**
 * Combustivel e alerta: politicas default e calculos puros.
 * Todos os valores de alerta sao SOBREPOSIVEIS em system_settings (backend).
 */

export interface FuelEstimateInput {
  distanceKm: number;
  avgConsumptionKmpl: number | null | undefined;
  fuelCostPerLiter: number | null | undefined;
}

export interface FuelEstimate {
  estimatedLiters: number | null;
  estimatedCost: number | null;
  /** Sempre verdadeiro: o valor e estimativa, nunca despesa registrada. */
  isEstimate: true;
  confidence: 'BAIXA' | 'MEDIA' | 'ALTA';
  reason: string;
}

export function estimateFuel(input: FuelEstimateInput): FuelEstimate {
  const km = Math.max(0, input.distanceKm);
  const kmpl = input.avgConsumptionKmpl;
  const price = input.fuelCostPerLiter;
  if (!kmpl || kmpl <= 0) {
    return {
      estimatedLiters: null,
      estimatedCost: null,
      isEstimate: true,
      confidence: 'BAIXA',
      reason: 'Veiculo sem consumo medio cadastrado: estimativa de combustivel indisponivel.',
    };
  }
  const liters = km / kmpl;
  const cost = price && price > 0 ? liters * price : null;
  return {
    estimatedLiters: Math.round(liters * 100) / 100,
    estimatedCost: cost === null ? null : Math.round(cost * 100) / 100,
    isEstimate: true,
    confidence: 'MEDIA',
    reason:
      'Consumo medio variacao real conforme terreno e carga; equate a hodometro apenas como ordem de grandeza.',
  };
}

export const AlertRuleKey = {
  DRIVER_LOCATION_STALE: 'DRIVER_LOCATION_STALE',
  VISIT_LATE: 'VISIT_LATE',
  VISIT_NOT_DONE: 'VISIT_NOT_DONE',
  JOURNEY_TOO_LONG: 'JOURNEY_TOO_LONG',
  PROLONGED_STOP: 'PROLONGED_STOP',
  ROUTE_LOW_PROGRESS: 'ROUTE_LOW_PROGRESS',
  SYNC_FAILURE: 'SYNC_FAILURE',
  CUSTOMER_WITHOUT_COORDS: 'CUSTOMER_WITHOUT_COORDS',
  JOURNEY_NOT_CLOSED: 'JOURNEY_NOT_CLOSED',
  OPERATIONAL_OCCURRENCE: 'OPERATIONAL_OCCURRENCE',
} as const;
export type AlertRuleKey = (typeof AlertRuleKey)[keyof typeof AlertRuleKey];

export interface AlertThresholds {
  locationStaleS: number;
  visitLateToleranceS: number;
  journeyMaxS: number;
  prolongedStopS: number;
  routeExpectedProgressPct: number;
  syncPendingS: number;
  journeyNotClosedS: number;
  /** Janela de silenciamento temporario para evitar repeticao. */
  dedupeWindowS: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  locationStaleS: 300,
  visitLateToleranceS: 900,
  journeyMaxS: 12 * 3600,
  prolongedStopS: 30 * 60,
  routeExpectedProgressPct: 40,
  syncPendingS: 1800,
  journeyNotClosedS: 14 * 3600,
  dedupeWindowS: 900,
};

export interface TrackingPolicy {
  /** Intervalo alvo de captura em movimento. */
  movingIntervalS: number;
  /** Intervalo alvo quando praticamente parado. */
  stationaryIntervalS: number;
  /** Acima desta precisao o ponto e considerado ruim. */
  maxAcceptableAccuracyM: number;
  locationRetentionDays: number;
  aggregateRetentionDays: number;
  /** Rastreamento so ocorre com jornada ativa. */
  onlyDuringJourney: boolean;
}

export const DEFAULT_TRACKING_POLICY: TrackingPolicy = {
  movingIntervalS: 15,
  stationaryIntervalS: 60,
  maxAcceptableAccuracyM: 100,
  locationRetentionDays: 90,
  aggregateRetentionDays: 730,
  onlyDuringJourney: true,
};

/** fresh/stale/expired: o painel NUNCA mostra posicao antiga como atual. */
export type DataFreshness = 'ATUAL' | 'PARCIALMENTE_ATUALIZADO' | 'DESATUALIZADO' | 'INDISPONIVEL';

export function dataFreshness(
  lastReceivedAt: Date | null | undefined,
  now: Date,
  staleAfterS: number,
): DataFreshness {
  if (!lastReceivedAt) return 'INDISPONIVEL';
  const ageS = (now.getTime() - new Date(lastReceivedAt).getTime()) / 1000;
  if (ageS <= staleAfterS) return 'ATUAL';
  if (ageS <= staleAfterS * 4) return 'PARCIALMENTE_ATUALIZADO';
  return 'DESATUALIZADO';
}

export function dataAgeSeconds(lastReceivedAt: Date | null | undefined, now: Date): number | null {
  if (!lastReceivedAt) return null;
  return Math.max(0, Math.round((now.getTime() - new Date(lastReceivedAt).getTime()) / 1000));
}
