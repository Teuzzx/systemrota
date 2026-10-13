import { Injectable } from '@nestjs/common';
import { JourneyStatus, Prisma, VisitStatus } from '@prisma/client';
import { estimateFuel, mean, median } from '@rota/shared';
import { stringify as stringifyCsv } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma.service';

export interface ReportFilter {
  from?: string;
  to?: string;
  driverId?: string;
  routeId?: string;
  city?: string;
  customerId?: string;
}

/**
 * Relatorios: sempre derivados de dados persistidos.
 * Nenhum numero e inventado; onde a medicao e estimada, o rotulo diz isso.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Detalhamento por jornada: o relatorio mais usado pela operacao. */
  async journeys(filter: ReportFilter) {
    const where = this.journeyWhere(filter);
    const journeys = await this.prisma.journey.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 1000,
      include: {
        driver: { include: { user: { select: { name: true, email: true } } } },
        route: { select: { id: true, code: true, name: true } },
        visits: { include: { customer: { select: { tradeName: true, city: true, neighborhood: true } } } },
        occurrences: true,
      },
    });

    const rows = journeys.map((journey) => {
      const concluded = journey.visits.filter((v) => v.status === VisitStatus.CONCLUIDA);
      const notDone = journey.visits.filter((v) => v.status === VisitStatus.NAO_REALIZADA);
      return {
        journeyId: journey.id,
        data: journey.startedAt.toISOString(),
        motorista: journey.driver.user.name,
        rota: journey.route?.code ?? '-',
        inicio: journey.startedAt.toISOString(),
        fim: journey.endedAt?.toISOString() ?? null,
        status: journey.status,
        distanciaGpsM: journey.gpsDistanceM,
        clientesPlanejados: journey.stopsPlanned,
        clientesConcluidos: concluded.length,
        clientesNaoAtendidos: notDone.length,
        tempoAtendimentoS: journey.serviceTotalS,
        tempoDeslocamentoS: journey.travelTotalS,
        tempoNaoClassificadoS: journey.unclassifiedS,
        tempoPausaS: journey.pauseTotalS,
        ocorrencias: journey.occurrences.length,
      };
    });

    const concludedDurations = journeys
      .flatMap((j) => j.visits)
      .map((v) => v.serviceDurationS)
      .filter((v): v is number => v !== null);

    return {
      filter,
      rowCount: rows.length,
      totals: {
        journeys: rows.length,
        distanceM: rows.reduce((a, r) => a + r.distanciaGpsM, 0),
        concluded: rows.reduce((a, r) => a + r.clientesConcluidos, 0),
        notDone: rows.reduce((a, r) => a + r.clientesNaoAtendidos, 0),
        serviceS: rows.reduce((a, r) => a + r.tempoAtendimentoS, 0),
        travelS: rows.reduce((a, r) => a + r.tempoDeslocamentoS, 0),
        occurrences: rows.reduce((a, r) => a + r.ocorrencias, 0),
        averageServiceS: mean(concludedDurations),
        medianServiceS: median(concludedDurations),
        serviceSampleSize: concludedDurations.length,
      },
      note:
        'Tempos derivados de eventos registrados. Distancia por GPS e estimativa, nao leitura de hodometro.',
      rows,
    };
  }

  /** Detalhamento por visita/cliente. */
  async visits(filter: ReportFilter) {
    const visits = await this.prisma.visit.findMany({
      where: { journey: this.journeyWhere(filter) },
      orderBy: [{ journey: { startedAt: 'desc' } }, { sequence: 'asc' }],
      take: 5000,
      include: {
        customer: { select: { tradeName: true, city: true, neighborhood: true, geocodeStatus: true } },
        driver: { include: { user: { select: { name: true } } } },
        journey: { select: { id: true, startedAt: true, route: { select: { code: true } } } },
      },
    });
    return {
      rowCount: visits.length,
      rows: visits.map((v) => ({
        data: v.journey.startedAt.toISOString(),
        motorista: v.driver.user.name,
        rota: v.journey.route?.code ?? '-',
        sequencia: v.sequence,
        cliente: v.customer.tradeName,
        cidade: v.customer.city,
        bairro: v.customer.neighborhood ?? '',
        status: v.status,
        chegada: v.arrivedAt?.toISOString() ?? null,
        inicioAtendimento: v.serviceStartedAt?.toISOString() ?? null,
        fimAtendimento: v.serviceEndedAt?.toISOString() ?? null,
        duracaoAtendimentoS: v.serviceDurationS,
        esperaS: v.waitDurationS,
        deslocamentoS: v.travelDurationS,
        qualidadeMedicao: v.travelQuality,
        motivoNaoRealizada: v.notDoneReason ?? '',
        origem: v.source,
      })),
    };
  }

  /** Indicadores por motorista no periodo. */
  async driverPerformance(filter: ReportFilter) {
    const journeys = await this.prisma.journey.findMany({
      where: this.journeyWhere(filter),
      include: {
        driver: { include: { user: { select: { name: true } } } },
        visits: true,
      },
      take: 1000,
    });
    const byDriver = new Map<string, {
      driverId: string; name: string; journeys: number; distanceM: number;
      serviceS: number; travelS: number; concluded: number; notDone: number; planned: number;
      serviceDurations: number[];
    }>();
    for (const journey of journeys) {
      const entry = byDriver.get(journey.driverId) ?? {
        driverId: journey.driverId, name: journey.driver.user.name, journeys: 0,
        distanceM: 0, serviceS: 0, travelS: 0, concluded: 0, notDone: 0, planned: 0, serviceDurations: [],
      };
      entry.journeys += 1;
      entry.distanceM += journey.gpsDistanceM;
      entry.serviceS += journey.serviceTotalS;
      entry.travelS += journey.travelTotalS;
      entry.concluded += journey.visits.filter((v) => v.status === VisitStatus.CONCLUIDA).length;
      entry.notDone += journey.visits.filter((v) => v.status === VisitStatus.NAO_REALIZADA).length;
      entry.planned += journey.visits.length;
      for (const visit of journey.visits) {
        if (visit.serviceDurationS !== null) entry.serviceDurations.push(visit.serviceDurationS);
      }
      byDriver.set(journey.driverId, entry);
    }
    return [...byDriver.values()].map((entry) => ({
      driverId: entry.driverId,
      name: entry.name,
      journeys: entry.journeys,
      distanceM: Math.round(entry.distanceM),
      serviceHours: round2(entry.serviceS / 3600),
      travelHours: round2(entry.travelS / 3600),
      planned: entry.planned,
      concluded: entry.concluded,
      notDone: entry.notDone,
      completionPct: entry.planned > 0 ? round2((entry.concluded / entry.planned) * 100) : null,
      averageServiceS: mean(entry.serviceDurations),
      medianServiceS: median(entry.serviceDurations),
    }));
  }

  /**
   * Planejamento de combustivel. SEMPRE rotulado como estimativa e nunca
   * comparado implicitamente comhodometro ou despesa real.
   */
  async fuel(filter: ReportFilter) {
    const journeys = await this.prisma.journey.findMany({
      where: { ...this.journeyWhere(filter), status: JourneyStatus.FINALIZADA },
      include: {
        driver: {
          include: {
            user: { select: { name: true } },
            vehicleAssignments: {
              where: { endAt: null },
              include: { vehicle: true },
              orderBy: { startAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      take: 1000,
    });

    const rows = journeys.map((journey) => {
      const vehicle = journey.driver.vehicleAssignments[0]?.vehicle ?? null;
      const distanceKm = journey.gpsDistanceM / 1000;
      const fuel = estimateFuel({
        distanceKm,
        avgConsumptionKmpl: vehicle?.avgConsumptionKmpl,
        fuelCostPerLiter: vehicle?.fuelCostPerLiter,
      });
      return {
        journeyId: journey.id,
        data: journey.startedAt.toISOString(),
        motorista: journey.driver.user.name,
        veiculo: vehicle?.plate ?? null,
        distanciaKm: round2(distanceKm),
        consumoInformado: vehicle?.avgConsumptionKmpl ?? null,
        litrosEstimados: fuel.estimatedLiters,
        custoEstimado: fuel.estimatedCost,
        confianca: fuel.confidence,
        observacao: fuel.reason,
        isEstimate: true,
      };
    });
    return {
      rowCount: rows.length,
      disclaimer:
        'Estimativas baseadas no consumo medio informado por veiculo. Nao representam despesa registrada e nao equivalem a leitura de hodometro.',
      rows,
    };
  }

  async exportCsv(filter: ReportFilter): Promise<string> {
    const report = await this.journeys(filter);
    return stringifyCsv(report.rows, { header: true, delimiter: ';' });
  }

  async exportXlsx(filter: ReportFilter): Promise<Buffer> {
    const report = await this.journeys(filter);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Jornadas');
    sheet.columns = [
      { header: 'Data', key: 'data', width: 22 },
      { header: 'Motorista', key: 'motorista', width: 26 },
      { header: 'Rota', key: 'rota', width: 10 },
      { header: 'Inicio', key: 'inicio', width: 22 },
      { header: 'Fim', key: 'fim', width: 22 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Distancia GPS (m)', key: 'distanciaGpsM', width: 16 },
      { header: 'Planejados', key: 'clientesPlanejados', width: 12 },
      { header: 'Concluidos', key: 'clientesConcluidos', width: 12 },
      { header: 'Nao atendidos', key: 'clientesNaoAtendidos', width: 14 },
      { header: 'Atendimento (s)', key: 'tempoAtendimentoS', width: 16 },
      { header: 'Deslocamento (s)', key: 'tempoDeslocamentoS', width: 18 },
      { header: 'Nao classificado (s)', key: 'tempoNaoClassificadoS', width: 18 },
      { header: 'Ocorrencias', key: 'ocorrencias', width: 12 },
    ];
    for (const row of report.rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };

    const totals = workbook.addWorksheet('Totais');
    totals.addRows(Object.entries(report.totals).map(([key, value]) => ({ Indicador: key, Valor: value })));
    totals.getColumn(1).width = 32;
    totals.getColumn(2).width = 18;

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private journeyWhere(filter: ReportFilter): Prisma.JourneyWhereInput {
    return {
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.routeId ? { routeId: filter.routeId } : {}),
      ...(filter.from || filter.to
        ? {
            startedAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
      ...(filter.city || filter.customerId
        ? {
            visits: {
              some: {
                customer: {
                  ...(filter.city ? { city: filter.city } : {}),
                  ...(filter.customerId ? { id: filter.customerId } : {}),
                },
              },
            },
          }
        : {}),
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
