/**
 * Calculos geoespaciais e filtro de ruido de GPS.
 *
 * Distancia em linha reta (haversine) NAO e usada como duracao real de
 * deslocamento: ela serve para agrupar clientes proximos e como fallback
 * quando nenhum provedor de rede viaria esta disponivel. O tempo real de
 * deslocamento vem de eventos (saida -> chegada) e, quando o evento falta,
 * da estimativa do provedor de roteamento (marcada como ESTIMADA).
 */

export const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface CoordinateValidation {
  valid: boolean;
  /** GeocodeStatus resultante: VALIDADO, PENDENTE, INVALIDO ou AUSENTE. */
  status: 'VALIDADO' | 'PENDENTE' | 'INVALIDO' | 'AUSENTE';
  reason?: string;
}

/**
 * Faixas validas de coordenadas. Usado tambem para detectar lat/lng trocados:
 * no Brasil a latitude esta entre -34 e +6; valores como 7.07 com -45.02
 * (lon/lat invertidos) sao rejeitados explicitamente.
 */
export const BRAZIL_BOUNDS = {
  minLatitude: -34.0,
  maxLatitude: 6.0,
  minLongitude: -74.0,
  maxLongitude: -34.0,
} as const;

/** Verdadeiro quando o par (lat, lng) cai na area de operacao (Brasil). */
export function isInsideBrazil(latitude: number, longitude: number): boolean {
  return (
    latitude >= BRAZIL_BOUNDS.minLatitude &&
    latitude <= BRAZIL_BOUNDS.maxLatitude &&
    longitude >= BRAZIL_BOUNDS.minLongitude &&
    longitude <= BRAZIL_BOUNDS.maxLongitude
  );
}

/**
 * Classifica coordenadas sem inventar valor.
 *
 * Regra de inversao: no Brasil o valor absoluto da longitude e SEMPRE maior
 * que o da latitude. Portanto, se o par informado nao esta no Brasil mas a
 * troca (lng, lat) esta, os campos foram gravados trocados.
 */
export function validateCoordinate(lat: unknown, lng: unknown): CoordinateValidation {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return { valid: false, status: 'AUSENTE', reason: 'Coordenadas nao informadas.' };
  }
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { valid: false, status: 'INVALIDO', reason: 'Coordenadas nao numericas.' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      valid: false,
      status: 'INVALIDO',
      reason: `Coordenadas fora do intervalo geografico (lat=${latitude}, lng=${longitude}).`,
    };
  }
  if (isInsideBrazil(latitude, longitude)) {
    return { valid: true, status: 'VALIDADO' };
  }
  if (isInsideBrazil(longitude, latitude)) {
    return {
      valid: false,
      status: 'INVALIDO',
      reason:
        'Latitude e longitude parecem estar invertidas: a troca dos campos cairia na area de operacao.',
    };
  }
  return {
    valid: false,
    status: 'PENDENTE',
    reason: 'Coordenadas fora da area de operacao (validar manualmente).',
  };
}

export function haversineDistanceM(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GpsPoint extends LatLon {
  capturedAt: Date;
  accuracyM: number;
  speedMps?: number | null;
}

export interface GpsAccumulation {
  distanceM: number;
  accepted: number;
  rejected: number;
  movingS: number;
  stationaryS: number;
  rejectedPoints: Array<{ reason: string; point: GpsPoint; jumpM?: number }>;
}

export interface GpsFilterOptions {
  /** Precisoes piores que isto sao descartadas. */
  maxAccuracyM: number;
  /** Velocidade maxima plausivel (m/s). Acima disso, salto de GPS. */
  maxSpeedMps: number;
  /** Abaixo desta distancia o movimento esta dentro do ruido da precisao. */
  noiseThresholdM: number;
  /** Velocidade acima da qual o ponto conta como deslocamento. */
  movingSpeedMps: number;
  movingS?: number;
  stationaryS?: number;
}

export const DEFAULT_GPS_FILTER: GpsFilterOptions = {
  maxAccuracyM: 100,
  maxSpeedMps: 62.5, // 225 km/h - acima disso tratamos como salto de GPS
  noiseThresholdM: 15,
  movingSpeedMps: 1.4, // ~5 km/h
};

/**
 * Acumula distancia a partir de pontos, descartando ruido e saltos.
 * Regra explicita: NUNCA somar indiscriminadamente saltos de GPS, e nunca
 * apresentar o resultado como equivalente a leitura de hodometro.
 */
export function accumulateGpsDistance(
  points: readonly GpsPoint[],
  options: Partial<GpsFilterOptions> = {},
): GpsAccumulation {
  const opts: GpsFilterOptions = { ...DEFAULT_GPS_FILTER, ...options };
  const sorted = [...points].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const out: GpsAccumulation = {
    distanceM: 0,
    accepted: 0,
    rejected: 0,
    movingS: opts.movingS ?? 0,
    stationaryS: opts.stationaryS ?? 0,
    rejectedPoints: [],
  };
  let prev: GpsPoint | null = null;
  for (const point of sorted) {
    if (!(point.accuracyM > 0) || point.accuracyM > opts.maxAccuracyM) {
      out.rejected += 1;
      out.rejectedPoints.push({ reason: 'precisao_insuficiente', point });
      continue;
    }
    if (prev === null) {
      out.accepted += 1;
      prev = point;
      continue;
    }
    const dtS = (point.capturedAt.getTime() - prev.capturedAt.getTime()) / 1000;
    if (dtS <= 0) {
      out.rejected += 1;
      out.rejectedPoints.push({ reason: 'timestamp_invalido', point });
      continue;
    }
    const segmentM = haversineDistanceM(prev, point);
    const impliedSpeed = segmentM / dtS;
    if (impliedSpeed > opts.maxSpeedMps) {
      out.rejected += 1;
      out.rejectedPoints.push({ reason: 'salto_gps', point, jumpM: segmentM });
      continue;
    }
    if (segmentM < opts.noiseThresholdM) {
      // Deslocamento dentro do ruido: conta tempo, nao soma distancia.
      if (impliedSpeed < opts.movingSpeedMps) out.stationaryS += dtS;
      else out.movingS += dtS;
      out.accepted += 1;
      prev = point;
      continue;
    }
    out.distanceM += segmentM;
    if (impliedSpeed >= opts.movingSpeedMps) out.movingS += dtS;
    else out.stationaryS += dtS;
    out.accepted += 1;
    prev = point;
  }
  out.distanceM = Math.round(out.distanceM * 100) / 100;
  return out;
}

/** Distancia de um ponto ate o centro de uma cidade (fallback de agrupamento). */
export function boundingBox(points: readonly LatLon[]): {
  minLat: number; minLng: number; maxLat: number; maxLng: number;
} | null {
  if (points.length === 0) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minLat = Math.min(minLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLat = Math.max(maxLat, p.latitude);
    maxLng = Math.max(maxLng, p.longitude);
  }
  return { minLat, minLng, maxLat, maxLng };
}
