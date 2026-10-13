import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FreshnessStrip, MetricTile, StatusBadge } from './ui';

describe('StatusBadge', () => {
  it('sempre mostra o rotulo textual, nunca apenas cor', () => {
    render(<StatusBadge label="CONCLUIDA" tone="ok" />);
    expect(screen.getByText('CONCLUIDA')).toBeTruthy();
  });

  it('usa rotulo SEM DADO quando nao ha informacao', () => {
    render(<StatusBadge label="SEM DADO" tone="neutral" />);
    expect(screen.getByText('SEM DADO')).toBeTruthy();
  });
});

describe('MetricTile', () => {
  it('exige a linha de contexto alem do numero', () => {
    render(<MetricTile label="Clientes atendidos" value={12} context="de 18 planejados" tone="ok" />);
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('de 18 planejados')).toBeTruthy();
  });
});

describe('FreshnessStrip', () => {
  it('nao apresenta dado antigo como atual', () => {
    render(<FreshnessStrip ageSeconds={3600} freshness="DESATUALIZADO" />);
    expect(screen.getByText(/DESATUALIZADO/)).toBeTruthy();
  });

  it('rotula dado indisponivel', () => {
    render(<FreshnessStrip ageSeconds={null} freshness="INDISPONIVEL" />);
    expect(screen.getByText(/SEM DADO/)).toBeTruthy();
  });

  it('marca dado atual', () => {
    render(<FreshnessStrip ageSeconds={5} freshness="ATUAL" />);
    expect(screen.getByText(/ATUAL/)).toBeTruthy();
  });
});
