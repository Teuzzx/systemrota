/**
 * Carga de DEMONSTRACAO.
 *
 * REGRA INEGOCIAVEL: tudo que este script cria e DEMO.
 *  - toda linha recebe isDemo = true;
 *  - identificadores usam o namespace DEMO-/prefixo identificavel;
 *  - o script recusa rodar em producao;
 *  - a API expoe o campo isDemo e a web exibe aviso permanente.
 *
 * Nenhum destes dados representa a operacao real.
 */
import { PrismaClient, DriverStatus, CustomerStatus, RoleKey } from '@prisma/client';
import { hashPassword } from '../auth/password';
import { loadConfig } from '../config/configuration';
import { startPglite, stopPglite, defaultDataDir, isPgliteRunning } from './pglite';
import { seedCore } from './seed-core';
import { CustomersService } from '../modules/customers/customers.service';

const DEMO_EMAIL_DOMAIN = 'demo.rota.invalid'; // .invalid nunca resolve: e obviamente demo

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.isProduction) {
    throw new Error('Seed de demonstracao bloqueado em producao (NODE_ENV=production).');
  }
  if (!config.operations.allowDemoSeed) {
    throw new Error('Seed de demonstracao bloqueado: defina ALLOW_DEMO_SEED=true explicitamente.');
  }

  if (config.db.driver === 'pglite') {
    // Reaproveita o banco local ja em execucao (npm run db:pglite) em vez de
    // tentar abrir a mesma porta.
    if (await isPgliteRunning(config.db.pglitePort)) {
      console.log(`> Reaproveitando o banco local ja ativo na porta ${config.db.pglitePort}.`);
    } else {
      await startPglite({
        port: config.db.pglitePort,
        dataDir: config.db.pgliteDataDir ?? defaultDataDir(),
      });
    }
  }

  const prisma = new PrismaClient({ datasources: { db: { url: config.db.url } } });
  await prisma.$connect();

  console.log('> Aplicando carga base (perfis, permissoes, parametros)...');
  await seedCore(prisma);

  console.log('> Verificando marcador de dados demo no banco...');
  const marker = await prisma.systemSetting.upsert({
    where: { key: 'dataset.demo' },
    create: {
      key: 'dataset.demo',
      value: { isDemo: true, createdAt: new Date().toISOString(), note: 'Dados de demonstracao. Nao representam a operacao real.' } as never,
      description: 'Marca este banco como banco de demonstracao.',
    },
    update: {},
  });
  const value = marker.value as { isDemo?: boolean };
  if (value.isDemo !== true) {
    throw new Error('Banco ja possui dados reais (dataset.demo.isDemo != true). Seed abortado.');
  }

  // ---------------------------------------------------------------- usuarios
  console.log('> Criando usuarios de demonstracao...');
  const demoPassword = await hashPassword('RotaDemo#2026');

  const admin = await prisma.user.upsert({
    where: { email: `admin@${DEMO_EMAIL_DOMAIN}` },
    create: {
      email: `admin@${DEMO_EMAIL_DOMAIN}`,
      name: 'Administrador (DEMO)',
      passwordHash: demoPassword,
      status: 'ACTIVE',
      mustChangePassword: false,
      isDemo: true,
      roles: { create: [{ role: { connect: { key: RoleKey.ADMINISTRADOR } } }] },
    },
    update: { isDemo: true },
    include: { roles: { include: { role: true } } },
  });
  await prisma.administrator.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id, department: 'Operacao comercial (DEMO)', isDemo: true },
    update: { isDemo: true },
  });

  const driverUser = await prisma.user.upsert({
    where: { email: `motorista@${DEMO_EMAIL_DOMAIN}` },
    create: {
      email: `motorista@${DEMO_EMAIL_DOMAIN}`,
      name: 'Motorista Demo (DEMO)',
      passwordHash: demoPassword,
      status: 'ACTIVE',
      mustChangePassword: false,
      isDemo: true,
      roles: { create: [{ role: { connect: { key: RoleKey.MOTORISTA } } }] },
    },
    update: { isDemo: true },
  });
  const driver = await prisma.driver.upsert({
    where: { userId: driverUser.id },
    create: {
      userId: driverUser.id,
      code: 'DEMO-MOT-01',
      status: DriverStatus.ATIVO,
      homeCity: 'Picos',
      homeNeighborhood: 'Centro',
      homeLatitude: -7.0774,
      homeLongitude: -45.0236,
      isDemo: true,
      notes: 'Cadastro de demonstracao.',
    },
    update: { isDemo: true },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { plate: 'DEMO-1A23' },
    create: {
      plate: 'DEMO-1A23',
      model: 'Veiculo demo',
      fuelType: 'GASOLINA',
      tankCapacityL: 50,
      avgConsumptionKmpl: 28,
      fuelCostPerLiter: 6.12,
      odometerKm: 0,
      isDemo: true,
    },
    update: { isDemo: true },
  });
  const existingAssignment = await prisma.vehicleAssignment.findFirst({
    where: { driverId: driver.id, endAt: null },
  });
  if (!existingAssignment) {
    await prisma.vehicleAssignment.create({ data: { driverId: driver.id, vehicleId: vehicle.id } });
  }

  // --------------------------------------------------------------- clientes
  console.log('> Criando clientes de demonstracao...');

  const demoCustomers = [
    { tradeName: 'Mercearia Sao Jose (DEMO)', neighborhood: 'Sao Jose', lat: -7.0712, lng: -45.0185 },
    { tradeName: 'Farmacia Central (DEMO)', neighborhood: 'Sao Jose', lat: -7.0731, lng: -45.0201 },
    { tradeName: 'Distribuidora Boa Vista (DEMO)', neighborhood: 'Boa Vista', lat: -7.0830, lng: -45.0120 },
    { tradeName: 'Auto Pecas Picos (DEMO)', neighborhood: 'Centro', lat: -7.0765, lng: -45.0251 },
    { tradeName: 'Padaria Doze (DEMO)', neighborhood: 'Centro', lat: -7.0758, lng: -45.0240 },
    // Cliente SEM coordenada: entra na fila de correcao geografica.
    { tradeName: 'Bar Sem Cadastro (DEMO)', neighborhood: 'Rural', lat: null, lng: null },
  ];

  for (const item of demoCustomers) {
    const existing = await prisma.customer.findFirst({ where: { tradeName: item.tradeName } });
    if (existing) continue;
    const geo = CustomersService.classifyCoordinates(item.lat, item.lng);
    const created = await prisma.customer.create({
      data: {
        externalId: `DEMO-${item.tradeName.slice(0, 12).replace(/\W/g, '')}`,
        sourceSystem: 'DEMO',
        tradeName: item.tradeName,
        city: 'Picos',
        state: 'PI',
        neighborhood: item.neighborhood,
        addressLine: 'Endereco de demonstracao',
        latitude: item.lat,
        longitude: item.lng,
        geocodeStatus: geo.status,
        status: CustomerStatus.ATIVO,
        priority: 5,
        defaultServiceS: 900,
        isDemo: true,
      },
    });
    if (geo.valid && item.lat !== null && item.lng !== null) {
      await prisma.$executeRaw`
        UPDATE "customers"
           SET "location" = ST_SetSRID(ST_MakePoint(${item.lng}, ${item.lat}), 4326)::geography
         WHERE "id" = ${created.id}::uuid
      `;
    }
  }

  // ------------------------------------------------------------------ rotas
  console.log('> Criando rotas de demonstracao...');
  for (const code of ['R1', 'R2', 'R3', 'R4']) {
    const existing = await prisma.route.findUnique({ where: { code } });
    if (existing) continue;
    const plannedDate = new Date();
    plannedDate.setHours(0, 0, 0, 0);
    await prisma.route.create({
      data: {
        code,
        name: `Rota ${code} (DEMO)`,
        description: 'Rota inicial de demonstracao. O codigo e registro administravel, nao constante.',
        region: 'Picos e regiao',
        cities: ['Picos'],
        neighborhoods: ['Centro', 'Sao Jose', 'Boa Vista'],
        plannedDate,
        driverId: code === 'R1' ? driver.id : null,
        status: code === 'R1' ? 'ATRIBUIDA' : 'PLANEJADA',
        currentVersion: 1,
        isDemo: true,
        versions: {
          create: { version: 1, status: 'PLANEJADA', totalStops: 0, changeNote: 'Criacao (DEMO)', diff: {} },
        },
      },
    });
  }

  const counts = {
    customers: await prisma.customer.count({ where: { isDemo: true } }),
    routes: await prisma.route.count({ where: { isDemo: true } }),
    drivers: await prisma.driver.count({ where: { isDemo: true } }),
  };

  console.log('');
  console.log('=========================================================');
  console.log(' CARGA DE DEMONSTRACAO APLICADA (todos os dados sao DEMO)');
  console.log('=========================================================');
  console.log(` Clientes demo: ${counts.customers}`);
  console.log(` Rotas demo:    ${counts.routes}`);
  console.log(` Motoristas:    ${counts.drivers}`);
  console.log(` Login admin:   admin@${DEMO_EMAIL_DOMAIN}`);
  console.log(` Login motorista: motorista@${DEMO_EMAIL_DOMAIN}`);
  console.log(' Senha (ambos): RotaDemo#2026');
  console.log(' ATENCAO: estes dados NAO representam a operacao real.');
  console.log('=========================================================');

  await prisma.$disconnect();
  if (config.db.driver === 'pglite') await stopPglite();
}

main().catch((error) => {
  console.error('Falha ao aplicar seed de demonstracao:', error);
  process.exit(1);
});
