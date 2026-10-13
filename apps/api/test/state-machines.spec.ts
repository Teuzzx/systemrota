import {
  assertJourneyTransition,
  assertVisitTransition,
  DomainRuleError,
  canTransitionVisit,
  JOURNEY_TRANSITIONS,
  VISIT_TRANSITIONS,
} from '@rota/shared';
import { JourneyStatus, VisitStatus } from '@rota/shared';

describe('Maquina de estados da jornada', () => {
  it('permite pausar, finalizar e cancelar a partir de EM_ANDAMENTO', () => {
    expect(JOURNEY_TRANSITIONS[JourneyStatus.EM_ANDAMENTO]).toEqual(
      expect.arrayContaining([JourneyStatus.PAUSADA, JourneyStatus.FINALIZADA, JourneyStatus.CANCELADA]),
    );
  });

  it('nao permite iniciar uma jornada a partir de FINALIZADA', () => {
    expect(() =>
      assertJourneyTransition(JourneyStatus.FINALIZADA, JourneyStatus.EM_ANDAMENTO),
    ).toThrow(DomainRuleError);
  });

  it('trata reenvio do mesmo estado como duplicado, nao como nova transicao', () => {
    expect(() =>
      assertJourneyTransition(JourneyStatus.FINALIZADA, JourneyStatus.FINALIZADA),
    ).toThrow(/ja esta em/i);
  });

  it('impede finalizar duas vezes', () => {
    expect(() =>
      assertJourneyTransition(JourneyStatus.FINALIZADA, JourneyStatus.FINALIZADA),
    ).toThrow(/duplicado|ja esta/i);
  });

  it('permite retomar a partir de PAUSADA', () => {
    expect(() =>
      assertJourneyTransition(JourneyStatus.PAUSADA, JourneyStatus.EM_ANDAMENTO),
    ).not.toThrow();
  });
});

describe('Maquina de estados da visita', () => {
  it('descreve o fluxo completo planejada -> concluida', () => {
    expect(canTransitionVisit(VisitStatus.PLANEJADA, VisitStatus.EM_DESLOCAMENTO)).toBe(true);
    expect(canTransitionVisit(VisitStatus.EM_DESLOCAMENTO, VisitStatus.CHEGADA_REGISTRADA)).toBe(true);
    expect(canTransitionVisit(VisitStatus.CHEGADA_REGISTRADA, VisitStatus.EM_ATENDIMENTO)).toBe(true);
    expect(canTransitionVisit(VisitStatus.EM_ATENDIMENTO, VisitStatus.CONCLUIDA)).toBe(true);
  });

  it('impede pular a chegada antes de iniciar o atendimento', () => {
    expect(canTransitionVisit(VisitStatus.PLANEJADA, VisitStatus.EM_ATENDIMENTO)).toBe(false);
    expect(() =>
      assertVisitTransition(VisitStatus.CHEGADA_REGISTRADA, VisitStatus.EM_ATENDIMENTO, {
        hasArrival: true,
        hasServiceStart: false,
      }),
    ).not.toThrow();
  });

  it('nao conclui visita sem os eventos minimos exigidos', () => {
    expect(() =>
      assertVisitTransition(VisitStatus.EM_ATENDIMENTO, VisitStatus.CONCLUIDA, {
        hasArrival: false,
        hasServiceStart: true,
      }),
    ).toThrow(/chegada/i);

    expect(() =>
      assertVisitTransition(VisitStatus.EM_ATENDIMENTO, VisitStatus.CONCLUIDA, {
        hasArrival: true,
        hasServiceStart: false,
      }),
    ).toThrow(/inicio de atendimento/i);
  });

  it('bloqueia sair de estados terminais', () => {
    for (const terminal of [VisitStatus.CONCLUIDA, VisitStatus.NAO_REALIZADA, VisitStatus.CANCELADA]) {
      expect(Object.values(VISIT_TRANSITIONS[terminal])).toHaveLength(0);
    }
  });
});
