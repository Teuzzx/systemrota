import { describe, expect, it } from 'vitest';
import { project } from './OperationalMap';

describe('Projecao do mapa operacional', () => {
  const p1 = { latitude: -7.07, longitude: -45.01 };
  const p2 = { latitude: -7.09, longitude: -45.04 };

  it('mantem pontos dentro da area de desenho', () => {
    const projectPoint = project([p1, p2]);
    const a = projectPoint(p1.latitude, p1.longitude);
    const b = projectPoint(p2.latitude, p2.longitude);
    for (const point of [a, b]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(900);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(520);
    }
  });

  it('inverte o eixo Y (mais ao norte = mais acima na tela)', () => {
    const projectPoint = project([p1, p2]);
    // p2 esta mais ao sul (-7.09) que p1 (-7.07): deve ficar mais abaixo.
    const norte = projectPoint(p1.latitude, p1.longitude);
    const sul = projectPoint(p2.latitude, p2.longitude);
    expect(norte.y).toBeLessThan(sul.y);
  });

  it('nao quebra com um unico ponto (divisao por zero)', () => {
    const projectPoint = project([p1]);
    const point = projectPoint(p1.latitude, p1.longitude);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  it('nao quebra sem nenhum ponto', () => {
    const projectPoint = project([]);
    expect(projectPoint(0, 0).x).toBe(450);
  });
});
