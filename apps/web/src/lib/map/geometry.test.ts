import { describe, expect, it } from 'vitest';
import {
  boundsOf, describeGeometrySource, haversineDistanceM, isDegenerateBounds,
  isPlausibleCoordinate, isValidCoordinate, orderByProximity, sanitizePath, toLatLon,
} from './geometry';

const PICOS = { latitude: -7.0694, longitude: -43.0901 };
const PICOS_SUL = { latitude: -7.1, longitude: -43.14 };

describe('Validacao de coordenadas', () => {
  it('aceita latitude e longitude dentro da faixa', () => {
    expect(isValidCoordinate(-7.0694, -43.0901)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('rejeita fora da faixa, NaN e Infinity', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, 181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejeita tipos que nao sao numero', () => {
    expect(isValidCoordinate('7' as unknown as number, 0)).toBe(false);
    expect(isValidCoordinate(null as unknown as number, 0)).toBe(false);
    expect(isValidCoordinate(undefined as unknown as number, undefined as unknown as number)).toBe(false);
  });

  it('trata (0,0) como dado ausente, nao como posicao no Golfo de Guinea', () => {
    // Sem isso, cadastro sem coordenada apareceria no meio do oceano.
    expect(isPlausibleCoordinate(0, 0)).toBe(false);
    expect(isPlausibleCoordinate(-7.0694, -43.0901)).toBe(true);
  });
});

describe('toLatLon', () => {
  it('converte quando valido', () => {
    expect(toLatLon(-7.0694, -43.0901)).toEqual(PICOS);
  });

  it('devolve null para null/undefined', () => {
    expect(toLatLon(null, -43.09)).toBeNull();
    expect(toLatLon(-7.06, null)).toBeNull();
    expect(toLatLon(undefined, undefined)).toBeNull();
  });

  it('NUNCA inventa coordenada ausente', () => {
    expect(toLatLon(null, null)).toBeNull();
    expect(toLatLon(0, 0)).toBeNull();
  });
});

describe('sanitizePath', () => {
  it('descarta entradas nulas preservando a ordem', () => {
    const path = sanitizePath([PICOS, null, PICOS_SUL, undefined]);
    expect(path).toEqual([PICOS, PICOS_SUL]);
  });

  it('aceita lista vazia', () => {
    expect(sanitizePath([])).toEqual([]);
  });
});

describe('boundsOf', () => {
  it('calcula a caixa que contem todos os pontos', () => {
    const b = boundsOf([PICOS, PICOS_SUL]);
    expect(b).not.toBeNull();
    expect(b?.minLat).toBeCloseTo(-7.1);
    expect(b?.maxLat).toBeCloseTo(-7.0694);
    expect(b?.minLng).toBeCloseTo(-43.14);
    expect(b?.maxLng).toBeCloseTo(-43.0901);
  });

  it('devolve null sem pontos, para o chamador NAO centralizar em (0,0)', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('ignora nulos ao calcular', () => {
    const b = boundsOf([PICOS, null as unknown as typeof PICOS]);
    expect(b?.minLat).toBeCloseTo(PICOS.latitude);
  });
});

describe('isDegenerateBounds', () => {
  it('reconhece pontos coincidentes (divisao por zero no Leaflet)', () => {
    expect(isDegenerateBounds({ minLat: -7.07, maxLat: -7.07, minLng: -43.09, maxLng: -43.09 })).toBe(true);
  });

  it('nao confunde spread pequeno com coincidencia', () => {
    expect(isDegenerateBounds({ minLat: -7.07, maxLat: -7.05, minLng: -43.09, maxLng: -43.09 })).toBe(false);
  });
});

describe('haversineDistanceM', () => {
  it('zero para o mesmo ponto', () => {
    expect(haversineDistanceM(PICOS, PICOS)).toBe(0);
  });

  it('distancia plausivel entre dois pontos de Picos', () => {
    // ~9 km; tolerancia larga para nao depender do valor exacto.
    const d = haversineDistanceM(PICOS, PICOS_SUL);
    expect(d).toBeGreaterThan(5000);
    expect(d).toBeLessThan(15000);
  });

  it('e simetrica', () => {
    expect(haversineDistanceM(PICOS, PICOS_SUL)).toBeCloseTo(haversineDistanceM(PICOS_SUL, PICOS), 6);
  });
});

describe('orderByProximity', () => {
  it('visita primeiro o ponto mais proximo do inicio', () => {
    const pontos = [PICOS_SUL, PICOS];
    expect(orderByProximity(pontos, PICOS)[0]).toBe(1);
  });

  it('devolve todos os indices exatamente uma vez', () => {
    const pontos = [PICOS, PICOS_SUL, { latitude: -7.08, longitude: -43.11 }];
    const order = orderByProximity(pontos, PICOS);
    expect(order).toHaveLength(pontos.length);
    expect([...order].sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });

  it('devolve lista vazia sem pontos', () => {
    expect(orderByProximity([], PICOS)).toEqual([]);
  });
});

describe('describeGeometrySource', () => {
  it('diz quando o trajeto veio da malha viaria', () => {
    expect(describeGeometrySource(true, 'osrm')).toContain('malha viaria');
  });

  it('exige qualificar como estimativa quando e linha reta', () => {
    // Requisito: nunca apresentar reta como se fosse rota pelas ruas.
    const texto = describeGeometrySource(false, 'heuristic-offline');
    expect(texto).toContain('estimado');
    expect(texto).toContain('linha reta');
  });
});