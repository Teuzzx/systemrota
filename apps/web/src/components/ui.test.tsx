import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ConnectionPill, FreshnessStrip, MetricTile, ProgressBar, SkeletonRows, StatusBadge,
} from './ui';

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

describe('ProgressBar', () => {
  it('NAO desenha 0% quando nao ha dado suficiente', () => {
    // Regra dura: "sem dado" e diferente de "zero". Um 0% sem contexto
    // levaria o operador a concluir que a operacao parou.
    render(<ProgressBar pct={null} label="Conclusao" />);
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getByText(/Sem dado suficiente/)).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('desenha zero real quando o dado existe e vale zero', () => {
    render(<ProgressBar pct={0} label="Conclusao" detail="0 de 18" />);
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('expone o valor para leitores de tela', () => {
    render(<ProgressBar pct={62.4} label="Conclusao" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('62');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByText('62%')).toBeTruthy();
  });

  it('limita valores fora da faixa em vez de quebrar o layout', () => {
    render(<ProgressBar pct={140} label="Conclusao" />);
    expect(screen.getByText('100%')).toBeTruthy();
  });
});

describe('ConnectionPill', () => {
  it('distingue offline de reconectando', () => {
    const { unmount } = render(<ConnectionPill state="offline" />);
    expect(screen.getByText('SEM CONEXAO')).toBeTruthy();
    unmount();
    render(<ConnectionPill state="reconectando" />);
    expect(screen.getByText('RECONECTANDO')).toBeTruthy();
  });

  it('mostra a hora da ultima atualizacao quando informada', () => {
    render(<ConnectionPill state="conectado" lastUpdatedLabel="14:32:05" />);
    expect(screen.getByText('AO VIVO')).toBeTruthy();
    expect(screen.getByText(/14:32:05/)).toBeTruthy();
  });
});

describe('SkeletonRows', () => {
  it('anuncia o carregamento para leitores de tela', () => {
    render(<SkeletonRows rows={3} label="Carregando clientes" />);
    expect(screen.getByRole('status').textContent).toContain('Carregando clientes');
  });
});
