/**
 * Fixtures de teste.
 *
 * Todos os registros criados aqui sao marcados como DEMO e usam o namespace
 * `test.rota.invalid`, para nunca se confundirem com dados de producao.
 *
 * IMPORTANTE: existe UM unico PrismaClient em toda a suite. O PGlite em modo
 * de verificacao aceita uma unica conexao por vez (limitacao do servidor de
 * socket do PGlite; o PostgreSQL de producao nao tem esse limite). Por isso os
 * testes reutilizam o mesmo cliente da aplicacao em vez de abrir o proprio.
 */
import { PrismaClient } from '@prisma/client';
import { RoleKey } from '@rota/shared';
import { hashPassword } from '../src/auth/password';
import { seedCore } from '../src/db/seed-core';

export const TEST_PASSWORD = 'Teste@Seguro2026';

let client: PrismaClient | null = null;

export function setTestPrisma(instance: PrismaClient): void {
  client = instance;
}

export function getTestPrisma(): PrismaClient {
  if (!client) {
    throw new Error(
      'Prisma de teste nao inicializado. Chame createTestApp() e depois setTestPrisma(app.get(PrismaService)).',
    );
  }
  return client;
}

export async function resetDatabase(): Promise<void> {
  const prisma = getTestPrisma();
  // Ordem inversa das dependencias para respeitar as FKs.
  await prisma.alertHistory.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.journeyEvent.deleteMany();
  await prisma.occurrence.deleteMany();
  await prisma.locationPoint.deleteMany();
  await prisma.locationHourAggregate.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.journey.deleteMany();
  await prisma.routeStop.deleteMany();
  await prisma.routeVersion.deleteMany();
  await prisma.routeOptimizationRun.deleteMany();
  await prisma.route.deleteMany();
  await prisma.customerImportError.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.customerImport.deleteMany();
  await prisma.vehicleAssignment.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.supervisorScope.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.administrator.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
}

export async function bootstrapTestData(): Promise<void> {
  await resetDatabase();
  await seedCore(getTestPrisma());
}

export async function createAdmin(email = 'admin@test.rota.invalid') {
  const prisma = getTestPrisma();
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Administrador de Teste',
      passwordHash,
      status: 'ACTIVE',
      mustChangePassword: false,
      isDemo: true,
      roles: { create: [{ role: { connect: { key: RoleKey.ADMINISTRADOR } } }] },
    },
    include: { roles: { include: { role: true } } },
  });
  await prisma.administrator.create({ data: { userId: user.id, isDemo: true } });
  return { userId: user.id, driverId: null, email };
}

export async function createDriver(email = `motorista-${Date.now()}@test.rota.invalid`) {
  const prisma = getTestPrisma();
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Motorista de Teste',
      passwordHash,
      status: 'ACTIVE',
      mustChangePassword: false,
      isDemo: true,
      roles: { create: [{ role: { connect: { key: RoleKey.MOTORISTA } } }] },
    },
  });
  const driver = await prisma.driver.create({
    data: {
      userId: user.id,
      code: `TEST-${Date.now().toString().slice(-6)}`,
      status: 'ATIVO',
      homeCity: 'Picos',
      isDemo: true,
    },
  });
  return { userId: user.id, driverId: driver.id, email };
}

export async function createCustomer(input: {
  tradeName: string;
  city?: string;
  neighborhood?: string;
  latitude?: number | null;
  longitude?: number | null;
  externalId?: string | null;
}) {
  const prisma = getTestPrisma();
  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  const valid = latitude !== null && longitude !== null;
  const customer = await prisma.customer.create({
    data: {
      externalId: input.externalId ?? null,
      sourceSystem: input.externalId ? 'LEGACY_IMPORT' : 'MANUAL',
      tradeName: input.tradeName,
      city: input.city ?? 'Picos',
      state: 'PI',
      neighborhood: input.neighborhood ?? 'Centro',
      latitude,
      longitude,
      geocodeStatus: valid ? 'VALIDADO' : 'AUSENTE',
      status: 'ATIVO',
      priority: 5,
      defaultServiceS: 900,
      isDemo: true,
    },
  });
  if (valid && latitude !== null && longitude !== null) {
    await prisma.$executeRaw`
      UPDATE "customers"
         SET "location" = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
       WHERE "id" = ${customer.id}::uuid
    `;
  }
  return prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
}
