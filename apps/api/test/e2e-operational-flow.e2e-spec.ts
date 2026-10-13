/**
 * TESTE END-TO-END DO FLUXO COMPLETO (briefing, secao 21).
 *
 * Executa os 15 passos do fluxo real, com HTTP real, autenticacao real,
 * PostgreSQL real (PGlite + PostGIS) e persistencia real. Nada e mockado.
 */
import request from 'supertest';
import { TestApp, createTestApp } from './app';
import { authHeader, login } from './http';
import {
  bootstrapTestData,
  createAdmin,
  createCustomer,
  createDriver,
  getTestPrisma,
  setTestPrisma,
} from './fixtures';
import { PrismaService } from '../src/common/prisma.service';

jest.setTimeout(180_000);

describe('Fluxo end-to-end completo da operacao', () => {
  let app!: TestApp;
  let closed = false;
  let admin!: { accessToken: string; userId: string };
  let driver!: { accessToken: string; userId: string; driverId: string };

  const prisma = () => getTestPrisma();
  const auth = () => authHeader(admin.accessToken);
  const driverAuth = () => authHeader(driver.accessToken);

  beforeAll(async () => {
    app = await createTestApp();
    // Um unico PrismaClient em toda a suite (limite de conexao do PGlite).
    setTestPrisma(app.app.get(PrismaService));
    await bootstrapTestData();

    const adminUser = await createAdmin();
    const driverUser = await createDriver();
    // Autentica de verdade: a autenticacao nao e desabilitada nos testes.
    admin = await login(app, adminUser.email);
    const driverLogin = await login(app, driverUser.email);
    driver = {
      accessToken: driverLogin.accessToken,
      userId: driverLogin.userId,
      driverId: driverUser.driverId as string,
    };
  });

  afterAll(async () => {
    if (!closed && app) {
      closed = true;
      await app.close();
    }
  });
  it('1-4. Administrador cadastra cliente, cria rota, atribui e publica', async () => {
    const cliente = await request(app.app.getHttpServer())
      .post('/api/customers')
      .set(...auth())
      .send({
        tradeName: 'Mercearia Teste E2E',
        city: 'Picos',
        neighborhood: 'Sao Jose',
        addressLine: 'Rua Teste, 100',
        latitude: -7.0712,
        longitude: -45.0185,
      })
      .expect(201);
    expect(cliente.body.geocodeStatus).toBe('VALIDADO');

    // Passo 2: rota
    const hoje = new Date().toISOString().slice(0, 10);
    const rota = await request(app.app.getHttpServer())
      .post('/api/routes')
      .set(...auth())
      .send({ code: 'R-E2E', name: 'Rota E2E', plannedDate: hoje, cities: ['Picos'] })
      .expect(201);

    // Passo 3: atribui o motorista
    await request(app.app.getHttpServer())
      .patch(`/api/routes/${rota.body.id}`)
      .set(...auth())
      .send({ driverId: driver.driverId })
      .expect(200);

    // Cliente sem coordenada deve entrar na rota mesmo assim, sinalizado.
    const semGeo = await createCustomer({ tradeName: 'Cliente Sem Geo E2E', latitude: null, longitude: null });

    const paradas = await request(app.app.getHttpServer())
      .put(`/api/routes/${rota.body.id}/stops`)
      .set(...auth())
      .send({
        changeNote: 'Planejamento inicial E2E',
        stops: [
          { customerId: cliente.body.id, sequence: 1 },
          { customerId: semGeo.id, sequence: 2 },
        ],
      })
      .expect(200);
    expect(paradas.body.stops).toBe(2);
    expect(paradas.body.version).toBe(2);
    expect(paradas.body.diff.added).toHaveLength(2);

    // Passo 4: publica
    await request(app.app.getHttpServer())
      .post(`/api/routes/${rota.body.id}/publish`)
      .set(...auth())
      .expect(201);
  });

  it('5-7. Motorista entra no app e inicia a jornada', async () => {
    const route = await prisma().route.findUniqueOrThrow({
      where: { code: 'R-E2E' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    const jornada = await request(app.app.getHttpServer())
      .post('/api/journeys')
      .set(...driverAuth())
      .send({
        routeId: route.id,
        routeVersionAtStart: route.currentVersion,
        startedAt: new Date().toISOString(),
      })
      .expect(201);

    expect(jornada.body.status).toBe('EM_ANDAMENTO');
    expect(jornada.body.stopsPlanned).toBe(2);

    // A rota entra em execucao.
    const rotaEmExecucao = await prisma().route.findUniqueOrThrow({ where: { id: route.id } });
    expect(rotaEmExecucao.status).toBe('EM_EXECUCAO');
  });

  it('7b. Rejeita segunda jornada simultanea para o mesmo motorista', async () => {
    const route = await prisma().route.findUniqueOrThrow({ where: { code: 'R-E2E' } });
    await request(app.app.getHttpServer())
      .post('/api/journeys')
      .set(...driverAuth())
      .send({ routeId: null, startedAt: new Date().toISOString() })
      .expect(409);
    void route;
  });

  it('8-11. Registra chegada, atendimento e calcula a duracao', async () => {
    const journey = await prisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
      include: { visits: { orderBy: { sequence: 'asc' } } },
    });
    const primeira = journey.visits[0]!;

    const chegada = new Date(journey.startedAt.getTime() + 12 * 60_000);
    const inicio = new Date(chegada.getTime() + 3 * 60_000);
    const fim = new Date(inicio.getTime() + 20 * 60_000);

    await request(app.app.getHttpServer())
      .post('/api/visits/events')
      .set(...driverAuth())
      .send({ journeyId: journey.id, customerId: primeira.customerId, type: 'ARRIVED', capturedAt: chegada.toISOString() })
      .expect(201);

    await request(app.app.getHttpServer())
      .post('/api/visits/events')
      .set(...driverAuth())
      .send({ journeyId: journey.id, customerId: primeira.customerId, type: 'SERVICE_STARTED', capturedAt: inicio.toISOString() })
      .expect(201);

    const concluida = await request(app.app.getHttpServer())
      .post('/api/visits/events')
      .set(...driverAuth())
      .send({ journeyId: journey.id, customerId: primeira.customerId, type: 'SERVICE_ENDED', capturedAt: fim.toISOString() })
      .expect(201);

    // Passo 11: duracao correta = 20 min; espera = 3 min.
    expect(concluida.body.serviceDurationS).toBe(20 * 60);
    expect(concluida.body.waitDurationS).toBe(3 * 60);
    expect(concluida.body.status).toBe('CONCLUIDA');
  });

  it('9-10. Localizacao capturada chega ao painel com idade do dado', async () => {
    const journey = await prisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
    });

    const base = new Date(journey.startedAt.getTime() + 60_000);
    const pontos = [0, 1, 2, 3].map((i) => ({
      clientPointId: `e2e-pt-${i}`,
      sequenceNo: i,
      latitude: -7.0774 - i * 0.0002,
      longitude: -45.0236 + i * 0.0002,
      accuracyM: 8,
      capturedAt: new Date(base.getTime() + i * 20_000).toISOString(),
      speedMps: 8,
    }));

    const ingestao = await request(app.app.getHttpServer())
      .post('/api/locations/batch')
      .set(...driverAuth())
      .send({ journeyId: journey.id, points: pontos })
      .expect(201);

    expect(ingestao.body.accepted).toBe(4);
    expect(ingestao.body.duplicates).toBe(0);
    expect(ingestao.body.distanceM).toBeGreaterThan(0);

    const posicoes = await request(app.app.getHttpServer())
      .get('/api/locations/positions')
      .set(...auth())
      .expect(200);

    const minha = posicoes.body.find((p: { driverId: string }) => p.driverId === driver.driverId);
    expect(minha).toBeDefined();
    expect(minha.freshness).toBe('ATUAL');
    expect(minha.dataAgeSeconds).toBeLessThanOrEqual(300);

    const trajeto = await request(app.app.getHttpServer())
      .get(`/api/locations/journeys/${journey.id}/track`)
      .set(...auth())
      .expect(200);
    expect(trajeto.body.isRealData).toBe(true);
    expect(trajeto.body.pointCount).toBe(4);
  });

  it('18-20. Reenvio do mesmo lote nao duplica contabilizacao', async () => {
    const journey = await prisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
    });

    const reenvio = await request(app.app.getHttpServer())
      .post('/api/locations/batch')
      .set(...driverAuth())
      .send({
        journeyId: journey.id,
        points: [{
          clientPointId: 'e2e-pt-0',
          sequenceNo: 0,
          latitude: -7.0774,
          longitude: -45.0236,
          accuracyM: 8,
          capturedAt: new Date(journey.startedAt.getTime() + 60_000).toISOString(),
        }],
      })
      .expect(201);

    expect(reenvio.body.accepted).toBe(0);
    expect(reenvio.body.duplicates).toBe(1);

    const total = await prisma().locationPoint.count({ where: { journeyId: journey.id } });
    expect(total).toBe(4);
  });

  it('17. Motorista registra visita nao realizada com justificativa', async () => {
    const journey = await prisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
      include: { visits: { orderBy: { sequence: 'asc' } } },
    });
    const segunda = journey.visits.find((v) => v.status === 'PLANEJADA');

    await request(app.app.getHttpServer())
      .post('/api/visits/events')
      .set(...driverAuth())
      .send({
        journeyId: journey.id,
        customerId: segunda!.customerId,
        type: 'NOT_DONE',
        capturedAt: new Date(journey.startedAt.getTime() + 90 * 60_000).toISOString(),
        notDoneReason: 'ESTABELECIMENTO_FECHADO',
        notDoneNote: 'Loja fechada no horario da visita (E2E).',
      })
      .expect(201);

    const ocorrencias = await prisma().occurrence.count({
      where: { journeyId: journey.id, type: 'ESTABELECIMENTO_FECHADO' },
    });
    expect(ocorrencias).toBe(1);
  });

  it('13-14. Encerra jornada e consolida os tempos', async () => {
    const journey = await prisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
    });

    const resposta = await request(app.app.getHttpServer())
      .post(`/api/journeys/${journey.id}/finish`)
      .set(...driverAuth())
      .send({ capturedAt: new Date(journey.startedAt.getTime() + 2 * 3600_000).toISOString(), pauseTotalS: 600 })
      .expect(201);

    expect(resposta.body.journey.status).toBe('FINALIZADA');
    expect(resposta.body.breakdown.totals.ATENDIMENTO).toBe(20 * 60);
    expect(resposta.body.journey.stopsConcluded).toBe(1);
    expect(resposta.body.journey.stopsNotDone).toBe(1);

    const rota = await prisma().route.findUniqueOrThrow({ where: { code: 'R-E2E' } });
    expect(rota.status).toBe('CONCLUIDA');
  });

  it('12. Painel web reflete o progresso calculado', async () => {
    const dashboard = await request(app.app.getHttpServer())
      .get('/api/dashboard/overview')
      .set(...auth())
      .expect(200);

    expect(dashboard.body.visits.concluded).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.visits.notDone).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.service.sampleSize).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.routes.concluded).toBeGreaterThanOrEqual(1);
  });

  it('21-22. Historico e relatorio utilizam dados persistidos', async () => {
    const historico = await request(app.app.getHttpServer())
      .get('/api/journeys')
      .set(...auth())
      .expect(200);
    expect(historico.body.data.length).toBeGreaterThanOrEqual(1);

    const relatorio = await request(app.app.getHttpServer())
      .get('/api/reports/journeys')
      .set(...auth())
      .expect(200);
    expect(relatorio.body.rowCount).toBeGreaterThanOrEqual(1);
    expect(relatorio.body.totals.concluded).toBeGreaterThanOrEqual(1);

    const csv = await request(app.app.getHttpServer())
      .get('/api/reports/journeys.csv')
      .set(...auth())
      .expect(200);
    expect(typeof csv.text).toBe('string');
    expect(csv.text).toContain('motorista');
  });
});
