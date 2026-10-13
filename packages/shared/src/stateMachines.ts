/**
 * Maquinas de estado de jornada e visita.
 * Regras de negocio moram AQUI (e nao em componentes de UI nem em controllers):
 * qualquer camada que tente uma transicao invalida recebe um erro de dominio.
 */
import { JourneyStatus, VisitStatus } from './enums';

export const JOURNEY_TRANSITIONS: Record<JourneyStatus, readonly JourneyStatus[]> = {
  [JourneyStatus.EM_ANDAMENTO]: [
    JourneyStatus.PAUSADA,
    JourneyStatus.FINALIZADA,
    JourneyStatus.CANCELADA,
  ],
  [JourneyStatus.PAUSADA]: [
    JourneyStatus.EM_ANDAMENTO,
    JourneyStatus.FINALIZADA,
    JourneyStatus.CANCELADA,
  ],
  [JourneyStatus.FINALIZADA]: [],
  [JourneyStatus.CANCELADA]: [],
};

export const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  // PLANEJADA -> CHEGADA_REGISTRADA tambem e permitido: se o app ficou
  // offline ou o motorista nao registrou a saida, a chegada continua valida
  // e a medicao de deslocamento fica marcada como incompleta/estimada.
  [VisitStatus.PLANEJADA]: [
    VisitStatus.EM_DESLOCAMENTO,
    VisitStatus.CHEGADA_REGISTRADA,
    VisitStatus.NAO_REALIZADA,
    VisitStatus.CANCELADA,
  ],
  [VisitStatus.EM_DESLOCAMENTO]: [
    VisitStatus.CHEGADA_REGISTRADA,
    VisitStatus.NAO_REALIZADA,
    VisitStatus.CANCELADA,
  ],
  [VisitStatus.CHEGADA_REGISTRADA]: [
    VisitStatus.EM_ATENDIMENTO,
    VisitStatus.NAO_REALIZADA,
  ],
  [VisitStatus.EM_ATENDIMENTO]: [
    VisitStatus.CONCLUIDA,
    VisitStatus.NAO_REALIZADA,
  ],
  [VisitStatus.CONCLUIDA]: [],
  [VisitStatus.NAO_REALIZADA]: [],
  [VisitStatus.CANCELADA]: [],
};

export class DomainRuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainRuleError';
    this.code = code;
  }
}

export function canTransitionJourney(
  current: JourneyStatus,
  next: JourneyStatus,
): boolean {
  return JOURNEY_TRANSITIONS[current]?.includes(next) ?? false;
}

export function canTransitionVisit(current: VisitStatus, next: VisitStatus): boolean {
  return VISIT_TRANSITIONS[current]?.includes(next) ?? false;
}

export function assertJourneyTransition(current: JourneyStatus, next: JourneyStatus): void {
  if (current === next) {
    throw new DomainRuleError(
      'JOURNEY_ALREADY_IN_STATE',
      `A jornada ja esta em ${next}. Transicao ignorada para nao duplicar contabilizacao.`,
    );
  }
  if (!canTransitionJourney(current, next)) {
    throw new DomainRuleError(
      'JOURNEY_INVALID_TRANSITION',
      `Transicao de jornada invalida: ${current} -> ${next}.`,
    );
  }
}

export interface VisitTransitionContext {
  hasArrival: boolean;
  hasServiceStart: boolean;
  /** Regra configuravel: exige chegada E inicio de atendimento para concluir. */
  requireServiceBeforeConclusion?: boolean;
}

/**
 * Regras de transicao de visita, incluindo a exigencia de eventos minimos:
 * nao permite concluir um atendimento sem ter registrado chegada e inicio.
 */
export function assertVisitTransition(
  current: VisitStatus,
  next: VisitStatus,
  ctx: VisitTransitionContext,
): void {
  if (current === next) {
    throw new DomainRuleError(
      'VISIT_ALREADY_IN_STATE',
      `A visita ja esta em ${next}. Evento repetido registrado como duplicado.`,
    );
  }
  if (!canTransitionVisit(current, next)) {
    throw new DomainRuleError(
      'VISIT_INVALID_TRANSITION',
      `Transicao de visita invalida: ${current} -> ${next}.`,
    );
  }
  const requiresService = ctx.requireServiceBeforeConclusion ?? true;
  if (next === VisitStatus.CONCLUIDA && requiresService) {
    if (!ctx.hasArrival) {
      throw new DomainRuleError(
        'VISIT_MISSING_ARRIVAL',
        'Nao e possivel concluir a visita sem horario de chegada registrado.',
      );
    }
    if (!ctx.hasServiceStart) {
      throw new DomainRuleError(
        'VISIT_MISSING_SERVICE_START',
        'Nao e possivel concluir a visita sem horario de inicio de atendimento.',
      );
    }
  }
  if (next === VisitStatus.EM_ATENDIMENTO && !ctx.hasArrival) {
    throw new DomainRuleError(
      'VISIT_MISSING_ARRIVAL',
      'Chegada deve ser registrada antes do inicio do atendimento.',
    );
  }
}
