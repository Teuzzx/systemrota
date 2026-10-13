import { describe, expect, it } from 'vitest';
import {
  formatDataAge, formatDistance, formatDuration, formatPercent,
  freshnessTone, geocodeTone, journeyStatusLabel, routeStatusLabel, severityTone, visitStatusLabel,
} from './format';

describe('Formatacao de duracao', () => {
  it('formata horas e minutos', () => {
    expect(formatDuration(3725)).toBe('1h 02m');
    expect(formatDuration(180)).toBe('3m');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('nunca devolve numero cru sem rotulo', () => {
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(undefined)).toBe('--');
    expect(formatDuration(Number.NaN)).toBe('--');
  });

  it('protege contra valor negativo', () => {
    expect(formatDuration(-100)).toBe('0s');
  });
});

describe('Formatacao de distancia', () => {
  it('escolhe unidade conforme a magnitude', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(1500)).toBe('1,5 km');
    expect(formatDistance(125000)).toBe('125 km');
  });

  it('mostra -- quando nao ha dado', () => {
    expect(formatDistance(null)).toBe('--');
  });
});

describe('Idade do dado', () => {
  it('nunca descreve dado antigo como atual', () => {
    expect(formatDataAge(null)).toBe('sem dado');
    expect(formatDataAge(10)).toBe('agora');
    expect(formatDataAge(180)).toBe('ha 3 min');
    expect(formatDataAge(7200)).toBe('ha 2h');
    expect(formatDataAge(7500)).toBe('ha 2h 05min');
    expect(formatDataAge(90000)).toBe('ha 1d 1h');
  });
});

describe('Rotulos de status (regra: nunca so cor)', () => {
  it('traduz estados de visita', () => {
    expect(visitStatusLabel('CONCLUIDA')).toEqual({ label: 'CONCLUIDA', tone: 'ok' });
    expect(visitStatusLabel('EM_ATENDIMENTO').tone).toBe('progress');
    expect(visitStatusLabel('NAO_REALIZADA').tone).toBe('warn');
    expect(visitStatusLabel('DESCONHECIDO').label).toBe('DESCONHECIDO');
    expect(visitStatusLabel('').label).toBe('SEM DADO');
  });

  it('traduz estados de jornada e rota', () => {
    expect(journeyStatusLabel('FINALIZADA').tone).toBe('ok');
    expect(journeyStatusLabel('PAUSADA').tone).toBe('warn');
    expect(routeStatusLabel('EM_EXECUCAO').label).toBe('EM EXECUCAO');
    expect(routeStatusLabel('ARQUIVADA').tone).toBe('neutral');
  });

  it('destaca cliente sem coordenada', () => {
    expect(geocodeTone('AUSENTE')).toEqual({ label: 'SEM COORDENADA', tone: 'neutral' });
    expect(geocodeTone('INVALIDO').tone).toBe('critical');
    expect(geocodeTone('VALIDADO').tone).toBe('ok');
  });

  it('mapeia severidade e desatualizacao', () => {
    expect(severityTone('CRITICO')).toBe('critical');
    expect(severityTone('AVISO')).toBe('warn');
    expect(freshnessTone('ATUAL')).toBe('ok');
    expect(freshnessTone('DESATUALIZADO')).toBe('critical');
    expect(freshnessTone('INDISPONIVEL')).toBe('neutral');
  });
});

describe('Percentual', () => {
  it('usa virgula decimal e trata ausencia', () => {
    expect(formatPercent(42.5, 1)).toBe('42,5%');
    expect(formatPercent(null)).toBe('--');
  });
});
