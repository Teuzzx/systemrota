import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OptimizationAlgorithm, OptimizationStatus, Prisma } from '@prisma/client';
import { optimizeRoute, OptimizableStop, OptimizeRouteResult } from '@rota/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { RoutingService } from '../routing/routing.service';
import { RoutesService } from '../routes/routes.service';

/**
 * Servico de otimizacao: monta a entrada a partir da rota, chama o motor
 * (motor puro em @rota/shared) e PERSISTE a execucao para auditoria.
 * O administrador aceita, ajusta ou rejeita a sugestao.
 */
@Injectable()
export class OptimizationService {
  private readonly logger = new Logger(OptimizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly routing: RoutingService,
    private readonly routes: RoutesService,
  ) {}

  /** Sugere uma sequencia para clientes ainda nao planejados. */
  async suggest(input: {
    routeId?: string | null;
    customerIds: string[];
    originLatitude?: number | null;
    originLongitude?: number | null;
    destinationLatitude?: number | null;
    destinationLongitude?: number | null;
    returnToBase?: boolean;
    startAt?: string;
    driverId?: string | null;
    maxStops?: number;
  }, actorId: string | null): Promise<{ runId: string; result: OptimizeRouteResult }> {
    if (input.customerIds.length === 0) {
      throw new BadRequestException('Selecione ao menos um cliente para otimizar.');
    }
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: input.customerIds } },
      select: {
        id: true, tradeName: true, city: true, neighborhood: true,
        latitude: true, longitude: true, geocodeStatus: true,
        priority: true, defaultServiceS: true, status: true,
      },
    });
    if (customers.length === 0) {
      throw new BadRequestException('Nenhum dos clientes informados existe.');
    }

    const run = await this.prisma.routeOptimizationRun.create({
      data: {
        routeId: input.routeId ?? null,
        provider: this.routing.providerName,
        algorithm: OptimizationAlgorithm.NEAREST_NEIGHBOR_2OPT,
        status: OptimizationStatus.EM_ANDAMENTO,
        originLatitude: input.originLatitude ?? null,
        originLongitude: input.originLongitude ?? null,
        destinationLatitude: input.destinationLatitude ?? null,
        destinationLongitude: input.destinationLongitude ?? null,
        returnToBase: input.returnToBase ?? false,
        inputCount: customers.length,
        driverId: input.driverId ?? null,
        requestedById: actorId,
      },
    });

    try {
      let previousOrder: string[] = [];
      if (input.routeId) {
        const route = await this.prisma.route.findUnique({
          where: { id: input.routeId },
          include: { stops: { orderBy: { sequence: 'asc' }, select: { customerId: true } } },
        });
        previousOrder = route?.stops.map((s) => s.customerId) ?? [];
      }

      const stops: OptimizableStop[] = customers.map((c) => ({
        id: c.id,
        customerId: c.id,
        position: c.latitude != null && c.longitude != null
          ? { latitude: c.latitude, longitude: c.longitude }
          : null,
        priority: c.priority,
        serviceS: c.defaultServiceS ?? 900,
      }));

      const result = await optimizeRoute({
        stops,
        origin:
          input.originLatitude != null && input.originLongitude != null
            ? { latitude: input.originLatitude, longitude: input.originLongitude }
            : null,
        destination:
          input.destinationLatitude != null && input.destinationLongitude != null
            ? { latitude: input.destinationLatitude, longitude: input.destinationLongitude }
            : null,
        returnToBase: input.returnToBase ?? false,
        startAt: input.startAt ? new Date(input.startAt) : new Date(),
        provider: {
          name: this.routing.providerName,
          networkBased: this.routing.isNetworkBased,
          estimateLeg: (from, to) => this.routing.estimateLeg(from, to),
        },
        defaultServiceS: 900,
        maxStops: input.maxStops,
        previousOrder,
      });

      const finished = await this.prisma.routeOptimizationRun.update({
        where: { id: run.id },
        data: {
          status: OptimizationStatus.CONCLUIDA,
          includedCount: result.included.filter((s) => s.customerId !== '__RETURN_TO_BASE__').length,
          excludedCount: result.excluded.length,
          totalDistanceM: result.totalDistanceM,
          totalDurationS: result.totalTravelS,
          totalServiceS: result.totalServiceS,
          result: result.included as unknown as Prisma.InputJsonValue,
          excluded: result.excluded as unknown as Prisma.InputJsonValue,
          constraints: result.constraints as unknown as Prisma.InputJsonValue,
          diffFromPrevious: result.diffFromPrevious as unknown as Prisma.InputJsonValue,
          confidenceNote: result.confidenceNote,
          finishedAt: new Date(),
        },
      });

      await this.audit.record({
        actorId, action: 'route.optimization.completed', entity: 'RouteOptimizationRun', entityId: run.id,
        after: { included: finished.includedCount, excluded: finished.excludedCount, provider: this.routing.providerName },
      });

      return { runId: run.id, result };
    } catch (error) {
      await this.prisma.routeOptimizationRun.update({
        where: { id: run.id },
        data: {
          status: OptimizationStatus.FALHOU,
          errorMessage: String(error).slice(0, 1000),
          finishedAt: new Date(),
        },
      });
      this.logger.error(`Otimizacao ${run.id} falhou: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Aplica a sugestao na rota: cria uma nova versao de planejamento.
   * O administrador continua no controle; nada e publicado automaticamente.
   */
  async applyToRoute(
    routeId: string,
    runId: string,
    options: { includeExcluded?: boolean; changeNote?: string },
    actorId: string | null,
  ) {
    const run = await this.prisma.routeOptimizationRun.findUnique({ where: { id: runId } });
    if (!run) throw new BadRequestException('Execucao de otimizacao nao encontrada.');
    if (run.status !== OptimizationStatus.CONCLUIDA) {
      throw new BadRequestException('A execucao de otimizacao nao foi concluida com sucesso.');
    }
    const rows = (run.result ?? []) as Array<{
      stopId: string; customerId: string; sequence: number;
      distanceFromPrevM: number; durationFromPrevS: number;
      plannedArrivalAt: string; plannedDepartureAt: string;
    }>;
    const order = rows
      .filter((r) => r.customerId !== '__RETURN_TO_BASE__')
      .sort((a, b) => a.sequence - b.sequence);

    const excluded = ((run.excluded ?? []) as Array<{ customerId: string; reason: string }>);
    const includeExcluded = options.includeExcluded ?? false;

    const stopsPayload: Array<{
      customerId: string; sequence: number;
      estTravelFromPrevS?: number | null; estDistanceFromPrevM?: number | null;
    }> = order.map((r, index) => ({
      customerId: r.customerId,
      sequence: index + 1,
      estTravelFromPrevS: r.durationFromPrevS,
      estDistanceFromPrevM: r.distanceFromPrevM,
    }));

    if (includeExcluded) {
      const alreadyIncluded = new Set(stopsPayload.map((s) => s.customerId));
      for (const item of excluded) {
        if (!alreadyIncluded.has(item.customerId)) {
          stopsPayload.push({
            customerId: item.customerId,
            sequence: stopsPayload.length + 1,
            estTravelFromPrevS: null,
            estDistanceFromPrevM: null,
          });
        }
      }
    }

    const result = await this.routes.setStops(
      routeId,
      stopsPayload,
      options.changeNote ?? `Aplicada sugestao da otimizacao ${runId}`,
      actorId,
    );
    await this.prisma.routeOptimizationRun.update({ where: { id: runId }, data: { routeId } });
    return result;
  }

  async listRuns(routeId?: string) {
    return this.prisma.routeOptimizationRun.findMany({
      where: routeId ? { routeId } : {},
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  async getRun(runId: string) {
    return this.prisma.routeOptimizationRun.findUnique({ where: { id: runId } });
  }
}
