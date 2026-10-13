/**
 * Funcoes puras de geometria do mapa (testaveis sem DOM e sem Leaflet).
 *
 * Regra que atravessa o arquivo: NENHUMA coordenada e inventada. Um ponto sem
 * lat/lng valido e descartado, nunca substituido por zero — (0,0) e um lugar
 * real no Golfo de Guinea e apareceria como posicao falsa.
 */

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Tolerancia aceita para latitude/longitude. */
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Coords [0,0] sao o Golfo de Guinea, nao "sem coordenada". Rejeitar na origem
 * evita que um cadastro incompleto apareca como um ponto no meio do oceano.
 */
export function isPlausibleCoordinate(lat: number, lng: number): boolean {
  if (!isValidCoordinate(lat, lng)) return false;
  return !(Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9);
}

/** Converte entrada possivelmente nula em LatLon, ou null se invalida. */
export function toLatLon(lat: number | null | undefined, lng: number | null | undefined): LatLon | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  if (!isPlausibleCoordinate(lat, lng)) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * Remove entradas nulas, invalidas ou ausentes, preservando a ordem.
 *
 * A assinatura aceita coordenadas nulas de proposito: e o formato que a API
 * devolve para cliente sem geolocalizacao. Descartar aqui evita espalhar
 * `if (lat !== null)` por todo o componente.
 */
export function sanitizePath(
  points:
    | ReadonlyArray<{ latitude: number | null | undefined; longitude: number | null | undefined } | null | undefined>
    | undefined,
): LatLon[] {
  if (!points) return [];
  const out: LatLon[] = [];
  for (const p of points) {
    const clean = toLatLon(p?.latitude ?? null, p?.longitude ?? null);
    if (clean) out.push(clean);
  }
  return out;
}

/**
 * Bounds dos pontos. Retorna null quando nao ha nenhum ponto valido — quem chama
 * deve manter a view anterior em vez de centralizar em (0,0).
 */
export function boundsOf(points: ReadonlyArray<LatLon>): Bounds | null {
  const valid = sanitizePath(points);
  if (valid.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of valid) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Todos os pontos coincidem: o Leaflet nao consegue enquadrar um unico ponto
 * (divisao por zero no zoom). Devolve null para o chamador aplicar um zoom fixo.
 */
export function isDegenerateBounds(bounds: Bounds, epsilon = 1e-7): boolean {
  return (
    Math.abs(bounds.maxLat - bounds.minLat) < epsilon &&
    Math.abs(bounds.maxLng - bounds.minLng) < epsilon
  );
}

const EARTH_RADIUS_M = 6_371_000;

/** Distancia em metros. Usada para a barra de escala e para ordenar paradas. */
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

/**
 * Ordem de indices por proximidade a partir de um ponto de partida.
 * Usado como fallback quando nao ha motor de roteamento — e sempre rotulado
 * como estimativa, nunca como sequencia otima.
 */
export function orderByProximity(points: ReadonlyArray<LatLon>, start: LatLon): number[] {
  const remaining = points.map((_, index) => index);
  const ordered: number[] = [];
  let current = start;
  while (remaining.length > 0) {
    let bestAt = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = haversineDistanceM(current, points[remaining[i]]);
      if (d < bestDistance) {
        bestDistance = d;
        bestAt = i;
      }
    }
    const [next] = remaining.splice(bestAt, 1);
    ordered.push(next);
    current = points[next];
  }
  return ordered;
}

/** Formata a legenda do trajeto conforme a origem da geometria. */
export function describeGeometrySource(networkBased: boolean, provider: string): string {
  return networkBased
    ? `Trajeto sobre a malha viaria (${provider})`
    : `Trajeto estimado em linha reta (sem motor viaria: ${provider})`;
}