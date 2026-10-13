import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JourneyStatus, Prisma, RouteStatus, VisitStatus } from '@prisma/client';
import {
  assertJourneyTransition,
  assertVisitTransition,
  buildTimeBreakdown,
  DomainRuleError,
  estimateRemaining,
  JourneyTimeBreakdown,
  OccurrenceType,
} from '@rota/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';

export interface StartJourneyInput {
  driverUserId: string;
  routeId?: string | null;
  routeVersionId?: string | null;
  routeVersionAtStart?: number | null;
  startedAt: string;
}

export interface VisitEventInput {
  journeyId: string;
  customerId: string;
  sequence?: number;
  capturedAt: string;
  type: 'ARRIVED' | 'SERVICE_STARTED' | 'SERVICE_ENDED' | 'NOT_DONE';
  notDoneReason?: OccurrenceType | null;
  notDoneNote?: string | null;
  source?: 'GPS' | 'MANUAL';
  manualJustification?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
}

/**
 * Regras de jornada e visita.
 *
 * Este servico e o UNICO autorizado a mudar estado de jornada/visita.
 * Garantias de banco (indice unico parcial) complementam a regra de aplicacao,
 * protecting contra corrida entre dois dispositivos do mesmo motorista.
 */
@Injectable()
export class JourneysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Uma jornada ativa por motorista (EM_ANDAMENTO ou PAUSADA). */
  async findActive(driverId: string) {
    return this.prisma.journey.findFirst({
      where: { driverId, status: { in: [JourneyStatus.EM_ANDAMENTO, JourneyStatus.PAUSADA] } },
      orderBy: { startedAt: 'desc' },
      include: {
        route: { select: { id: true, code: true, name: true, plannedDate: true, currentVersion: true } },
        visits: { orderBy: { sequence: 'asc' } },
      },
    });
  }

  async start(input: StartJourneyInput, meta: { ip?: string | null; userAgent?: string | null }) {
    const driver = await this.prisma.driver.findUnique({ where: { userId: input.driverUserId } });
    if (!driver) throw new ForbiddenException('Usuario nao possui perfil de motorista.');
    if (driver.status !== 'ATIVO') throw new ForbiddenException('Motorista inativo.');

    const existing = await this.findActive(driver.id);
    if (existing) {
      throw new ConflictException(
        `Ja existe uma jornada em andamento (iniciada em ${existing.startedAt.toISOString()}). Finalize ou cancele antes de iniciar outra.`,
      );
    }

    let route: { id: string; currentVersion: number; status: RouteStatus } | null = null;
    if (input.routeId) {
      route = await this.prisma.route.findUnique({
        where: { id: input.routeId },
        select: { id: true, currentVersion: true, status: true },
      });
      if (!route) throw new NotFoundException('Rota nao encontrada.');
    }

    const startedAt = new Date(input.startedAt);
    if (Number.isNaN(startedAt.getTime())) throw new BadRequestException('startedAt invalido.');

    // Jornada sem rota e permitida (registro de deslocamento sem atendimento),
    // mas fica explicitamente sinalizada: stopsPlanned = 0.
    const journey = await this.prisma.$transaction(async (tx) => {
      const created = await tx.journey.create({
        data: {
          driverId: driver.id,
          routeId: route?.id ?? null,
          routeVersionId: input.routeVersionId ?? null,
          routeVersionAtStart: input.routeVersionAtStart ?? route?.currentVersion ?? null,
          status: JourneyStatus.EM_ANDAMENTO,
          startedAt,
          stopsPlanned: 0,
        },
      });

      if (route) {
        const versionId = input.routeVersionId ?? (
          await tx.routeVersion.findUnique({
            where: { routeId_version: { routeId: route.id, version: route.currentVersion } },
          })
        )?.id;
        if (versionId) {
          const stops = await tx.routeStop.findMany({
            where: { routeVersionId: versionId },
            orderBy: { sequence: 'asc' },
            select: { id: true, customerId: true, sequence: true, plannedArrivalAt: true },
          });
          for (const stop of stops) {
            await tx.visit.create({
              data: {
                journeyId: created.id,
                routeStopId: stop.id,
                customerId: stop.customerId,
                driverId: driver.id,
                sequence: stop.sequence,
                status: VisitStatus.PLANEJADA,
                plannedArrivalAt: stop.plannedArrivalAt,
              },
            });
          }
          await tx.journey.update({
            where: { id: created.id },
            data: { stopsPlanned: stops.length, routeVersionId: versionId },
          });
          await tx.route.update({
            where: { id: route.id },
            data: { status: RouteStatus.EM_EXECUCAO, startedAt },
          });
        }
      }
      return tx.journey.findUniqueOrThrow({
        where: { id: created.id },
        include: { visits: { orderBy: { sequence: 'asc' } } },
      });
    });

    await this.audit.record({
      actorId: input.driverUserId, action: 'journey.started', entity: 'Journey', entityId: journey.id,
      after: { routeId: route?.id ?? null, startedAt: startedAt.toISOString() }, ...meta,
    });
    return journey;
  }

  async pause(journeyId: string, driverId: string, capturedAt: string, meta: Record<string, unknown> = {}) {
    const journey = await this.requireJourney(journeyId);
    this.assertOwnership(journey, driverId);
    assertJourneyTransition(journey.status, JourneyStatus.PAUSADA);
    const updated = await this.prisma.journey.update({
      where: { id: journeyId },
      data: { status: JourneyStatus.PAUSADA },
    });
    await this.audit.record({
      actorId: await this.userIdForDriver(driverId), action: 'journey.paused', entity: 'Journey', entityId: journeyId,
      after: { capturedAt, ...meta },
    });
    return updated;
  }

  async resume(journeyId: string, driverId: string) {
    const journey = await this.requireJourney(journeyId);
    this.assertOwnership(journey, driverId);
    assertJourneyTransition(journey.status, JourneyStatus.EM_ANDAMENTO);
    return this.prisma.journey.update({ where: { id: journeyId }, data: { status: JourneyStatus.EM_ANDAMENTO } });
  }

  /**
   * Encerramento: consolida tempos e distancia ANTES de finalizar, para que o
   * historico ja saia correto. Pausas sao descontadas e nao contadas como
   * atendimento ou deslocamento.
   */
  async finish(journeyId: string, driverId: string, capturedAt: string, pauseTotalS: number) {
    const journey = await this.requireJourney(journeyId);
    this.assertOwnership(journey, driverId);
    assertJourneyTransition(journey.status, JourneyStatus.FINALIZADA);
    const endedAt = new Date(capturedAt);
    if (endedAt.getTime() < journey.startedAt.getTime()) {
      throw new BadRequestException('Encerramento anterior ao inicio da jornada.');
    }

    const breakdown = await this.buildBreakdown(journeyId);
    const visits = await this.prisma.visit.findMany({ where: { journeyId } });
    const concluded = visits.filter((v) => v.status === VisitStatus.CONCLUIDA).length;
    const notDone = visits.filter((v) => v.status === VisitStatus.NAO_REALIZADA).length;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.journey.update({
        where: { id: journeyId },
        data: {
          status: JourneyStatus.FINALIZADA,
          endedAt,
          pauseTotalS: Math.max(0, Math.round(pauseTotalS)),
          travelTotalS: breakdown.totals.DESLOCAMENTO,
          serviceTotalS: breakdown.totals.ATENDIMENTO,
          unclassifiedS: breakdown.unclassifiedS,
          stopsConcluded: concluded,
          stopsNotDone: notDone,
        },
      });
      if (journey.routeId) {
        await tx.route.updateMany({
          where: { id: journey.routeId, status: RouteStatus.EM_EXECUCAO },
          data: { status: RouteStatus.CONCLUIDA, endedAt },
        });
      }
      // Visitas ainda planejadas nao visitadas: o plano foi concluído como esta.
      await tx.visit.updateMany({
        where: { journeyId, status: { in: [VisitStatus.PLANEJADA, VisitStatus.EM_DESLOCAMENTO, VisitStatus.CHEGADA_REGISTRADA] } },
        data: { status: VisitStatus.NAO_REALIZADA },
      });      return result;
    });

    await this.audit.record({ actorId: await this.userIdForDriver(driverId), action: 'journey.finished', entity: 'Journey', entityId: journeyId });
    return { journey: updated, breakdown };
  }

  async cancel(journeyId: string, driverId: string, reason: string) {
    const journey = await this.requireJourney(journeyId);
    this.assertOwnership(journey, driverId);
    assertJourneyTransition(journey.status, JourneyStatus.CANCELADA);
    const updated = await this.prisma.journey.update({
      where: { id: journeyId },
      data: { status: JourneyStatus.CANCELADA, endedAt: new Date() },
    });
    if (journey.routeId) {
      await this.prisma.route.updateMany({
        where: { id: journey.routeId, status: { in: [RouteStatus.EM_EXECUCAO, RouteStatus.PUBLICADA] } },
        data: { status: RouteStatus.CANCELADA },
      });
    }
    await this.audit.record({ actorId: await this.userIdForDriver(driverId), action: 'journey.cancelled', entity: 'Journey', entityId: journeyId, after: { reason } });
    return updated;
  }

  // ------------------------------ Visitas --------------------------------

  /**
   * Registra um evento de visita e aplica a transicao de estado.
   * Chegada e inicio de atendimento sao eventos DISTINTOS: a chegada pode
   * ocorrer antes por espera do responsavel.
   */
  async recordVisitEvent(input: VisitEventInput, actorUserId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId: actorUserId } });
    if (!driver) throw new ForbiddenException('Usuario nao possui perfil de motorista.');
    const journey = await this.requireJourney(input.journeyId);
    this.assertOwnership(journey, driver.id);

    if (journey.status === JourneyStatus.FINALIZADA || journey.status === JourneyStatus.CANCELADA) {
      throw new ConflictException(`Jornada ${journey.status}: nao e possivel registrar novos eventos.`);
    }
    if (journey.status === JourneyStatus.PAUSADA) {
      throw new ConflictException('Jornada pausada: retome antes de registrar eventos de visita.');
    }

    const visit = await this.prisma.visit.findFirst({
      where: { journeyId: input.journeyId, customerId: input.customerId },
      orderBy: { sequence: 'asc' },
    });
    if (!visit) throw new NotFoundException('Cliente nao pertence a esta jornada.');

    const capturedAt = new Date(input.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw new BadRequestException('capturedAt invalido.');
    if (capturedAt < journey.startedAt) {
      throw new BadRequestException('Evento anterior ao inicio da jornada.');
    }

    const nextStatus = mapVisitEvent(input.type);

    try {
      assertVisitTransition(visit.status, nextStatus, {
        hasArrival: Boolean(visit.arrivedAt) || input.type === 'ARRIVED',
        hasServiceStart: Boolean(visit.serviceStartedAt) || input.type === 'SERVICE_STARTED',
      });
    } catch (error) {
      if (error instanceof DomainRuleError) {
        throw new ConflictException(`${error.code}: ${error.message}`);
      }
      throw error;
    }

    const previousVisit = { ...visit };
    const data: Prisma.VisitUpdateInput = {};
    if (input.type === 'ARRIVED') {
      data.arrivedAt = capturedAt;
      data.status = nextStatus;
      data.source = input.source ?? visit.source;
      data.manualJustification = input.manualJustification ?? null;
    }
    if (input.type === 'SERVICE_STARTED') {
      data.serviceStartedAt = capturedAt;
      data.status = nextStatus;
    }
    if (input.type === 'SERVICE_ENDED') {
      data.serviceEndedAt = capturedAt;
      data.status = nextStatus;
    }
    if (input.type === 'NOT_DONE') {
      if (!input.notDoneReason) {
        throw new BadRequestException('Visita nao realizada exige justificativa (motivo).');
      }
      data.status = nextStatus;
      data.notDoneReason = input.notDoneReason;
      data.notDoneNote = input.notDoneNote ?? null;
      data.arrivedAt = visit.arrivedAt ?? capturedAt;
      data.source = input.source ?? visit.source;
      data.manualJustification = input.manualJustification ?? null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.visit.update({ where: { id: visit.id }, data });
      // Recalcula duracoes derivadas com os eventos reais.
      const fresh = await tx.visit.findUniqueOrThrow({ where: { id: visit.id } });
      const serviceDurationS =
        fresh.serviceStartedAt && fresh.serviceEndedAt
          ? Math.round((fresh.serviceEndedAt.getTime() - fresh.serviceStartedAt.getTime()) / 1000)
          : null;
      const waitDurationS =
        fresh.arrivedAt && fresh.serviceStartedAt
          ? Math.round((fresh.serviceStartedAt.getTime() - fresh.arrivedAt.getTime()) / 1000)
          : null;
      return tx.visit.update({
        where: { id: visit.id },
        data: { serviceDurationS, waitDurationS },
      });
    });

    if (input.type === 'NOT_DONE') {
      await this.prisma.occurrence.create({
        data: {
          journeyId: journey.id,
          visitId: visit.id,
          driverId: driver.id,
          customerId: input.customerId,
          type: input.notDoneReason as OccurrenceType,
          description: input.notDoneNote ?? null,
          requiresFollowUp: true,
        },
      });
    }

    await this.refreshJourneyCounters(journey.id);

    await this.audit.record({
      actorId: actorUserId, action: `visit.${input.type.toLowerCase()}`, entity: 'Visit', entityId: visit.id,
      before: { status: previousVisit.status, arrivedAt: previousVisit.arrivedAt, serviceStartedAt: previousVisit.serviceStartedAt },
      after: { status: updated.status, arrivedAt: updated.arrivedAt, serviceStartedAt: updated.serviceStartedAt, serviceEndedAt: updated.serviceEndedAt },
    });

    return updated;
  }

  // --------------------------- Indicadores -------------------------------

  /** Linha do tempo da jornada com tempos separados e qualidade declarada. */
  async buildBreakdown(journeyId: string, scopeDriverId: string | null = null): Promise<JourneyTimeBreakdown> {
    const journey = await this.prisma.journey.findUniqueOrThrow({
      where: { id: journeyId },
      include: { visits: { orderBy: { sequence: 'asc' } } },
    });
    this.assertReadScope(journey, scopeDriverId);
    return buildTimeBreakdown(
      journey.startedAt,
      journey.endedAt,
      journey.visits.map((v) => ({
        sequence: v.sequence,
        customerId: v.customerId,
        arrivedAt: v.arrivedAt,
        serviceStartedAt: v.serviceStartedAt,
        serviceEndedAt: v.serviceEndedAt,
        plannedTravelS: null,
      })),
      journey.pauseTotalS,
    );
  }

  async summary(journeyId: string, scopeDriverId: string | null = null) {
    const journey = await this.prisma.journey.findUniqueOrThrow({
      where: { id: journeyId },
      include: {
        driver: { include: { user: { select: { name: true, email: true } } } },
        route: { select: { id: true, code: true, name: true } },
        visits: {
          orderBy: { sequence: 'asc' },
          include: { customer: { select: { tradeName: true, addressLine: true, neighborhood: true, city: true, phone: true } } },
        },
        occurrences: true,
      },
    });
    this.assertReadScope(journey, scopeDriverId);
    const breakdown = await this.buildBreakdown(journeyId, scopeDriverId);
    return {
      journey,
      breakdown,
      occurrences: journey.occurrences,
      conclusion: {
        planned: journey.stopsPlanned,
        concluded: journey.visits.filter((v) => v.status === VisitStatus.CONCLUIDA).length,
        notDone: journey.visits.filter((v) => v.status === VisitStatus.NAO_REALIZADA).length,
        pending: journey.visits.filter((v) => !(CLOSED_VISIT_STATUSES as readonly VisitStatus[]).includes(v.status)).length,
      },
    };
  }

  /**
   * PREVISAO DE CONCLUSAO. Sempre rotulada como estimativa, com nivel de
   * confianca. Nao e horario garantido.
   */
  async forecast(journeyId: string, defaultServiceS = 900, scopeDriverId: string | null = null) {
    const journey = await this.prisma.journey.findUniqueOrThrow({
      where: { id: journeyId },
      include: {
        visits: { orderBy: { sequence: 'asc' }, include: { customer: true } },
      },
    });
    this.assertReadScope(journey, scopeDriverId);
    const remaining = journey.visits.filter((v) => !(CLOSED_VISIT_STATUSES as readonly VisitStatus[]).includes(v.status));

    const historical = journey.visits
      .filter((v) => v.serviceDurationS !== null)
      .map((v) => v.serviceDurationS as number);

    const legs = remaining.map((stop) => ({
      distanceM: 0,
      durationS: 0,
      stop,
    }));

    const estimate = estimateRemaining({
      now: new Date(),
      remainingLegs: legs.map((l) => ({ distanceM: l.distanceM, durationS: l.durationS })),
      remainingServicesS: remaining.length * defaultServiceS,
      remainingPausesS: 0,
      safetyMarginS: 0,
      historicalServiceDurationsS: historical,
    });

    return {
      journeyId,
      estimatedFinishAt: estimate.estimatedFinishAt,
      estimatedRemainingS: estimate.estimatedRemainingS,
      remainingStops: estimate.remainingStops,
      remainingDistanceM: estimate.remainingDistanceM,
      confidence: estimate.confidence,
      confidenceReason: estimate.confidenceReason,
      isEstimate: true,
      disclaimer:
        'Estimativa baseada em medias configuradas. Nao representa horario garantido. Ative um provedor de rotas e acumule historico para maior precisao.',
      remainingCustomers: remaining.map((v) => ({
        sequence: v.sequence,
        customerId: v.customerId,
        tradeName: v.customer.tradeName,
      })),
    };
  }

  async history(query: {
    driverId?: string; routeId?: string; from?: string; to?: string;
    page?: number; pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.JourneyWhereInput = {
      driverId: query.driverId,
      routeId: query.routeId,
      startedAt: query.from || query.to
        ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
        : undefined,
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.journey.count({ where }),
      this.prisma.journey.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          driver: { include: { user: { select: { name: true } } } },
          route: { select: { id: true, code: true, name: true } },
          _count: { select: { visits: true, occurrences: true } },
        },
      }),
    ]);
    return { total, page, pageSize, data };
  }

  private async refreshJourneyCounters(journeyId: string): Promise<void> {
    const visits = await this.prisma.visit.findMany({ where: { journeyId }, select: { status: true } });
    await this.prisma.journey.update({
      where: { id: journeyId },
      data: {
        stopsPlanned: visits.length,
        stopsConcluded: visits.filter((v) => v.status === VisitStatus.CONCLUIDA).length,
        stopsNotDone: visits.filter((v) => v.status === VisitStatus.NAO_REALIZADA).length,
      },
    });
  }

  private async requireJourney(id: string) {
    const journey = await this.prisma.journey.findUnique({ where: { id } });
    if (!journey) throw new NotFoundException('Jornada nao encontrada.');
    return journey;
  }

  /**
   * A auditoria referencia users.id. Os metodos de jornada recebem o
   * driverId, entao resolvemos o usuario correspondente antes de gravar.
   */
  private async userIdForDriver(driverId: string): Promise<string | null> {
    const driver = await this.prisma.driver.findUnique({
      where: { id: driverId },
      select: { userId: true },
    });
    return driver?.userId ?? null;
  }

  private assertOwnership(journey: { driverId: string }, driverId: string): void {
    if (journey.driverId !== driverId) {
      throw new ForbiddenException('Esta jornada pertence a outro motorista.');
    }
  }

  /**
   * Restringe a leitura ao dono quando o chamador nao tem escopo global.
   *
   * A permissao responde "voce pode ler jornadas"; o escopo responde "de
   * quem". Sem esta checagem, `journeys:read:own` permitiria abrir a jornada
   * de qualquer motorista so pelo id — escalada horizontal. `null` significa
   * "sem restricao" (quem tem `journeys:read:all`).
   */
  private assertReadScope(journey: { driverId: string }, scopeDriverId: string | null): void {
    if (scopeDriverId === null) return;
    this.assertOwnership(journey, scopeDriverId);
  }
}

const CLOSED_VISIT_STATUSES = [VisitStatus.CONCLUIDA, VisitStatus.NAO_REALIZADA, VisitStatus.CANCELADA] as const;

function mapVisitEvent(type: VisitEventInput['type']): VisitStatus {
  switch (type) {
    case 'ARRIVED': return VisitStatus.CHEGADA_REGISTRADA;
    case 'SERVICE_STARTED': return VisitStatus.EM_ATENDIMENTO;
    case 'SERVICE_ENDED': return VisitStatus.CONCLUIDA;
    case 'NOT_DONE': return VisitStatus.NAO_REALIZADA;
    default: throw new BadRequestException(`Tipo de evento de visita desconhecido: ${String(type)}`);
  }
}
