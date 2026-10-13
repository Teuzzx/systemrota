import { Injectable, Logger } from '@nestjs/common';
import { AlertAction, AlertSeverity, AlertStatus, JourneyStatus, Prisma, RouteStatus, VisitStatus } from '@prisma/client';
import { AlertRuleKey, AlertThresholds, dataAgeSeconds, dataFreshness } from '@rota/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Motor de alertas.
 *
 * Principios aplicados:
 *  - todo alerta carrega dado verificavel e o horario da ultima informacao;
 *  - deduplicacao por chave: o mesmo fenomeno nao vira 50 alertas;
 *  - silenciamento temporario por regra;
 *  - parada NAO e classificada automaticamente como irregular: o alerta de
 *    parada prolongada apenas informa que ainda nao ha classificacao;
 *  - dados desatualizados sao sempre identificados como tal.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async evaluate(now = new Date()): Promise<{ created: number; updated: number; skipped: number }> {
    const thresholds = await this.settings.getThresholds();
    const staleAfter = thresholds.locationStaleS;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // 1) Motorista sem atualizacao de localizacao
    const activeJourneys = await this.prisma.journey.findMany({
      where: { status: { in: [JourneyStatus.EM_ANDAMENTO, JourneyStatus.PAUSADA] } },
      include: {
        driver: { include: { user: { select: { name: true } } } },
        route: { select: { id: true, code: true } },
        locationPoints: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
    });

    for (const journey of activeJourneys) {
      const lastPoint = journey.locationPoints[0] ?? null;
      const ageS = dataAgeSeconds(lastPoint?.receivedAt ?? null, now);
      const freshness = dataFreshness(lastPoint?.receivedAt ?? null, now, staleAfter);

      if (lastPoint && freshness !== 'ATUAL') {
        const result = await this.raise({
          ruleKey: AlertRuleKey.DRIVER_LOCATION_STALE,
          severity: ageS !== null && ageS > staleAfter * 6 ? AlertSeverity.CRITICO : AlertSeverity.AVISO,
          dedupeKey: `${AlertRuleKey.DRIVER_LOCATION_STALE}:${journey.id}`,
          title: `Sem atualizacao de localizacao: ${journey.driver.user.name}`,
          message:
            `A ultima posicao recebida foi ha ${ageS ?? '?'}s ` +
            `(${lastPoint.receivedAt.toISOString()}). Isso nao significa necessariamente que o motorista parou.`,
          context: {
            lastReceivedAt: lastPoint.receivedAt.toISOString(),
            dataAgeSeconds: ageS,
            freshness,
            thresholdSeconds: staleAfter,
            journeyId: journey.id,
          },
          driverId: journey.driverId,
          journeyId: journey.id,
          routeId: journey.route?.id ?? null,
          thresholds,
          now,
        });
        if (result === 'created') created += 1;
        else if (result === 'updated') updated += 1;
        else skipped += 1;
      }

      // 4) Jornada prolongada
      const journeyAgeS = (now.getTime() - journey.startedAt.getTime()) / 1000;
      if (journeyAgeS > thresholds.journeyMaxS) {
        const result = await this.raise({
          ruleKey: AlertRuleKey.JOURNEY_TOO_LONG,
          severity: AlertSeverity.AVISO,
          dedupeKey: `${AlertRuleKey.JOURNEY_TOO_LONG}:${journey.id}`,
          title: `Jornada acima do limite: ${journey.driver.user.name}`,
          message: `Jornada em andamento ha ${Math.round(journeyAgeS / 3600)}h (limite ${Math.round(thresholds.journeyMaxS / 3600)}h).`,
          context: { startedAt: journey.startedAt.toISOString(), ageSeconds: journeyAgeS, thresholdSeconds: thresholds.journeyMaxS },
          driverId: journey.driverId,
          journeyId: journey.id,
          thresholds,
          now,
        });
        if (result === 'created') created += 1;
        else if (result === 'updated') updated += 1;
        else skipped += 1;
      }

      // 5) Parada prolongada ainda nao classificada
      const lastPointAny = lastPoint;
      if (lastPointAny) {
        const stationaryS = (now.getTime() - lastPointAny.capturedAt.getTime()) / 1000;
        if (stationaryS > thresholds.prolongedStopS) {
          const openVisit = await this.prisma.visit.findFirst({
            where: { journeyId: journey.id, status: VisitStatus.EM_ATENDIMENTO },
          });
          if (!openVisit) {
            const result = await this.raise({
              ruleKey: AlertRuleKey.PROLONGED_STOP,
              severity: AlertSeverity.AVISO,
              dedupeKey: `${AlertRuleKey.PROLONGED_STOP}:${journey.id}`,
              title: `Parada prolongada sem classificacao: ${journey.driver.user.name}`,
              message:
                `Ultima posicao ha ${Math.round(stationaryS / 60)}min sem novo registro. ` +
                'O sistema NAO classifica automaticamente esta parada como irregular.',
              context: {
                lastCapturedAt: lastPointAny.capturedAt.toISOString(),
                stationarySeconds: stationaryS,
                thresholdSeconds: thresholds.prolongedStopS,
                autoClassified: false,
              },
              driverId: journey.driverId,
              journeyId: journey.id,
              thresholds,
              now,
            });
            if (result === 'created') created += 1;
            else if (result === 'updated') updated += 1;
            else skipped += 1;
          }
        }
      }
    }

    // 2) Visita atrasada
    const nowRouteMinutes = now.getHours() * 60 + now.getMinutes();
    const activeVisits = await this.prisma.visit.findMany({
      where: { journey: { status: JourneyStatus.EM_ANDAMENTO }, status: { in: [VisitStatus.PLANEJADA, VisitStatus.EM_DESLOCAMENTO, VisitStatus.CHEGADA_REGISTRADA] }, plannedArrivalAt: { not: null } },
      include: { journey: { include: { driver: { include: { user: { select: { name: true } } } } } }, customer: { select: { id: true, tradeName: true } } },
    });
    for (const visit of activeVisits) {
      const planned = visit.plannedArrivalAt as Date;
      const lateS = (now.getTime() - planned.getTime()) / 1000;
      if (lateS > thresholds.visitLateToleranceS) {
        const result = await this.raise({
          ruleKey: AlertRuleKey.VISIT_LATE,
          severity: lateS > thresholds.visitLateToleranceS * 3 ? AlertSeverity.CRITICO : AlertSeverity.AVISO,
          dedupeKey: `${AlertRuleKey.VISIT_LATE}:${visit.id}`,
          title: `Visita atrasada: ${visit.customer.tradeName}`,
          message: `Chegada prevista para ${planned.toISOString()}; tolerancia de ${Math.round(thresholds.visitLateToleranceS / 60)}min excedida.`,
          context: { plannedArrivalAt: planned.toISOString(), lateSeconds: lateS, toleranceSeconds: thresholds.visitLateToleranceS, visitId: visit.id },
          driverId: visit.driverId,
          journeyId: visit.journeyId,
          customerId: visit.customerId,
          thresholds,
          now,
        });
        if (result === 'created') created += 1;
        else if (result === 'updated') updated += 1;
        else skipped += 1;
      }
    }

    // 3) Visita nao realizada
    const notDone = await this.prisma.visit.findMany({
      where: { status: VisitStatus.NAO_REALIZADA, arrivedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } },
      include: { customer: { select: { id: true, tradeName: true } } },
      take: 200,
    });
    for (const visit of notDone) {
      const result = await this.raise({
        ruleKey: AlertRuleKey.VISIT_NOT_DONE,
        severity: AlertSeverity.AVISO,
        dedupeKey: `${AlertRuleKey.VISIT_NOT_DONE}:${visit.id}`,
        title: `Visita nao realizada: ${visit.customer.tradeName}`,
        message: `Visita marcada como nao realizada. Motivo: ${visit.notDoneReason ?? 'nao informado'}.`,
        context: { visitId: visit.id, reason: visit.notDoneReason, note: visit.notDoneNote },
        driverId: visit.driverId,
        journeyId: visit.journeyId,
        customerId: visit.customerId,
        thresholds,
        now,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    // 6) Rota com baixo progresso
    const routes = await this.prisma.route.findMany({
      where: { status: { in: [RouteStatus.EM_EXECUCAO] } },
      include: { driver: { include: { user: { select: { name: true } } } }, journeys: { take: 1 } },
    });
    for (const route of routes) {
      const journey = route.journeys[0];
      if (!journey || journey.stopsPlanned === 0) continue;
      const progressPct = (journey.stopsConcluded / journey.stopsPlanned) * 100;
      if (nowRouteMinutes > 8 * 60 && progressPct < thresholds.routeExpectedProgressPct) {
        const result = await this.raise({
          ruleKey: AlertRuleKey.ROUTE_LOW_PROGRESS,
          severity: AlertSeverity.AVISO,
          dedupeKey: `${AlertRuleKey.ROUTE_LOW_PROGRESS}:${route.id}:${now.toISOString().slice(0, 13)}`,
          title: `Baixo progresso na rota ${route.code}`,
          message: `${progressPct.toFixed(0)}% concluidos (esperado >= ${thresholds.routeExpectedProgressPct}%).`,
          context: { progressPct, expectedPct: thresholds.routeExpectedProgressPct, stopsConcluded: journey.stopsConcluded, stopsPlanned: journey.stopsPlanned },
          driverId: route.driverId,
          journeyId: journey.id,
          routeId: route.id,
          thresholds,
          now,
        });
        if (result === 'created') created += 1;
        else if (result === 'updated') updated += 1;
        else skipped += 1;
      }
    }

    // 8) Cliente sem coordenadas validas
    const pendingGeo = await this.prisma.$queryRaw<Array<{ id: string; tradeName: string; city: string }>>`
      SELECT "id", "tradeName", "city" FROM "customers"
       WHERE "geocodeStatus" IN ('AUSENTE','INVALIDO','PENDENTE')
       LIMIT 200
    `;
    for (const customer of pendingGeo) {
      const result = await this.raise({
        ruleKey: AlertRuleKey.CUSTOMER_WITHOUT_COORDS,
        severity: AlertSeverity.INFO,
        dedupeKey: `${AlertRuleKey.CUSTOMER_WITHOUT_COORDS}:${customer.id}`,
        title: `Cliente pendente de geolocalizacao: ${customer.tradeName}`,
        message: `Cadastro sem coordenada confiavel em ${customer.city}. Corrija para incluir na rota.`,
        context: { customerId: customer.id, city: customer.city },
        customerId: customer.id,
        thresholds,
        now,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    // 9) Jornada nao encerrada
    const staleJourneyCutoff = new Date(now.getTime() - thresholds.journeyNotClosedS * 1000);
    const openJourneys = await this.prisma.journey.findMany({
      where: { status: JourneyStatus.EM_ANDAMENTO, startedAt: { lt: staleJourneyCutoff } },
      include: { driver: { include: { user: { select: { name: true } } } } },
    });
    for (const journey of openJourneys) {
      const result = await this.raise({
        ruleKey: AlertRuleKey.JOURNEY_NOT_CLOSED,
        severity: AlertSeverity.CRITICO,
        dedupeKey: `${AlertRuleKey.JOURNEY_NOT_CLOSED}:${journey.id}`,
        title: `Jornada nao encerrada: ${journey.driver.user.name}`,
        message: `Jornada aberta desde ${journey.startedAt.toISOString()}. Verifique se o app foi encerrado.`,
        context: { startedAt: journey.startedAt.toISOString(), thresholdSeconds: thresholds.journeyNotClosedS },
        driverId: journey.driverId,
        journeyId: journey.id,
        thresholds,
        now,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    // 10) Ocorrencia operacional pendente
    const occurrences = await this.prisma.occurrence.findMany({
      where: { requiresFollowUp: true, resolvedAt: null },
      include: { driver: { include: { user: { select: { name: true } } } } },
      take: 100,
    });
    for (const occurrence of occurrences) {
      const result = await this.raise({
        ruleKey: AlertRuleKey.OPERATIONAL_OCCURRENCE,
        severity: AlertSeverity.AVISO,
        dedupeKey: `${AlertRuleKey.OPERATIONAL_OCCURRENCE}:${occurrence.id}`,
        title: `Ocorrencia operacional: ${occurrence.driver.user.name}`,
        message: `${occurrence.type}: ${occurrence.description ?? 'sem descricao'}`,
        context: { occurrenceId: occurrence.id, type: occurrence.type, description: occurrence.description },
        driverId: occurrence.driverId,
        journeyId: occurrence.journeyId,
        thresholds,
        now,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    this.logger.debug(`Alertas: ${created} criados, ${updated} atualizados, ${skipped} ignorados.`);
    return { created, updated, skipped };
  }

  async list(query: { status?: AlertStatus; severity?: AlertSeverity; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.AlertWhereInput = { status: query.status, severity: query.severity };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.alert.count({ where }),
      this.prisma.alert.findMany({
        where,
        orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          driver: { include: { user: { select: { name: true } } } },
          history: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      }),
    ]);
    return { total, page, pageSize, data };
  }

  async acknowledge(id: string, actorId: string) {
    return this.transition(id, AlertStatus.RECONHECIDO, actorId, 'alert.acknowledged');
  }

  async resolve(id: string, actorId: string, note?: string) {
    return this.transition(id, AlertStatus.RESOLVIDO, actorId, 'alert.resolved', note);
  }

  async silence(id: string, actorId: string, minutes: number) {
    const alert = await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.SILENCIADO, silencedUntil: new Date(Date.now() + minutes * 60_000) },
    });
    await this.prisma.alertHistory.create({
      data: { alertId: id, action: AlertAction.SILENCIADO, actorId, detail: { minutes } as Prisma.InputJsonValue },
    });
    return alert;
  }

  async stats() {
    const grouped = await this.prisma.alert.groupBy({ by: ['status'], _count: { _all: true } });
    const bySeverity = await this.prisma.alert.groupBy({ by: ['severity'], _count: { _all: true } });
    return {
      byStatus: grouped.map((g) => ({ status: g.status, count: g._count._all })),
      bySeverity: bySeverity.map((g) => ({ severity: g.severity, count: g._count._all })),
    };
  }

  private async transition(id: string, status: AlertStatus, actorId: string, action: string, note?: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new Error('Alerta nao encontrado.');
    const data: Prisma.AlertUpdateInput =
      status === AlertStatus.RESOLVIDO
        ? { status, resolvedAt: new Date(), resolvedById: actorId }
        : { status, acknowledgedAt: new Date(), acknowledgedById: actorId };
    const updated = await this.prisma.alert.update({ where: { id }, data });
    await this.prisma.alertHistory.create({
      data: {
        alertId: id,
        action: status === AlertStatus.RESOLVIDO ? AlertAction.RESOLVIDO : AlertAction.RECONHECIDO,
        actorId,
        detail: { note: note ?? null, action } as Prisma.InputJsonValue,
      },
    });
    return updated;
  }

  /** Deduplicacao + silenciamento + historico. */
  private async raise(input: {
    ruleKey: string;
    severity: AlertSeverity;
    dedupeKey: string;
    title: string;
    message: string;
    context: Record<string, unknown>;
    driverId?: string | null;
    journeyId?: string | null;
    routeId?: string | null;
    customerId?: string | null;
    thresholds: AlertThresholds;
    now: Date;
  }): Promise<'created' | 'updated' | 'skipped'> {
    const existing = await this.prisma.alert.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) {
      if (existing.status === AlertStatus.RESOLVIDO) {
        // Fenomeno recorre: reabre com nova contagem de ocorrencias.
        const reopened = await this.prisma.alert.update({
          where: { id: existing.id },
          data: {
            status: AlertStatus.ABERTO,
            occurrences: { increment: 1 },
            lastSeenAt: input.now,
            resolvedAt: null,
            resolvedById: null,
            context: input.context as Prisma.InputJsonValue,
          },
        });
        await this.prisma.alertHistory.create({
          data: { alertId: reopened.id, action: AlertAction.ATUALIZADO, detail: { reopened: true } as Prisma.InputJsonValue },
        });
        return 'updated';
      }
      if (existing.silencedUntil && existing.silencedUntil.getTime() > input.now.getTime()) {
        return 'skipped';
      }
      const withinWindow = input.now.getTime() - existing.lastSeenAt.getTime() < input.thresholds.dedupeWindowS * 1000;
      if (withinWindow) return 'skipped';
      await this.prisma.$transaction([
        this.prisma.alert.update({
          where: { id: existing.id },
          data: {
            occurrences: { increment: 1 },
            lastSeenAt: input.now,
            context: input.context as Prisma.InputJsonValue,
            severity: input.severity,
          },
        }),
        this.prisma.alertHistory.create({
          data: { alertId: existing.id, action: AlertAction.ATUALIZADO, detail: input.context as Prisma.InputJsonValue },
        }),
      ]);
      return 'updated';
    }

    const created = await this.prisma.alert.create({
      data: {
        ruleKey: input.ruleKey,
        severity: input.severity,
        status: AlertStatus.ABERTO,
        title: input.title,
        message: input.message,
        context: input.context as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey,
        driverId: input.driverId ?? null,
        journeyId: input.journeyId ?? null,
        routeId: input.routeId ?? null,
        customerId: input.customerId ?? null,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
      },
    });
    await this.prisma.alertHistory.create({
      data: { alertId: created.id, action: AlertAction.CRIADO, detail: input.context as Prisma.InputJsonValue },
    });
    return 'created';
  }
}
