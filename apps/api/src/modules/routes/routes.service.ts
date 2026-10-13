import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RouteStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';

/**
 * Rotas sao registros administravels: R1..R4 sao apenas as rotas iniciais da
 * operacao, nunca constantes no codigo.
 *
 * Reorganizacao: qualquer mudanca de conjunto ou ordem cria uma NOVA versao.
 * A versao e o que o motorista recebe; se o admin alterar a rota durante o
 * offline do motorista, a divergencia e detectada na sincronizacao.
 */
@Injectable()
export class RoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    date?: string; from?: string; to?: string; status?: RouteStatus;
    driverId?: string; page?: number; pageSize?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.RouteWhereInput = {
      status: query.status,
      driverId: query.driverId,
      plannedDate: query.date
        ? new Date(query.date)
        : query.from || query.to
          ? {
              gte: query.from ? new Date(query.from) : undefined,
              lte: query.to ? new Date(query.to) : undefined,
            }
          : undefined,
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.route.count({ where }),
      this.prisma.route.findMany({
        where,
        orderBy: [{ plannedDate: 'desc' }, { code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          driver: { include: { user: { select: { name: true, email: true } } } },
          versions: { orderBy: { version: 'desc' }, take: 1 },
          _count: { select: { stops: true } },
        },
      }),
    ]);
    return { total, page, pageSize, data };
  }

  async findById(id: string) {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: {
        driver: { include: { user: { select: { id: true, name: true, email: true, status: true } } } },
        versions: {
          orderBy: { version: 'desc' },
          include: {
            stops: {
              orderBy: { sequence: 'asc' },
              include: {
                customer: {
                  select: {
                    id: true, tradeName: true, city: true, neighborhood: true,
                    addressLine: true, latitude: true, longitude: true,
                    geocodeStatus: true, openingHours: true, phone: true, priority: true,
                    defaultServiceS: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!route) throw new NotFoundException('Rota nao encontrada.');
    const current = route.versions.find((v) => v.version === route.currentVersion) ?? route.versions[0] ?? null;
    return { ...route, currentVersionData: current };
  }

  async findByIdOrCode(idOrCode: string) {
    const byId = await this.prisma.route.findUnique({ where: { id: idOrCode }, select: { id: true } });
    if (byId) return this.findById(byId.id);
    const byCode = await this.prisma.route.findUnique({ where: { code: idOrCode }, select: { id: true } });
    if (!byCode) throw new NotFoundException('Rota nao encontrada.');
    return this.findById(byCode.id);
  }

  async create(
    input: {
      code: string; name: string; description?: string; region?: string;
      cities?: string[]; neighborhoods?: string[]; driverId?: string | null;
      plannedDate: string; plannedStartAt?: string | null; plannedEndAt?: string | null;
      returnToBase?: boolean;
    },
    actorId: string | null,
  ) {
    const code = input.code?.trim();
    if (!code) throw new BadRequestException('Codigo da rota e obrigatorio.');
    const existing = await this.prisma.route.findUnique({ where: { code } });
    if (existing) throw new BadRequestException(`Ja existe uma rota com o codigo ${code}.`);

    const route = await this.prisma.route.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description ?? null,
        region: input.region ?? null,
        cities: input.cities ?? [],
        neighborhoods: input.neighborhoods ?? [],
        driverId: input.driverId ?? null,
        plannedDate: new Date(input.plannedDate),
        plannedStartAt: input.plannedStartAt ? new Date(input.plannedStartAt) : null,
        plannedEndAt: input.plannedEndAt ? new Date(input.plannedEndAt) : null,
        returnToBase: input.returnToBase ?? false,
        status: input.driverId ? RouteStatus.ATRIBUIDA : RouteStatus.PLANEJADA,
        currentVersion: 1,
        createdById: actorId,
        versions: {
          create: {
            version: 1,
            status: input.driverId ? RouteStatus.ATRIBUIDA : RouteStatus.PLANEJADA,
            totalStops: 0,
            changeNote: 'Criacao da rota',
            changedById: actorId,
          },
        },
      },
    });
    await this.audit.record({ actorId, action: 'route.created', entity: 'Route', entityId: route.id, after: route });
    return route;
  }

  async update(id: string, input: Partial<{
    name: string; description: string; region: string; cities: string[];
    neighborhoods: string[]; driverId: string | null; plannedDate: string;
    plannedStartAt: string | null; plannedEndAt: string | null; returnToBase: boolean;
  }>, actorId: string | null) {
    const route = await this.requireRoute(id);
    // Rota em execucao: trocar o motorista quebraria a jornada em andamento.
    const changesDriver = input.driverId !== undefined && input.driverId !== route.driverId;
    if (route.status === RouteStatus.EM_EXECUCAO && changesDriver) {
      throw new ForbiddenException(
        'Nao e possivel trocar o motorista de uma rota em execucao. Pause ou conclua a jornada antes.',
      );
    }
    const updated = await this.prisma.route.update({
      where: { id },
      data: {
        name: input.name ?? route.name,
        description: input.description ?? route.description,
        region: input.region ?? route.region,
        cities: input.cities ?? route.cities,
        neighborhoods: input.neighborhoods ?? route.neighborhoods,
        driverId: input.driverId !== undefined ? input.driverId : route.driverId,
        plannedDate: input.plannedDate ? new Date(input.plannedDate) : route.plannedDate,
        plannedStartAt: input.plannedStartAt !== undefined
          ? input.plannedStartAt ? new Date(input.plannedStartAt) : null
          : route.plannedStartAt,
        plannedEndAt: input.plannedEndAt !== undefined
          ? input.plannedEndAt ? new Date(input.plannedEndAt) : null
          : route.plannedEndAt,
        returnToBase: input.returnToBase ?? route.returnToBase,
        status: route.status === RouteStatus.PLANEJADA && (input.driverId ?? route.driverId)
          ? RouteStatus.ATRIBUIDA
          : route.status,
      },
    });
    await this.audit.record({
      actorId, action: 'route.updated', entity: 'Route', entityId: id,
      before: { name: route.name, driverId: route.driverId, status: route.status },
      after: { name: updated.name, driverId: updated.driverId, status: updated.status },
    });
    return updated;
  }

  /**
   * Substitui o conjunto/ordem de paradas criando uma nova versao.
   * O diff e persistido para auditoria e exibido ao administrador.
   */
  async setStops(
    routeId: string,
    stops: Array<{
      customerId: string;
      sequence?: number;
      priority?: number;
      pinned?: boolean;
      estServiceS?: number | null;
      timeWindowStart?: string | null;
      timeWindowEnd?: string | null;
      note?: string | null;
      estTravelFromPrevS?: number | null;
      estDistanceFromPrevM?: number | null;
    }>,
    changeNote: string,
    actorId: string | null,
  ) {
    const route = await this.requireRoute(routeId);
    if (stops.length === 0) throw new BadRequestException('A rota precisa de ao menos uma parada.');

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: stops.map((s) => s.customerId) } },
      select: { id: true, defaultServiceS: true, priority: true },
    });
    const byId = new Map(customers.map((c) => [c.id, c]));
    const missing = stops.filter((s) => !byId.has(s.customerId)).map((s) => s.customerId);
    if (missing.length > 0) {
      throw new BadRequestException(`Clientes inexistentes: ${missing.join(', ')}`);
    }
    const seen = new Set<string>();
    for (const stop of stops) {
      if (seen.has(stop.customerId)) {
        throw new BadRequestException(`Cliente ${stop.customerId} informado mais de uma vez na mesma rota.`);
      }
      seen.add(stop.customerId);
    }

    const ordered = [...stops].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const previous = await this.prisma.routeStop.findMany({
      where: { routeId, routeVersionId: await this.currentVersionId(route) },
      orderBy: { sequence: 'asc' },
      select: { customerId: true },
    });
    const previousOrder = previous.map((s) => s.customerId);
    const nextOrder = ordered.map((s) => s.customerId);

    const diff = {
      added: nextOrder.filter((c) => !previousOrder.includes(c)),
      removed: previousOrder.filter((c) => !nextOrder.includes(c)),
      reordered:
        previousOrder.length > 0 &&
        previousOrder.filter((c) => nextOrder.includes(c)).join('|') !== nextOrder.join('|'),
      previousOrder,
      nextOrder,
    };

    const nextVersion = route.currentVersion + 1;
    const totalServiceS = ordered.reduce(
      (acc, s) => acc + (s.estServiceS ?? byId.get(s.customerId)?.defaultServiceS ?? 0),
      0,
    );
    const totalTravelS = ordered.reduce((acc, s) => acc + (s.estTravelFromPrevS ?? 0), 0);
    const totalDistanceM = ordered.reduce((acc, s) => acc + (s.estDistanceFromPrevM ?? 0), 0);

    const result = await this.prisma.$transaction(async (tx) => {
      const version = await tx.routeVersion.create({
        data: {
          routeId,
          version: nextVersion,
          status: route.status === RouteStatus.PLANEJADA ? RouteStatus.PLANEJADA : route.status,
          totalDistanceM: totalDistanceM || null,
          totalDurationS: totalTravelS || null,
          totalServiceS: totalServiceS || null,
          totalStops: ordered.length,
          changeNote,
          diff: diff as unknown as Prisma.InputJsonValue,
          changedById: actorId,
        },
      });
      for (const [index, stop] of ordered.entries()) {
        await tx.routeStop.create({
          data: {
            routeId,
            routeVersionId: version.id,
            customerId: stop.customerId,
            sequence: index + 1,
            priority: stop.priority ?? byId.get(stop.customerId)?.priority ?? 5,
            estServiceS: stop.estServiceS ?? byId.get(stop.customerId)?.defaultServiceS ?? null,
            estTravelFromPrevS: stop.estTravelFromPrevS ?? null,
            estDistanceFromPrevM: stop.estDistanceFromPrevM ?? null,
            timeWindowStart: stop.timeWindowStart ? new Date(stop.timeWindowStart) : null,
            timeWindowEnd: stop.timeWindowEnd ? new Date(stop.timeWindowEnd) : null,
            pinned: stop.pinned ?? false,
            note: stop.note ?? null,
          },
        });
      }
      const updatedRoute = await tx.route.update({
        where: { id: routeId },
        data: {
          currentVersion: nextVersion,
          distanceEstimatedM: totalDistanceM || null,
          durationEstimatedS: totalTravelS || null,
          serviceEstimatedS: totalServiceS || null,
        },
      });
      return { updatedRoute, version };
    });

    await this.audit.record({
      actorId, action: 'route.stops.replaced', entity: 'Route', entityId: routeId,
      after: { version: nextVersion, diff },
    });
    return { routeId, version: nextVersion, stops: ordered.length, diff, route: result.updatedRoute };
  }

  async publish(routeId: string, actorId: string | null) {
    const route = await this.requireRoute(routeId);
    if (!route.driverId) throw new BadRequestException('Atribua um motorista antes de publicar a rota.');
    if (route.status === RouteStatus.EM_EXECUCAO || route.status === RouteStatus.CONCLUIDA) {
      throw new ForbiddenException(`Rota em ${route.status} nao pode ser publicada.`);
    }
    const versionId = await this.currentVersionId(route);
    const stopsCount = await this.prisma.routeStop.count({ where: { routeVersionId: versionId } });
    if (stopsCount === 0) throw new BadRequestException('Rota sem paradas nao pode ser publicada.');

    const updated = await this.prisma.$transaction([
      this.prisma.route.update({
        where: { id: routeId },
        data: { status: RouteStatus.PUBLICADA, publishedAt: new Date() },
      }),
      this.prisma.routeVersion.update({
        where: { id: versionId },
        data: { status: RouteStatus.PUBLICADA },
      }),
    ]);
    await this.audit.record({ actorId, action: 'route.published', entity: 'Route', entityId: routeId, after: { stops: stopsCount } });
    return updated[0];
  }

  async archive(routeId: string, actorId: string | null) {
    const route = await this.requireRoute(routeId);
    if (route.status === RouteStatus.EM_EXECUCAO) {
      throw new ForbiddenException('Nao e possivel arquivar uma rota em execucao.');
    }
    const updated = await this.prisma.route.update({ where: { id: routeId }, data: { status: RouteStatus.ARQUIVADA } });
    await this.audit.record({ actorId, action: 'route.archived', entity: 'Route', entityId: routeId });
    return updated;
  }

  async cancel(routeId: string, reason: string, actorId: string | null) {
    const route = await this.requireRoute(routeId);
    const updated = await this.prisma.route.update({
      where: { id: routeId },
      data: { status: RouteStatus.CANCELADA, description: `${route.description ?? ''}\nCancelada: ${reason}`.trim() },
    });
    await this.audit.record({ actorId, action: 'route.cancelled', entity: 'Route', entityId: routeId, after: { reason } });
    return updated;
  }

  async versions(routeId: string) {
    await this.requireRoute(routeId);
    return this.prisma.routeVersion.findMany({
      where: { routeId },
      orderBy: { version: 'desc' },
      include: { _count: { select: { stops: true } } },
    });
  }

  /** Rota atribuida a um motorista em uma data (consumida pelo app). */
  async assignedToDriver(driverId: string, date?: string) {
    const target = date ? new Date(date) : new Date();
    const start = new Date(target); start.setHours(0, 0, 0, 0);
    const end = new Date(target); end.setHours(23, 59, 59, 999);
    const routes = await this.prisma.route.findMany({
      where: {
        driverId,
        plannedDate: { gte: start, lte: end },
        status: { in: [RouteStatus.PLANEJADA, RouteStatus.ATRIBUIDA, RouteStatus.PUBLICADA, RouteStatus.EM_EXECUCAO, RouteStatus.PAUSADA] },
      },
      orderBy: { code: 'asc' },
    });
    const detail = await Promise.all(routes.map((route) => this.findById(route.id)));
    return detail;
  }

  private async requireRoute(id: string) {
    const route = await this.prisma.route.findUnique({ where: { id } });
    if (!route) throw new NotFoundException('Rota nao encontrada.');
    return route;
  }

  private async currentVersionId(route: { id: string; currentVersion: number }): Promise<string> {
    const version = await this.prisma.routeVersion.findUnique({
      where: { routeId_version: { routeId: route.id, version: route.currentVersion } },
    });
    if (version) return version.id;
    const any = await this.prisma.routeVersion.findFirst({
      where: { routeId: route.id },
      orderBy: { version: 'desc' },
    });
    if (!any) throw new BadRequestException('Rota sem versao de planejamento.');
    return any.id;
  }
}
