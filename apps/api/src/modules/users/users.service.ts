import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus, FuelType, Prisma, RoleKey, UserStatus } from '@prisma/client';
import { hashPassword, checkPasswordPolicy } from '../../auth/password';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cadastro de motorista: cria o usuario, o perfil de motorista e, se
   * informado, o vinculo com o veiculo. Perfil administrativo e separado.
   */
  async createDriver(
    input: {
      email: string; name: string; phone?: string; password?: string;
      code?: string; homeCity?: string; homeNeighborhood?: string;
      homeLatitude?: number | null; homeLongitude?: number | null;
      licenseNumber?: string; notes?: string; status?: DriverStatus;
      vehicleId?: string | null;
    },
    actorId: string | null,
  ) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Ja existe um usuario com este e-mail.');

    const temporaryPassword = input.password ?? `Rota@${Math.floor(Math.random() * 90000 + 10000)}`;
    const policy = checkPasswordPolicy(temporaryPassword);
    if (!policy.ok) throw new BadRequestException(`Senha inicial inválida: ${policy.problems.join(' ')}`);
    const passwordHash = await hashPassword(temporaryPassword);

    const driver = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: input.name.trim(),
          phone: input.phone ?? null,
          passwordHash,
          status: UserStatus.PENDING_ACTIVATION,
          mustChangePassword: true,
          roles: { create: [{ role: { connect: { key: RoleKey.MOTORISTA } } }] },
        },
      });
      const created = await tx.driver.create({
        data: {
          userId: user.id,
          code: input.code ?? null,
          status: input.status ?? DriverStatus.ATIVO,
          homeCity: input.homeCity ?? null,
          homeNeighborhood: input.homeNeighborhood ?? null,
          homeLatitude: input.homeLatitude ?? null,
          homeLongitude: input.homeLongitude ?? null,
          licenseNumber: input.licenseNumber ?? null,
          notes: input.notes ?? null,
        },
      });
      if (input.vehicleId) {
        await tx.vehicleAssignment.create({
          data: { vehicleId: input.vehicleId, driverId: created.id },
        });
      }
      return tx.driver.findUniqueOrThrow({
        where: { id: created.id },
        include: { user: { select: { id: true, email: true, name: true, status: true } } },
      });
    });

    await this.audit.record({
      actorId, action: 'driver.created', entity: 'Driver', entityId: driver.id,
      after: { email, code: driver.code },
    });

    return {
      driver,
      // Senha inicial exibida uma unica vez, somente fora de producao.
      temporaryPassword: this.isProduction() ? null : temporaryPassword,
      mustChangePassword: true,
    };
  }

  async createAdministrator(
    input: { email: string; name: string; phone?: string; password: string; department?: string; canManageSettings?: boolean },
    actorId: string | null,
  ) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new BadRequestException('Ja existe um usuario com este e-mail.');
    }
    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) throw new BadRequestException(`Senha inválida: ${policy.problems.join(' ')}`);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: input.name.trim(),
          phone: input.phone ?? null,
          passwordHash: await hashPassword(input.password),
          status: UserStatus.ACTIVE,
          roles: { create: [{ role: { connect: { key: RoleKey.ADMINISTRADOR } } }] },
        },
      });
      await tx.administrator.create({
        data: {
          userId: created.id,
          department: input.department ?? null,
          canManageSettings: input.canManageSettings ?? false,
        },
      });
      return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: { roles: { include: { role: true } } } });
    });

    await this.audit.record({ actorId, action: 'administrator.created', entity: 'User', entityId: user.id, after: { email } });
    return user;
  }

  async listDrivers(query: { search?: string; status?: DriverStatus; page?: number; pageSize?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.DriverWhereInput = {
      status: query.status,
      user: query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : undefined,
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.driver.count({ where }),
      this.prisma.driver.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true, status: true, lastLoginAt: true } },
          vehicleAssignments: {
            where: { endAt: null },
            include: { vehicle: true },
            take: 1,
          },
          _count: { select: { journeys: true, routes: true } },
        },
      }),
    ]);
    return { total, page, pageSize, data };
  }

  async updateDriver(
    driverId: string,
    input: {
      name?: string; phone?: string; status?: DriverStatus; code?: string;
      homeCity?: string; homeNeighborhood?: string; notes?: string;
      licenseNumber?: string; userStatus?: UserStatus;
    },
    actorId: string | null,
  ) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
    if (!driver) throw new NotFoundException('Motorista nao encontrado.');

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.phone !== undefined || input.userStatus !== undefined) {
        await tx.user.update({
          where: { id: driver.userId },
          data: {
            name: input.name ?? driver.user.name,
            phone: input.phone ?? driver.user.phone,
            status: input.userStatus ?? driver.user.status,
          },
        });
      }
      return tx.driver.update({
        where: { id: driverId },
        data: {
          status: input.status ?? driver.status,
          code: input.code ?? driver.code,
          homeCity: input.homeCity ?? driver.homeCity,
          homeNeighborhood: input.homeNeighborhood ?? driver.homeNeighborhood,
          notes: input.notes ?? driver.notes,
          licenseNumber: input.licenseNumber ?? driver.licenseNumber,
        },
      });
    });

    await this.audit.record({
      actorId, action: 'driver.updated', entity: 'Driver', entityId: driverId,
      before: { status: driver.status }, after: { status: updated.status },
    });
    return updated;
  }

  async setDriverActive(driverId: string, active: boolean, actorId: string | null) {
    const driver = await this.prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
    if (!driver) throw new NotFoundException('Motorista nao encontrado.');
    if (!active) {
      const openJourney = await this.prisma.journey.findFirst({
        where: { driverId, status: { in: ['EM_ANDAMENTO', 'PAUSADA'] } },
      });
      if (openJourney) {
        throw new ForbiddenException(
          'Nao e possivel desativar um motorista com jornada em andamento. Encerre a jornada primeiro.',
        );
      }
    }
    const [updatedDriver] = await this.prisma.$transaction([
      this.prisma.driver.update({
        where: { id: driverId },
        data: { status: active ? DriverStatus.ATIVO : DriverStatus.INATIVO },
      }),
      this.prisma.user.update({
        where: { id: driver.userId },
        data: { status: active ? UserStatus.ACTIVE : UserStatus.BLOCKED },
      }),
    ]);
    await this.audit.record({ actorId, action: active ? 'driver.activated' : 'driver.deactivated', entity: 'Driver', entityId: driverId });
    return updatedDriver;
  }

  async listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, name: true, status: true, lastLoginAt: true,
        roles: { select: { role: { select: { key: true, name: true } } } },
        driver: { select: { id: true, code: true, status: true } },
      },
    });
  }

  async vehicles() {
    return this.prisma.vehicle.findMany({
      orderBy: { plate: 'asc' },
      include: { assignments: { where: { endAt: null }, include: { driver: { include: { user: { select: { name: true } } } } } } },
    });
  }

  async createVehicle(input: {
    plate: string; model?: string; year?: number; fuelType?: FuelType;
    tankCapacityL?: number; avgConsumptionKmpl?: number; fuelCostPerLiter?: number;
    odometerKm?: number;
  }, actorId: string | null) {
    const vehicle = await this.prisma.vehicle.create({
      data: {
        plate: input.plate.trim().toUpperCase(),
        model: input.model ?? null,
        year: input.year ?? null,
        fuelType: input.fuelType ?? null,
        tankCapacityL: input.tankCapacityL ?? null,
        avgConsumptionKmpl: input.avgConsumptionKmpl ?? null,
        fuelCostPerLiter: input.fuelCostPerLiter ?? null,
        odometerKm: input.odometerKm ?? null,
      },
    });
    await this.audit.record({ actorId, action: 'vehicle.created', entity: 'Vehicle', entityId: vehicle.id, after: vehicle });
    return vehicle;
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }
}
