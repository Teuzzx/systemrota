import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Connectivity, JourneyEventType, Prisma } from '@prisma/client';
import { accumulateGpsDistance, dataAgeSeconds, dataFreshness, validateCoordinate } from '@rota/shared';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';

export interface LocationPointInput {
  clientPointId: string;
  sequenceNo: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: string;
  speedMps?: number | null;
  bearingDeg?: number | null;
  connectivity?: Connectivity;
  batteryPct?: number | null;
  isSimulated?: boolean;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: Array<{ clientPointId: string; reason: string }>;
  distanceM: number;
  batchDistanceQuality: 'EXATA' | 'ESTIMADA' | 'INCOMPLETA';
}

export interface SyncEventInput {
  clientEventId: string;
  journeyId: string;
  sequenceNo: number;
  type: JourneyEventType;
  capturedAt: string;
  payload?: unknown;
  latitude?: number | null;
  longitude?: number | null;
  accuracyM?: number | null;
}

export interface SyncResult {
  accepted: string[];
  duplicates: string[];
  rejected: Array<{ clientEventId: string; reason: string }>;
  journeyId: string;
  /** Divergencia de versao de rota detectada (admin alterou durante o offline). */
  routeVersionConflict: {
    detected: boolean;
    deviceVersion: number | null;
    serverVersion: number | null;
  };
}

/**
 * Ingestao de localizacao e de eventos operacionais vindos do aplicativo.
 *
 * DUAS garantias de idempotencia, ambas no banco:
 *  - LocationPoint.clientPointId UNIQUE
 *  - JourneyEvent.clientEventId UNIQUE
 * Reenvio do mesmo lote (reconexao apos area sem sinal) nunca duplica
 * contabilizacao: o segundo envio e reconhecido e nao contabilizado.
 */
@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async ingestBatch(
    driverId: string,
    journeyId: string,
    points: LocationPointInput[],
    opts: { maxAccuracyM?: number } = {},
  ): Promise<IngestResult> {
    if (points.length === 0) throw new BadRequestException('Lote de localizacao vazio.');
    if (points.length > 2000) throw new BadRequestException('Lote acima do limite de 2000 pontos.');

    const maxAccuracy = opts.maxAccuracyM ?? 100;
    const retentionDays = this.config.tracking.locationRetentionDays;
    const rejected: Array<{ clientPointId: string; reason: string }> = [];
    const valid: LocationPointInput[] = [];

    for (const point of points) {
      const geo = validateCoordinate(point.latitude, point.longitude);
      if (!geo.valid) {
        rejected.push({
          clientPointId: point.clientPointId,
          reason: geo.reason ?? 'Coordenada invalida.',
        });
        continue;
      }
      if (!(point.accuracyM > 0) || point.accuracyM > maxAccuracy) {
        rejected.push({
          clientPointId: point.clientPointId,
          reason: `Precisao ${point.accuracyM}m fora do limite de ${maxAccuracy}m.`,
        });
        continue;
      }
      if (Number.isNaN(new Date(point.capturedAt).getTime())) {
        rejected.push({ clientPointId: point.clientPointId, reason: 'capturedAt invalido.' });
        continue;
      }
      valid.push(point);
    }

    let accepted = 0;
    let duplicates = 0;
    const storedIds: string[] = [];

    for (const point of valid) {
      const capturedAt = new Date(point.capturedAt);
      const retainedUntil = new Date(capturedAt.getTime() + retentionDays * 86_400_000);
      try {
        await this.prisma.locationPoint.create({
          data: {
            journeyId,
            driverId,
            clientPointId: point.clientPointId,
            sequenceNo: point.sequenceNo,
            latitude: point.latitude,
            longitude: point.longitude,
            accuracyM: point.accuracyM,
            speedMps: point.speedMps ?? null,
            bearingDeg: point.bearingDeg ?? null,
            connectivity: point.connectivity ?? Connectivity.ONLINE,
            batteryPct: point.batteryPct ?? null,
            capturedAt,
            receivedAt: new Date(),
            isSimulated: point.isSimulated ?? false,
            retainedUntil,
          },
        });
        accepted += 1;
        storedIds.push(point.clientPointId);
      } catch (error) {
        // Chave unica violada = reenvio do mesmo ponto. Nao e erro.
        if (isUniqueViolation(error)) {
          duplicates += 1;
        } else {
          rejected.push({ clientPointId: point.clientPointId, reason: String(error).slice(0, 200) });
        }
      }
    }

    // Coluna geography + distancia filtrada do lote.
    // Prisma.join gera um placeholder por id: nenhum valor e concatenado no SQL.
    if (storedIds.length > 0) {
      await this.prisma.$executeRaw`
        UPDATE "location_points"
           SET "location" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
         WHERE "clientPointId" IN (${Prisma.join(storedIds)})
      `;
    }

    const accumulation = await this.recomputeJourneyDistance(journeyId);
    const quality = accumulation.rejected > 0
      ? 'INCOMPLETA'
      : accumulation.distanceM > 0 ? 'EXATA' : 'INCOMPLETA';

    if (accepted > 0) {
      await this.audit.record({
        actorId: null, action: 'location.batch_ingested', entity: 'Journey', entityId: journeyId,
        after: { accepted, duplicates, rejected: rejected.length, distanceM: accumulation.distanceM },
      });
    }

    return {
      accepted,
      duplicates,
      rejected,
      distanceM: accumulation.distanceM,
      batchDistanceQuality: quality as IngestResult['batchDistanceQuality'],
    };
  }

  /**
   * Sincronizacao de eventos operacionais (offline-first).
   * Cada evento tem clientEventId; reenvio e reconhecido como duplicado.
   */
  async ingestEvents(
    driverId: string,
    events: SyncEventInput[],
  ): Promise<SyncResult> {
    if (events.length === 0) throw new BadRequestException('Lote de eventos vazio.');
    if (events.length > 500) throw new BadRequestException('Lote acima do limite de 500 eventos.');

    const journeyIds = [...new Set(events.map((e) => e.journeyId))];
    if (journeyIds.length > 1) {
      throw new BadRequestException('Lote com eventos de jornadas diferentes. Envie uma jornada por vez.');
    }
    const journeyId = journeyIds[0] as string;

    const journey = await this.prisma.journey.findUnique({ where: { id: journeyId } });
    if (!journey) throw new BadRequestException('Jornada nao encontrada.');
    if (journey.driverId !== driverId) {
      throw new BadRequestException('Os eventos nao pertencem ao motorista autenticado.');
    }

    const accepted: string[] = [];
    const duplicates: string[] = [];
    const rejected: Array<{ clientEventId: string; reason: string }> = [];

    for (const event of events) {
      if (!Object.values(JourneyEventType).includes(event.type)) {
        rejected.push({ clientEventId: event.clientEventId, reason: `Tipo de evento invalido: ${String(event.type)}` });
        continue;
      }
      if (Number.isNaN(new Date(event.capturedAt).getTime())) {
        rejected.push({ clientEventId: event.clientEventId, reason: 'capturedAt invalido.' });
        continue;
      }
      try {
        await this.prisma.journeyEvent.create({
          data: {
            journeyId,
            driverId,
            clientEventId: event.clientEventId,
            sequenceNo: event.sequenceNo,
            type: event.type,
            capturedAt: new Date(event.capturedAt),
            payload: event.payload === undefined ? Prisma.JsonNull : (event.payload as Prisma.InputJsonValue),
            latitude: event.latitude ?? null,
            longitude: event.longitude ?? null,
            accuracyM: event.accuracyM ?? null,
          },
        });
        accepted.push(event.clientEventId);
      } catch (error) {
        if (isUniqueViolation(error)) duplicates.push(event.clientEventId);
        else rejected.push({ clientEventId: event.clientEventId, reason: String(error).slice(0, 200) });
      }
    }

    // Conflito de versao de rota: o admin mudou a rota enquanto o app estava offline.
    let conflict = { detected: false, deviceVersion: null as number | null, serverVersion: null as number | null };
    if (journey.routeId) {
      const route = await this.prisma.route.findUnique({
        where: { id: journey.routeId },
        select: { currentVersion: true },
      });
      conflict = {
        detected: route !== null && journey.routeVersionAtStart !== null && route.currentVersion !== journey.routeVersionAtStart,
        deviceVersion: journey.routeVersionAtStart,
        serverVersion: route?.currentVersion ?? null,
      };
      if (conflict.detected) {
        await this.prisma.journeyEvent.create({
          data: {
            journeyId,
            driverId,
            clientEventId: `conflict-${journeyId}-${journey.routeVersionAtStart}-${route?.currentVersion}`,
            sequenceNo: -1,
            type: JourneyEventType.ROUTE_VERSION_CONFLICT,
            capturedAt: new Date(),
            payload: {
              deviceVersion: journey.routeVersionAtStart,
              serverVersion: route?.currentVersion,
            } as Prisma.InputJsonValue,
          },
        }).catch(() => undefined);
      }
    }

    return { accepted, duplicates, rejected, journeyId, routeVersionConflict: conflict };
  }

  /** Recalcula a distancia da jornada aplicando filtro de ruido de GPS. */
  async recomputeJourneyDistance(journeyId: string) {
    const points = await this.prisma.locationPoint.findMany({
      where: { journeyId },
      orderBy: { capturedAt: 'asc' },
      take: 20000,
    });
    const accumulation = accumulateGpsDistance(
      points.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        capturedAt: p.capturedAt,
        accuracyM: p.accuracyM,
        speedMps: p.speedMps,
      })),
    );
    await this.prisma.journey.update({
      where: { id: journeyId },
      data: { gpsDistanceM: accumulation.distanceM },
    });
    return accumulation;
  }

  /**
   * Posicao mais recente por motorista, COM idade do dado.
   * O painel nunca pode apresentar posicao antiga como se fosse atual.
   */
  async latestPositions(staleAfterS = 300) {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<
      Array<{
        driverId: string; driverName: string; journeyId: string; routeId: string | null;
        routeCode: string | null; journeyStatus: string;
        latitude: number; longitude: number; accuracyM: number;
        capturedAt: Date; receivedAt: Date; speedMps: number | null; bearingDeg: number | null;
        connectivity: string; batteryPct: number | null;
      }>
    >`
      SELECT lp."driverId",
             u."name" AS "driverName",
             lp."journeyId",
             r."id"   AS "routeId",
             r."code" AS "routeCode",
             j."status" AS "journeyStatus",
             lp."latitude", lp."longitude", lp."accuracyM",
             lp."capturedAt", lp."receivedAt", lp."speedMps", lp."bearingDeg",
             lp."connectivity", lp."batteryPct"
        FROM "location_points" lp
        JOIN "drivers" d ON d."id" = lp."driverId"
        JOIN "users"   u ON u."id" = d."userId"
        JOIN "journeys" j ON j."id" = lp."journeyId"
        LEFT JOIN "routes" r ON r."id" = j."routeId"
       WHERE lp."id" IN (
             SELECT DISTINCT ON (lp2."driverId") lp2."id"
               FROM "location_points" lp2
              JOIN "journeys" j2 ON j2."id" = lp2."journeyId"
              WHERE j2."status" IN ('EM_ANDAMENTO', 'PAUSADA')
              ORDER BY lp2."driverId", lp2."capturedAt" DESC
       )
       ORDER BY lp."capturedAt" DESC
    `;

    return rows.map((row) => {
      const ageS = dataAgeSeconds(row.receivedAt, now);
      return {
        driverId: row.driverId,
        driverName: row.driverName,
        journeyId: row.journeyId,
        routeId: row.routeId,
        routeCode: row.routeCode,
        journeyStatus: row.journeyStatus,
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyM: row.accuracyM,
        capturedAt: row.capturedAt,
        receivedAt: row.receivedAt,
        speedMps: row.speedMps,
        bearingDeg: row.bearingDeg,
        connectivity: row.connectivity,
        batteryPct: row.batteryPct,
        dataAgeSeconds: ageS,
        freshness: dataFreshness(row.receivedAt, now, staleAfterS),
      };
    });
  }

  /** Trajeto efetivamente registrado. Sem dados, devolve vazio (nada e inventado). */
  async journeyTrack(journeyId: string) {
    const points = await this.prisma.locationPoint.findMany({
      where: { journeyId },
      orderBy: { capturedAt: 'asc' },
      take: 5000,
      select: { latitude: true, longitude: true, accuracyM: true, capturedAt: true, speedMps: true },
    });
    return {
      journeyId,
      pointCount: points.length,
      isRealData: points.length > 0,
      points,
    };
  }

  /** Politica de retencao: aplicacao real da politica configurada. */
  async purgeExpired(): Promise<{ deleted: number }> {
    const result = await this.prisma.locationPoint.deleteMany({
      where: { retainedUntil: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Retencao: ${result.count} ponto(s) de localizacao removido(s).`);
    }
    return { deleted: result.count };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}
