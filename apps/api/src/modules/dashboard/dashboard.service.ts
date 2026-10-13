import { Injectable } from '@nestjs/common';
import { JourneyStatus, Prisma, RouteStatus, VisitStatus } from '@prisma/client';
import { dataAgeSeconds, dataFreshness, mean, median } from '@rota/shared';
import { PrismaService } from '../../common/prisma.service';
import { LocationsService } from '../locations/locations.service';

export interface DashboardFilter {
  date?: string;
  from?: string;
  to?: string;
  driverId?: string;
  routeId?: string;
  city?: string;
  neighborhood?: string;
  status?: string;
}

/**
 * Indicadores do painel. TODOS os numeros sao calculados a partir de dados
 * persistidos (jornadas, visitas, eventos, pontos de localizacao).
 * Nada aqui e valor fixo, mocked ou estimado silenciosamente.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  async overview(filter: DashboardFilter = {}) {
    const now = new Date();
    const range = this.resolveRange(filter);
    const visitsWhere = this.visitsWhere(filter, range);

    const [
      driversTotal,
      driversActive,
      journeysToday,
      routesPlanned,
      routesInProgress,
      routesConcluded,
      visitsAggregated,
      serviceDurations,
      occurrencesPending,
      alertsOpen,
      distanceAgg,
    ] = await Promise.all([
      this.prisma.driver.count({ where: { status: 'ATIVO' } }),
      this.prisma.journey.count({
        where: { status: { in: [JourneyStatus.EM_ANDAMENTO, JourneyStatus.PAUSADA] } },
      }),
      this.prisma.journey.count({ where: { startedAt: { gte: range.start, lte: range.end } } }),
      this.prisma.route.count({
        where: { plannedDate: { gte: range.dayStart, lte: range.dayEnd }, status: { in: [RouteStatus.PLANEJADA, RouteStatus.ATRIBUIDA] } },
      }),
      this.prisma.route.count({ where: { status: RouteStatus.EM_EXECUCAO } }),
      this.prisma.route.count({
        where: { plannedDate: { gte: range.dayStart, lte: range.dayEnd }, status: RouteStatus.CONCLUIDA },
      }),
      this.prisma.visit.aggregate({
        where: visitsWhere,
        _count: { _all: true },
      }),
      this.prisma.visit.findMany({
        where: { ...visitsWhere, status: VisitStatus.CONCLUIDA, serviceDurationS: { not: null } },
        select: { serviceDurationS: true },
      }),
      this.prisma.occurrence.count({ where: { requiresFollowUp: true, resolvedAt: null } }),
      this.prisma.alert.count({ where: { status: { in: ['ABERTO', 'RECONHECIDO'] } } }),
      this.prisma.journey.aggregate({
        where: { startedAt: { gte: range.start, lte: range.end }, driverId: filter.driverId, routeId: filter.routeId },
        _sum: { gpsDistanceM: true, distanceTraveledM: true, serviceTotalS: true, travelTotalS: true },
      }),
    ]);

    const distanceSum = distanceAgg._sum ?? {};
    const concluded = await this.prisma.visit.count({
      where: { ...visitsWhere, status: VisitStatus.CONCLUIDA },
    });
    const notDone = await this.prisma.visit.count({
      where: { ...visitsWhere, status: VisitStatus.NAO_REALIZADA },
    });
    const planned = visitsAggregated._count._all;

    const positions = await this.locations.latestPositions();
    const freshPositions = positions.filter((p) => p.freshness === 'ATUAL').length;
    const serviceValues = serviceDurations.map((v) => v.serviceDurationS as number);

    return {
      generatedAt: now.toISOString(),
      filter,
      drivers: {
        total: driversTotal,
        inJourney: driversActive,
        withFreshLocation: freshPositions,
        withStaleLocation: positions.filter((p) => p.freshness !== 'ATUAL').length,
      },
      routes: { planned: routesPlanned, inProgress: routesInProgress, concluded: routesConcluded },
      journeys: { totalInRange: journeysToday },
      visits: {
        planned,
        concluded,
        remaining: Math.max(0, planned - concluded - notDone),
        notDone,
        completionPct: planned > 0 ? (concluded / planned) * 100 : null,
      },
      distance: {
        gpsMeters: round(distanceSum.gpsDistanceM ?? 0),
        manualMeters: round(distanceSum.distanceTraveledM ?? 0),
        note: 'Distancia por GPS e estimativa, nao leitura de hodometro.',
      },
      service: {
        totalSeconds: distanceSum.serviceTotalS ?? 0,
        travelSeconds: distanceSum.travelTotalS ?? 0,
        averageServiceS: mean(serviceValues),
        medianServiceS: median(serviceValues),
        sampleSize: serviceValues.length,
      },
      occurrences: { pending: occurrencesPending },
      alerts: { open: alertsOpen },
      dataFreshness: {
        positionsWithData: positions.filter((p) => p.dataAgeSeconds !== null).length,
        positionsTotal: positions.length,
        note: 'Posicoes sem dados recentes sao marcadas como desatualizadas, nunca como atuais.',
      },
    };
  }

  /** Detalhe de um motorista para o painel e o mapa. */
  async driverDetail(driverId: string) {
    const now = new Date();
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: { user: { select: { name: true, email: true, phone: true } } },
    });
    const journey = await this.prisma.journey.findFirst({
      where: { driverId, status: { in: [JourneyStatus.EM_ANDAMENTO, JourneyStatus.PAUSADA] } },
      orderBy: { startedAt: 'desc' },
      include: {
        route: { select: { id: true, code: true, name: true } },
        visits: { orderBy: { sequence: 'asc' }, include: { customer: { select: { id: true, tradeName: true } } } },
      },
    });
    const latestPoint = await this.latestPointForDriver(driverId);

    const nextVisit = journey?.visits.find(
      (v) => !CLOSED_VISIT_STATUSES.includes(v.status as (typeof CLOSED_VISIT_STATUSES)[number]),
    );

    return {
      driver,
      journey: journey
        ? {
            id: journey.id,
            status: journey.status,
            startedAt: journey.startedAt,
            elapsedSeconds: Math.round((now.getTime() - journey.startedAt.getTime()) / 1000),
            distanceM: journey.gpsDistanceM,
            stopsPlanned: journey.stopsPlanned,
            stopsConcluded: journey.stopsConcluded,
            stopsNotDone: journey.stopsNotDone,
            route: journey.route,
          }
        : null,
      currentCustomer: journey?.visits.find((v) => v.status === VisitStatus.EM_ATENDIMENTO)?.customer ?? null,
      nextVisit: nextVisit ? { sequence: nextVisit.sequence, customer: nextVisit.customer } : null,
      lastPosition: latestPoint
        ? {
            latitude: latestPoint.latitude,
            longitude: latestPoint.longitude,
            capturedAt: latestPoint.capturedAt,
            receivedAt: latestPoint.receivedAt,
            dataAgeSeconds: dataAgeSeconds(latestPoint.receivedAt, now),
            freshness: dataFreshness(latestPoint.receivedAt, now, 300),
            accuracyM: latestPoint.accuracyM,
          }
        : null,
      isRealTrackingData: latestPoint !== null,
    };
  }

  private async latestPointForDriver(driverId: string) {
    return this.prisma.locationPoint.findFirst({
      where: { driverId },
      orderBy: { capturedAt: 'desc' },
      select: { latitude: true, longitude: true, accuracyM: true, capturedAt: true, receivedAt: true },
    });
  }

  private resolveRange(filter: DashboardFilter) {
    const dayStart = filter.date ? startOfDay(new Date(filter.date)) : startOfDay(new Date());
    const dayEnd = filter.date ? endOfDay(new Date(filter.date)) : endOfDay(new Date());
    const start = filter.from ? new Date(filter.from) : dayStart;
    const end = filter.to ? new Date(filter.to) : dayEnd;
    return { dayStart, dayEnd, start, end };
  }

  private visitsWhere(filter: DashboardFilter, range: { start: Date; end: Date }): Prisma.VisitWhereInput {
    return {
      journey: {
        startedAt: { gte: range.start, lte: range.end },
        driverId: filter.driverId,
        routeId: filter.routeId,
        ...(filter.city || filter.neighborhood
          ? {
              customer: {
                ...(filter.city ? { city: filter.city } : {}),
                ...(filter.neighborhood ? { neighborhood: filter.neighborhood } : {}),
              },
            }
          : {}),
      },
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const CLOSED_VISIT_STATUSES = [VisitStatus.CONCLUIDA, VisitStatus.NAO_REALIZADA, VisitStatus.CANCELADA] as const;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
