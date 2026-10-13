/**
 * Importacao, otimizacao, alertas e sincronizacao offline (secoes 5, 7, 13 e 16).
 */
import 'reflect-metadata';
import request from 'supertest';
import { TestApp, createTestApp } from './app';
import { authHeader, login } from './http';
import { bootstrapTestData, createAdmin, createCustomer, createDriver, getTestPrisma } from './fixtures';

jest.setTimeout(180_000);

const CSV_DEMO = [
  'Identificador;Estabelecimento;Bairro;Cidade;Telefone;Latitude;Longitude',
  'LEG-001;Mercearia Importada;Sao Jose;Picos;8888-0001;-7.0712;-45.0185',
  'LEG-002;Farmacia Importada;Centro;Picos;8888-0002;-7.0758;-45.0240',
  'LEG-003;Bar Sem Coordenada;Rural;Picos;8888-0003;;',
].join('\n');

describe('Importacao de clientes do sistema comercial', () => {
  let app!: TestApp;
  let admin!: { accessToken: string };

  beforeAll(async () => {
    app = await createTestApp();
    await bootstrapTestData();
    admin = await login(app, (await createAdmin()).email);
  });

  afterAll(async () => {
    await app.close();
  });

  it('executa o fluxo em etapas: upload, previa, confirmacao e relatorio', async () => {
    const upload = await request(app.app.getHttpServer())
      .post('/api/imports/upload')
      .set(...authHeader(admin.accessToken))
      .attach('file', Buffer.from(CSV_DEMO, 'utf8'), 'clientes.csv')
      .expect(201);

    expect(upload.body.importId).toBeTruthy();
    expect(upload.body.headers).toContain('Estabelecimento');
    // Sugestao automatica de mapeamento por nome de coluna.
    expect(upload.body.suggestedMapping.tradeName).toBe('Estabelecimento');
    expect(upload.body.suggestedMapping.city).toBe('Cidade');

    const preview = await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/preview`)
      .set(...authHeader(admin.accessToken))
      .send({ mapping: upload.body.suggestedMapping })
      .expect(201);

    expect(preview.body.previewRows.length).toBeGreaterThan(0);
    // Cliente sem coordenada entra como pendencia, nao e descartado.
    expect(preview.body.summary.willInsert).toBe(3);
    expect(preview.body.issues.some((i: { message: string }) => /geolocalizacao/i.test(i.message))).toBe(true);

    const commit = await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/commit`)
      .set(...authHeader(admin.accessToken))
      .send({ onConflict: 'SKIP' })
      .expect(201);

    expect(commit.body.insertedCount).toBe(3);
    expect(commit.body.status).toBe('COMMITTED');

    const customers = await getTestPrisma().customer.findMany({ where: { sourceSystem: 'LEGACY_IMPORT' } });
    expect(customers).toHaveLength(3);
    const semCoordenada = customers.find((c) => c.tradeName.includes('Sem Coordenada'));
    expect(semCoordenada?.geocodeStatus).toBe('AUSENTE');
    expect(semCoordenada?.latitude).toBeNull();
  });

  it('e idempotente: reenviar o mesmo arquivo nao duplica clientes', async () => {
    const upload = await request(app.app.getHttpServer())
      .post('/api/imports/upload')
      .set(...authHeader(admin.accessToken))
      .attach('file', Buffer.from(CSV_DEMO, 'utf8'), 'clientes.csv')
      .expect(201);

    expect(upload.body.reusedExistingBatch).toBe(true);
    expect(upload.body.insertedCount).toBe(3);

    const total = await getTestPrisma().customer.count({ where: { sourceSystem: 'LEGACY_IMPORT' } });
    expect(total).toBe(3);
  });

  it('nao sobrescreve cadastro existente sem regra explicita', async () => {
    // O cliente LEG-001 ja existe (importado no teste anterior).
    const existente = await getTestPrisma().customer.findFirstOrThrow({
      where: { externalId: 'LEG-001' },
    });
    const csv = [
      'Identificador;Estabelecimento;Bairro;Cidade;Latitude;Longitude',
      'LEG-001;Mercearia Importada EDITADA;Sao Jose;Picos;-7.0712;-45.0185',
    ].join('\n');

    const upload = await request(app.app.getHttpServer())
      .post('/api/imports/upload')
      .set(...authHeader(admin.accessToken))
      .attach('file', Buffer.from(csv, 'utf8'), 'conflito.csv')
      .expect(201);

    await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/preview`)
      .set(...authHeader(admin.accessToken))
      .send({ mapping: {} })
      .expect(201);

    const commit = await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/commit`)
      .set(...authHeader(admin.accessToken))
      .send({ onConflict: 'SKIP' })
      .expect(201);

    expect(commit.body.insertedCount).toBe(0);
    expect(commit.body.skippedCount).toBe(1);

    const depois = await getTestPrisma().customer.findUniqueOrThrow({ where: { id: existente.id } });
    expect(depois.tradeName).toBe('Mercearia Importada');
  });

  it('rejeita lote ja processado', async () => {
    const upload = await request(app.app.getHttpServer())
      .post('/api/imports/upload')
      .set(...authHeader(admin.accessToken))
      .attach('file', Buffer.from('Estabelecimento;Cidade\nNovo;Picos', 'utf8'), 'novo.csv')
      .expect(201);

    await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/preview`)
      .set(...authHeader(admin.accessToken))
      .send({ mapping: {} })
      .expect(201);
    await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/commit`)
      .set(...authHeader(admin.accessToken))
      .send({ onConflict: 'SKIP' })
      .expect(201);

    await request(app.app.getHttpServer())
      .post(`/api/imports/${upload.body.importId}/commit`)
      .set(...authHeader(admin.accessToken))
      .send({})
      .expect(400);
  });

  it('exporta clientes em CSV e XLSX', async () => {
    const csv = await request(app.app.getHttpServer())
      .get('/api/imports/export/customers.csv')
      .set(...authHeader(admin.accessToken))
      .expect(200);
    expect(csv.text).toContain('nome_estabelecimento');

    const xlsx = await request(app.app.getHttpServer())
      .get('/api/imports/export/customers.xlsx')
      .set(...authHeader(admin.accessToken))
      .responseType('blob')
      .expect(200);
    expect(String(xlsx.headers['content-type'])).toContain('spreadsheetml');
    expect(String(xlsx.headers['content-disposition'])).toContain('clientes.xlsx');
    expect(xlsx.body.length).toBeGreaterThan(1000);
  });

  it('consulta clientes por proximity usando PostGIS', async () => {
    const nearby = await request(app.app.getHttpServer())
      .get('/api/customers/nearby?latitude=-7.0774&longitude=-45.0236&radiusM=3000')
      .set(...authHeader(admin.accessToken))
      .expect(200);
    expect(Array.isArray(nearby.body)).toBe(true);
    expect(nearby.body.length).toBeGreaterThan(0);
    expect(nearby.body[0].distanceM).toBeLessThanOrEqual(3000);
  });

  it('lista clientes pendentes de geolocalizacao', async () => {
    const pendentes = await request(app.app.getHttpServer())
      .get('/api/customers/pending-geocode')
      .set(...authHeader(admin.accessToken))
      .expect(200);
    expect(pendentes.body.length).toBeGreaterThan(0);
  });
});

describe('Otimizacao de rotas', () => {
  let app!: TestApp;
  let admin!: { accessToken: string };
  const customerIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await bootstrapTestData();
    admin = await login(app, (await createAdmin()).email);

    const pontos = [
      { tradeName: 'Otim A', latitude: -7.0712, longitude: -45.0185 },
      { tradeName: 'Otim B', latitude: -7.0830, longitude: -45.0120 },
      { tradeName: 'Otim C', latitude: -7.0758, longitude: -45.0240 },
      { tradeName: 'Otim D', latitude: -7.0900, longitude: -45.0400 },
    ];
    for (const p of pontos) {
      const created = await createCustomer(p);
      customerIds.push(created.id);
    }
    await createCustomer({ tradeName: 'Otim sem geo', latitude: null, longitude: null }).then((c) =>
      customerIds.push(c.id),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('gera sugestao justificavel com inclusoes, exclusoes e restricoes', async () => {
    const response = await request(app.app.getHttpServer())
      .post('/api/optimization/suggest')
      .set(...authHeader(admin.accessToken))
      .send({
        customerIds,
        originLatitude: -7.0774,
        originLongitude: -45.0236,
        startAt: new Date().toISOString(),
      })
      .expect(201);

    const result = response.body.result;
    expect(result.isSuggestion).toBe(true);
    expect(result.suggestedCustomerOrder.length).toBe(4);
    expect(result.totalDistanceM).toBeGreaterThan(0);
    expect(result.totalServiceS).toBeGreaterThan(0);
    expect(result.constraints.length).toBeGreaterThan(0);
    expect(result.confidenceNote).toBeTruthy();

    // Cliente sem coordenada e excluido COM MOTIVO, nunca silenciosamente.
    const semGeo = result.excluded.find((e: { customerId: string }) => e.customerId === customerIds[4]);
    expect(semGeo).toBeDefined();
    expect(semGeo.reason).toBe('SEM_COORDENADAS');

    // A execucao fica registrada para auditoria.
    const run = await getTestPrisma().routeOptimizationRun.findUniqueOrThrow({
      where: { id: response.body.runId },
    });
    expect(run.status).toBe('CONCLUIDA');
    expect(run.includedCount).toBe(4);
    expect(run.excludedCount).toBe(1);
    expect(run.provider).toBe('heuristic-offline');
  });

  it('aplica a sugestao na rota criando nova versao de planejamento', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const rota = await request(app.app.getHttpServer())
      .post('/api/routes')
      .set(...authHeader(admin.accessToken))
      .send({ code: 'R-OTIM', name: 'Rota Otimizacao', plannedDate: hoje })
      .expect(201);

    const sugestao = await request(app.app.getHttpServer())
      .post('/api/optimization/suggest')
      .set(...authHeader(admin.accessToken))
      .send({
        routeId: rota.body.id,
        customerIds,
        originLatitude: -7.0774,
        originLongitude: -45.0236,
      })
      .expect(201);

    const aplicado = await request(app.app.getHttpServer())
      .post(`/api/optimization/runs/${sugestao.body.runId}/apply/${rota.body.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ changeNote: 'Aplicada sugestao E2E' })
      .expect(201);

    expect(aplicado.body.stops).toBe(4);
    expect(aplicado.body.version).toBe(2);

    const stops = await getTestPrisma().routeStop.findMany({
      where: { routeId: rota.body.id },
      orderBy: { sequence: 'asc' },
    });
    expect(stops).toHaveLength(4);
    expect(stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4]);
  });
});

describe('Alertas automaticos', () => {
  let app!: TestApp;
  let admin!: { accessToken: string };
  let driverId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await bootstrapTestData();
    admin = await login(app, (await createAdmin()).email);
    driverId = (await createDriver()).driverId as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('gera alerta de cliente sem coordenadas e deduplica', async () => {
    await createCustomer({ tradeName: 'Alerta Sem Geo', latitude: null, longitude: null });

    const primeira = await request(app.app.getHttpServer())
      .post('/api/alerts/evaluate')
      .set(...authHeader(admin.accessToken))
      .expect(201);
    expect(primeira.body.created).toBeGreaterThan(0);

    const segunda = await request(app.app.getHttpServer())
      .post('/api/alerts/evaluate')
      .set(...authHeader(admin.accessToken))
      .expect(201);
    // Deduplicacao: a segunda avaliacao nao duplica os mesmos alertas.
    expect(segunda.body.created).toBe(0);

    const alerts = await getTestPrisma().alert.findMany();
    const regra = alerts.find((a) => a.ruleKey === 'CUSTOMER_WITHOUT_COORDS');
    expect(regra).toBeDefined();
    expect(regra?.context).toBeTruthy();
    const historico = await getTestPrisma().alertHistory.count({
      where: { alertId: regra?.id },
    });
    expect(historico).toBeGreaterThan(0);
  });

  it('alerta informa a ultima posicao e o horario, sem dizer que o motorista parou', async () => {
    const journey = await getTestPrisma().journey.create({
      data: { driverId, startedAt: new Date(Date.now() - 3600_000), status: 'EM_ANDAMENTO' },
    });
    await getTestPrisma().locationPoint.create({
      data: {
        journeyId: journey.id,
        driverId,
        clientPointId: 'alerta-pt-1',
        sequenceNo: 0,
        latitude: -7.0774,
        longitude: -45.0236,
        accuracyM: 10,
        capturedAt: new Date(Date.now() - 3600_000),
        receivedAt: new Date(Date.now() - 3600_000),
        retainedUntil: new Date(Date.now() + 90 * 86_400_000),
      },
    });

    await request(app.app.getHttpServer())
      .post('/api/alerts/evaluate')
      .set(...authHeader(admin.accessToken))
      .expect(201);

    const alert = await getTestPrisma().alert.findFirst({
      where: { ruleKey: 'DRIVER_LOCATION_STALE' },
    });
    expect(alert).toBeDefined();
    expect(alert?.context).toHaveProperty('lastReceivedAt');
    expect(alert?.context).toHaveProperty('dataAgeSeconds');
    // O alerta informa a idade do dado e NAO afirma que o motorista parou.
    expect(alert?.message).toMatch(/nao significa/i);
  });

  it('ciclo de vida do alerta: aberto -> reconhecido -> resolvido', async () => {
    await createCustomer({ tradeName: 'Alerta Ciclo', latitude: null, longitude: null });
    await request(app.app.getHttpServer())
      .post('/api/alerts/evaluate')
      .set(...authHeader(admin.accessToken))
      .expect(201);

    const alert = await getTestPrisma().alert.findFirstOrThrow({
      where: { ruleKey: 'CUSTOMER_WITHOUT_COORDS', status: 'ABERTO' },
    });

    await request(app.app.getHttpServer())
      .post(`/api/alerts/${alert.id}/acknowledge`)
      .set(...authHeader(admin.accessToken))
      .expect(201);
    expect((await getTestPrisma().alert.findUniqueOrThrow({ where: { id: alert.id } })).status)
      .toBe('RECONHECIDO');

    await request(app.app.getHttpServer())
      .post(`/api/alerts/${alert.id}/resolve`)
      .set(...authHeader(admin.accessToken))
      .send({ note: 'Cadastro corrigido' })
      .expect(201);
    expect((await getTestPrisma().alert.findUniqueOrThrow({ where: { id: alert.id } })).status)
      .toBe('RESOLVIDO');
  });
});

describe('Sincronizacao offline e conflito de versao de rota', () => {
  let app!: TestApp;
  let admin!: { accessToken: string };
  let driver!: { accessToken: string; driverId: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp();
    await bootstrapTestData();
    admin = await login(app, (await createAdmin()).email);
    const created = await createDriver();
    const session = await login(app, created.email);
    driver = {
      accessToken: session.accessToken,
      driverId: created.driverId as string,
      userId: session.userId,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('reenvio de eventos nao gera contabilizacao duplicada', async () => {
    const customer = await createCustomer({ tradeName: 'Sync Cliente', latitude: -7.0712, longitude: -45.0185 });
    const hoje = new Date().toISOString().slice(0, 10);

    const rota = await request(app.app.getHttpServer())
      .post('/api/routes')
      .set(...authHeader(admin.accessToken))
      .send({ code: 'R-SYNC', name: 'Rota Sync', plannedDate: hoje, driverId: driver.driverId })
      .expect(201);

    await request(app.app.getHttpServer())
      .put(`/api/routes/${rota.body.id}/stops`)
      .set(...authHeader(admin.accessToken))
      .send({ stops: [{ customerId: customer.id }] })
      .expect(200);
    await request(app.app.getHttpServer())
      .post(`/api/routes/${rota.body.id}/publish`)
      .set(...authHeader(admin.accessToken))
      .expect(201);

    const started = new Date().toISOString();
    const journey = await request(app.app.getHttpServer())
      .post('/api/journeys')
      .set(...authHeader(driver.accessToken))
      .send({ routeId: rota.body.id, startedAt: started })
      .expect(201);

    const lote = {
      events: [
        {
          clientEventId: 'evt-sync-1',
          journeyId: journey.body.id,
          sequenceNo: 0,
          type: 'VISIT_ARRIVED',
          capturedAt: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    };

    const primeiro = await request(app.app.getHttpServer())
      .post('/api/sync/events')
      .set(...authHeader(driver.accessToken))
      .send(lote)
      .expect(201);
    expect(primeiro.body.accepted).toEqual(['evt-sync-1']);

    const reenvio = await request(app.app.getHttpServer())
      .post('/api/sync/events')
      .set(...authHeader(driver.accessToken))
      .send(lote)
      .expect(201);
    expect(reenvio.body.duplicates).toEqual(['evt-sync-1']);
    expect(reenvio.body.accepted).toHaveLength(0);

    const total = await getTestPrisma().journeyEvent.count({
      where: { clientEventId: 'evt-sync-1' },
    });
    expect(total).toBe(1);
  });

  it('detecta conflito quando o admin altera a rota durante o offline', async () => {
    const journey = await getTestPrisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
    });
    const route = await getTestPrisma().route.findUniqueOrThrow({
      where: { id: journey.routeId as string },
    });

    // O administrador reorganiza a rota enquanto o app esta offline.
    const novo = await createCustomer({ tradeName: 'Cliente Adicionado Depois', latitude: -7.09, longitude: -45.04 });
    await request(app.app.getHttpServer())
      .put(`/api/routes/${route.id}/stops`)
      .set(...authHeader(admin.accessToken))
      .send({ changeNote: 'Reorganizado durante offline', stops: [{ customerId: novo.id }] })
      .expect(200);

    const sync = await request(app.app.getHttpServer())
      .post('/api/sync/events')
      .set(...authHeader(driver.accessToken))
      .send({
        events: [{
          clientEventId: 'evt-conflito-1',
          journeyId: journey.id,
          sequenceNo: 9,
          type: 'VISIT_SERVICE_STARTED',
          capturedAt: new Date().toISOString(),
        }],
      })
      .expect(201);

    expect(sync.body.routeVersionConflict.detected).toBe(true);
    expect(sync.body.routeVersionConflict.serverVersion).toBeGreaterThan(
      sync.body.routeVersionConflict.deviceVersion as number,
    );

    const conflito = await getTestPrisma().journeyEvent.findFirst({
      where: { type: 'ROUTE_VERSION_CONFLICT' },
    });
    expect(conflito).toBeDefined();
  });

  it('rejeita lote de localizacao com coordenadas invalidas', async () => {
    const journey = await getTestPrisma().journey.findFirstOrThrow({
      where: { driverId: driver.driverId, status: 'EM_ANDAMENTO' },
    });

    const response = await request(app.app.getHttpServer())
      .post('/api/locations/batch')
      .set(...authHeader(driver.accessToken))
      .send({
        journeyId: journey.id,
        points: [
          {
            clientPointId: 'invalido-1',
            sequenceNo: 1,
            latitude: -45.0236,
            longitude: -7.0774,
            accuracyM: 5,
            capturedAt: new Date().toISOString(),
          },
          {
            clientPointId: 'ruim-precisao',
            sequenceNo: 2,
            latitude: -7.0774,
            longitude: -45.0236,
            accuracyM: 900,
            capturedAt: new Date().toISOString(),
          },
        ],
      })
      .expect(201);

    expect(response.body.accepted).toBe(0);
    expect(response.body.rejected).toHaveLength(2);
    expect(response.body.rejected[0].reason).toMatch(/invertidas/i);
    expect(response.body.rejected[1].reason).toMatch(/precisao/i);
  });
});
