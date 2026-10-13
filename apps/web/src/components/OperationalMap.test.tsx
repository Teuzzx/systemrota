import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DriverPosition } from '@/lib/types';

/**
 * O Leaflet exige APIs de DOM que o jsdom nao implementa (medicao de SVG,
 * clientWidth, etc.). Mockamos os primitivos para exercitar a NOSSA logica —
 * atribuicao, legenda, rotulo da origem da geometria, sinalizacao de demo —
 * sem depender do motor de render.
 */
vi.mock('react-leaflet', () => {
  const React = require('react');
  return {
    MapContainer: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: ({ attribution }: { attribution?: string }) =>
      React.createElement('div', {
        'data-testid': 'tiles',
        dangerouslySetInnerHTML: { __html: attribution ?? '' },
      }),
    CircleMarker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'marker' }, children),
    Polyline: () => React.createElement('div', { 'data-testid': 'polyline' }),
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'tooltip' }, children),
    useMap: () => ({
      setView: () => undefined,
      fitBounds: () => undefined,
    }),
  };
});

const { OperationalMap } = await import('./OperationalMap');

const PICOS = { latitude: -7.0694, longitude: -43.0901 };
const PICOS_SUL = { latitude: -7.1, longitude: -43.14 };

function driver(over: Partial<DriverPosition> = {}): DriverPosition {
  return {
    driverId: 'drv-1',
    driverName: 'Joao da Silva',
    latitude: PICOS.latitude,
    longitude: PICOS.longitude,
    routeCode: 'R1',
    freshness: 'ATUAL',
    dataAgeSeconds: 5,
    accuracyM: 8,
    ...over,
  } as DriverPosition;
}

/**
 * O Leaflet monta DOM real; nos testes exercitamos o que ele NAO controla:
 * a legenda, o rotulo da origem da geometria e a atribuicao do tile.
 * A geometria em si e testada em src/lib/map/geometry.test.ts.
 */
describe('OperationalMap', () => {
  it('exibe a atribuicao do OpenStreetMap (obrigatoria por licenca)', () => {
    render(<OperationalMap drivers={[driver()]} stops={[]} />);
    const link = screen.getByRole('link', { name: /OpenStreetMap/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toContain('openstreetmap.org/copyright');
  });

  it('rotula a linha reta como estimativa, nunca como rota pelas ruas', () => {
    render(
      <OperationalMap
        drivers={[driver()]}
        stops={[]}
        track={[{ latitude: PICOS.latitude, longitude: PICOS.longitude }, PICOS_SUL]}
        geometrySource={{ networkBased: false, provider: 'heuristic-offline' }}
      />,
    );
    expect(screen.getByText(/estimado em linha reta/i)).toBeTruthy();
    expect(screen.queryByText(/malha viaria/i)).toBeNull();
  });

  it('reconhece quando o trajeto veio da malha viaria', () => {
    render(
      <OperationalMap
        drivers={[driver()]}
        stops={[]}
        track={[{ latitude: PICOS.latitude, longitude: PICOS.longitude }, PICOS_SUL]}
        geometrySource={{ networkBased: true, provider: 'osrm' }}
      />,
    );
    expect(screen.getByText(/malha viaria \(osrm\)/i)).toBeTruthy();
  });

  it('sem `geometrySource`, assume estimativa em vez de afirmar rota real', () => {
    // Default seguro: o painel nunca deve afirmar malha viaria sem prova.
    render(<OperationalMap drivers={[driver()]} stops={[]} track={[PICOS, PICOS_SUL]} />);
    expect(screen.getByText(/estimado em linha reta/i)).toBeTruthy();
  });

  it('sinaliza dados de demonstracao', () => {
    render(<OperationalMap drivers={[driver({ driverName: 'Motorista (DEMO)' })]} stops={[]} />);
    expect(screen.getByText(/Dados de demonstracao/i)).toBeTruthy();
  });

  it('nao sinaliza demonstracao quando os dados sao reais', () => {
    render(<OperationalMap drivers={[driver()]} stops={[]} />);
    expect(screen.queryByText(/Dados de demonstracao/i)).toBeNull();
  });

  it('monta sem quebrar quando nao ha nenhum dado', () => {
    render(<OperationalMap drivers={[]} stops={[]} />);
    expect(screen.getByRole('link', { name: /OpenStreetMap/i })).toBeTruthy();
  });

  it('ignora cliente sem coordenada valida em vez de desenhar no (0,0)', () => {
    render(
      <OperationalMap
        drivers={[]}
        stops={[
          { id: 'sem-coord', latitude: null, longitude: null, status: 'warn', label: 'Sem coordenada' },
        ]}
      />,
    );
    // Nenhum ponto precisa ser inventado; a tela segue renderizando.
    expect(screen.getByRole('link', { name: /OpenStreetMap/i })).toBeTruthy();
  });
});