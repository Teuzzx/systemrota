/**
 * Enums de dominio compartilhados entre API, web e app Android.
 * Sao `const objects` (nao enums TS) para que o mesmo valor funcione em
 * codigo compilado (backend) e em codigo interpretado/enviado via JSON.
 */

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  PENDING_ACTIVATION: 'PENDING_ACTIVATION',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const RoleKey = {
  ADMINISTRADOR: 'ADMINISTRADOR',
  SUPERVISOR: 'SUPERVISOR',
  MOTORISTA: 'MOTORISTA',
} as const;
export type RoleKey = (typeof RoleKey)[keyof typeof RoleKey];

export const DriverStatus = {
  ATIVO: 'ATIVO',
  INATIVO: 'INATIVO',
  FERIAS: 'FERIAS',
} as const;
export type DriverStatus = (typeof DriverStatus)[keyof typeof DriverStatus];

export const CustomerStatus = {
  ATIVO: 'ATIVO',
  INATIVO: 'INATIVO',
  PENDENTE_REVISAO: 'PENDENTE_REVISAO',
} as const;
export type CustomerStatus = (typeof CustomerStatus)[keyof typeof CustomerStatus];

export const GeocodeStatus = {
  /** Coordenadas validadas por faixa de valores e por checagem de pais. */
  VALIDADO: 'VALIDADO',
  /** Coordenadas presentes mas ainda nao validadas. */
  PENDENTE: 'PENDENTE',
  /** Coordenadas fora de faixa ou incoerentes (lat/lng trocados, etc.). */
  INVALIDO: 'INVALIDO',
  /** Nenhuma coordenada informada. */
  AUSENTE: 'AUSENTE',
} as const;
export type GeocodeStatus = (typeof GeocodeStatus)[keyof typeof GeocodeStatus];

export const RouteStatus = {
  PLANEJADA: 'PLANEJADA',
  ATRIBUIDA: 'ATRIBUIDA',
  PUBLICADA: 'PUBLICADA',
  EM_EXECUCAO: 'EM_EXECUCAO',
  PAUSADA: 'PAUSADA',
  CONCLUIDA: 'CONCLUIDA',
  CANCELADA: 'CANCELADA',
  ARQUIVADA: 'ARQUIVADA',
} as const;
export type RouteStatus = (typeof RouteStatus)[keyof typeof RouteStatus];

export const JourneyStatus = {
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  PAUSADA: 'PAUSADA',
  FINALIZADA: 'FINALIZADA',
  CANCELADA: 'CANCELADA',
} as const;
export type JourneyStatus = (typeof JourneyStatus)[keyof typeof JourneyStatus];

export const VisitStatus = {
  PLANEJADA: 'PLANEJADA',
  EM_DESLOCAMENTO: 'EM_DESLOCAMENTO',
  CHEGADA_REGISTRADA: 'CHEGADA_REGISTRADA',
  EM_ATENDIMENTO: 'EM_ATENDIMENTO',
  CONCLUIDA: 'CONCLUIDA',
  NAO_REALIZADA: 'NAO_REALIZADA',
  CANCELADA: 'CANCELADA',
} as const;
export type VisitStatus = (typeof VisitStatus)[keyof typeof VisitStatus];

export const JourneyEventType = {
  JOURNEY_STARTED: 'JOURNEY_STARTED',
  JOURNEY_PAUSED: 'JOURNEY_PAUSED',
  JOURNEY_RESUMED: 'JOURNEY_RESUMED',
  JOURNEY_FINISHED: 'JOURNEY_FINISHED',
  JOURNEY_CANCELLED: 'JOURNEY_CANCELLED',
  VISIT_ARRIVED: 'VISIT_ARRIVED',
  VISIT_SERVICE_STARTED: 'VISIT_SERVICE_STARTED',
  VISIT_SERVICE_ENDED: 'VISIT_SERVICE_ENDED',
  VISIT_NOT_DONE: 'VISIT_NOT_DONE',
  VISIT_CANCELLED: 'VISIT_CANCELLED',
  OCCURRENCE_LOGGED: 'OCCURRENCE_LOGGED',
  ROUTE_VERSION_CONFLICT: 'ROUTE_VERSION_CONFLICT',
} as const;
export type JourneyEventType = (typeof JourneyEventType)[keyof typeof JourneyEventType];

export const MeasurementQuality = {
  /** Medida por eventos de chegada/saida sem lacunas. */
  EXATA: 'EXATA',
  /** Reconstruida a partir de estimativa do provedor de rotas. */
  ESTIMADA: 'ESTIMADA',
  /** Faltam eventos (ex.: app encerrado) e a duracao e parcial. */
  INCOMPLETA: 'INCOMPLETA',
} as const;
export type MeasurementQuality = (typeof MeasurementQuality)[keyof typeof MeasurementQuality];

export const EventSource = {
  GPS: 'GPS',
  MANUAL: 'MANUAL',
} as const;
export type EventSource = (typeof EventSource)[keyof typeof EventSource];

export const OccurrenceType = {
  ESTABELECIMENTO_FECHADO: 'ESTABELECIMENTO_FECHADO',
  CLIENTE_INDISPONIVEL: 'CLIENTE_INDISPONIVEL',
  ENDERECO_INCORRETO: 'ENDERECO_INCORRETO',
  PROBLEMA_DE_ACESSO: 'PROBLEMA_DE_ACESSO',
  PROBLEMA_OPERACIONAL: 'PROBLEMA_OPERACIONAL',
  OUTRO: 'OUTRO',
} as const;
export type OccurrenceType = (typeof OccurrenceType)[keyof typeof OccurrenceType];

export const AlertSeverity = {
  INFO: 'INFO',
  AVISO: 'AVISO',
  CRITICO: 'CRITICO',
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

export const AlertStatus = {
  ABERTO: 'ABERTO',
  RECONHECIDO: 'RECONHECIDO',
  RESOLVIDO: 'RESOLVIDO',
  SILENCIADO: 'SILENCIADO',
} as const;
export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];

export const Connectivity = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  DEGRADADO: 'DEGRADADO',
} as const;
export type Connectivity = (typeof Connectivity)[keyof typeof Connectivity];

export const FuelType = {
  GASOLINA: 'GASOLINA',
  ETANOL: 'ETANOL',
  DIESEL: 'DIESEL',
  GNV: 'GNV',
  FLEX: 'FLEX',
} as const;
export type FuelType = (typeof FuelType)[keyof typeof FuelType];

export const ImportStatus = {
  UPLOADED: 'UPLOADED',
  VALIDATING: 'VALIDATING',
  VALIDATED: 'VALIDATED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
  REVERTED: 'REVERTED',
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];
