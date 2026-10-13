import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerStatus, GeocodeStatus, Prisma } from '@prisma/client';
import { haversineDistanceM, validateCoordinate } from '@rota/shared';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';

export interface CustomerInput {
  externalId?: string | null;
  sourceSystem?: string;
  tradeName: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  neighborhood?: string | null;
  city: string;
  state?: string;
  zipCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status?: CustomerStatus;
  notes?: string | null;
  openingHours?: string | null;
  defaultServiceS?: number | null;
  priority?: number;
  isDemo?: boolean;
}

export interface CustomerListQuery {
  search?: string;
  city?: string;
  neighborhood?: string;
  status?: CustomerStatus;
  geocodeStatus?: GeocodeStatus;
  page?: number;
  pageSize?: number;
  sort?: 'tradeName' | 'lastVisitAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface GeoSearchQuery {
  latitude: number;
  longitude: number;
  radiusM: number;
  limit: number;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Classifica coordenadas sem inventar valor.
   * Sem coordenada -> AUSENTE (cliente entra na fila de correcao geografica).
   * Coordenada fora do Brasil -> PENDENTE (pode ser operacao futura).
   */
  static classifyCoordinates(latitude?: number | null, longitude?: number | null) {
    const validation = validateCoordinate(latitude, longitude);
    return {
      status: validation.status as GeocodeStatus,
      reason: validation.reason ?? null,
      valid: validation.valid,
    };
  }

  async create(input: CustomerInput, actorId: string | null) {
    const geo = CustomersService.classifyCoordinates(input.latitude, input.longitude);
    const data = this.buildData(input, geo.status, null);
    const created = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data });
      await this.syncLocationColumn(tx, customer.id, input.latitude, input.longitude, geo.valid);
      return tx.customer.findUniqueOrThrow({ where: { id: customer.id } });
    });
    await this.audit.record({
      actorId, action: 'customer.created', entity: 'Customer', entityId: created.id, after: created,
    });
    return created;
  }

  async update(id: string, input: Partial<CustomerInput>, actorId: string | null) {
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Cliente nao encontrado.');

    const touchesGeo =
      input.latitude !== undefined || input.longitude !== undefined;
    const geo = touchesGeo
      ? CustomersService.classifyCoordinates(
          input.latitude !== undefined ? input.latitude : existing.latitude,
          input.longitude !== undefined ? input.longitude : existing.longitude,
        )
      : null;

    const data: Prisma.CustomerUpdateInput = {};
    if (input.tradeName !== undefined) data.tradeName = input.tradeName.trim();
    if (input.contactName !== undefined) data.contactName = input.contactName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email;
    if (input.addressLine !== undefined) data.addressLine = input.addressLine;
    if (input.neighborhood !== undefined) data.neighborhood = input.neighborhood;
    if (input.city !== undefined) data.city = input.city.trim();
    if (input.state !== undefined) data.state = input.state.toUpperCase().slice(0, 2);
    if (input.zipCode !== undefined) data.zipCode = input.zipCode;
    if (input.status !== undefined) data.status = input.status;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.openingHours !== undefined) data.openingHours = input.openingHours;
    if (input.defaultServiceS !== undefined) data.defaultServiceS = input.defaultServiceS;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.externalId !== undefined) data.externalId = input.externalId;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (geo) data.geocodeStatus = geo.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data });
      if (touchesGeo && geo) {
        const lat = input.latitude !== undefined ? input.latitude : existing.latitude;
        const lng = input.longitude !== undefined ? input.longitude : existing.longitude;
        await this.syncLocationColumn(tx, id, lat, lng, geo.valid);
      }
      return tx.customer.findUniqueOrThrow({ where: { id } });
    });
    await this.audit.record({
      actorId, action: 'customer.updated', entity: 'Customer', entityId: id,
      before: { tradeName: existing.tradeName, geocodeStatus: existing.geocodeStatus },
      after: { tradeName: updated.tradeName, geocodeStatus: updated.geocodeStatus },
    });
    return updated;
  }

  async findById(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        visits: {
          orderBy: { arrivedAt: 'desc' },
          take: 10,
          include: { journey: { select: { id: true, startedAt: true, endedAt: true } } },
        },
      },
    });
    if (!customer) throw new NotFoundException('Cliente nao encontrado.');
    return customer;
  }

  async list(query: CustomerListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.CustomerWhereInput = {
      status: query.status,
      geocodeStatus: query.geocodeStatus,
      city: query.city ? { equals: query.city, mode: 'insensitive' } : undefined,
      neighborhood: query.neighborhood ? { equals: query.neighborhood, mode: 'insensitive' } : undefined,
      OR: query.search
        ? [
            { tradeName: { contains: query.search, mode: 'insensitive' } },
            { externalId: { contains: query.search, mode: 'insensitive' } },
            { contactName: { contains: query.search, mode: 'insensitive' } },
            { addressLine: { contains: query.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { [query.sort ?? 'tradeName']: query.order ?? 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, pages: Math.ceil(total / pageSize), data };
  }

  /**
   * Busca geospatial real usando PostGIS (ST_DWithin sobre indice GiST).
   * Nao usa distancia em linha reta em memoria: usa o banco com indice.
   */
  async findNearby(query: GeoSearchQuery) {
    const limit = Math.min(500, Math.max(1, query.limit ?? 50));
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; tradeName: string; city: string; neighborhood: string | null; distanceM: number }>
    >`
      SELECT c."id", c."tradeName", c."city", c."neighborhood",
             ST_Distance(
               c."location",
               ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)::geography
             ) AS "distanceM"
        FROM "customers" c
       WHERE c."location" IS NOT NULL
         AND c."status" = 'ATIVO'
         AND ST_DWithin(
               c."location",
               ST_SetSRID(ST_MakePoint(${query.longitude}, ${query.latitude}), 4326)::geography,
               ${query.radiusM}
             )
       ORDER BY "distanceM" ASC
       LIMIT ${limit}
    `;
    return rows.map((row) => ({ ...row, distanceM: Math.round(Number(row.distanceM)) }));
  }

  /** Clientes sem coordenada confiavel: fila de correcao geografica. */
  async listPendingGeocode(limit = 200) {
    return this.prisma.customer.findMany({
      where: { geocodeStatus: { in: [GeocodeStatus.AUSENTE, GeocodeStatus.INVALIDO, GeocodeStatus.PENDENTE] } },
      orderBy: [{ city: 'asc' }, { tradeName: 'asc' }],
      take: Math.min(500, limit),
    });
  }

  /**
   * Detecta possiveis duplicados por similaridade de nome + proximidade.
   * Heuristica: mesmo nome normalizado a < 150 m. Resultado e SUGESTAO para o
   * administrador decidir; o sistema nao apaga nem funde sozinho.
   */
  async findPossibleDuplicates(limit = 100) {
    const candidates = await this.prisma.customer.findMany({
      where: { status: { not: CustomerStatus.INATIVO } },
      select: { id: true, tradeName: true, city: true, neighborhood: true, latitude: true, longitude: true, externalId: true },
      take: 2000,
    });
    const buckets = new Map<string, typeof candidates>();
    for (const customer of candidates) {
      const key = normalizeName(customer.tradeName);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(customer);
      else buckets.set(key, [customer]);
    }
    const groups: Array<{ reason: string; customers: Array<{ id: string; tradeName: string; city: string; externalId: string | null; distanceM: number | null }> }> = [];
    for (const bucket of buckets.values()) {
      if (bucket.length < 2) continue;
      for (let i = 0; i < bucket.length; i += 1) {
        for (let k = i + 1; k < bucket.length; k += 1) {
          const a = bucket[i]!;
          const b = bucket[k]!;
          let distanceM: number | null = null;
          if (
            a.latitude != null && a.longitude != null &&
            b.latitude != null && b.longitude != null
          ) {
            distanceM = Math.round(
              haversineDistanceM(
                { latitude: a.latitude, longitude: a.longitude },
                { latitude: b.latitude, longitude: b.longitude },
              ),
            );
          }
          const sameExternal = Boolean(a.externalId && b.externalId && a.externalId === b.externalId);
          if (sameExternal || (distanceM !== null && distanceM <= 150)) {
            groups.push({
              reason: sameExternal
                ? 'Mesmo identificador do sistema comercial'
                : `Mesmo nome normalizado a ${distanceM} m`,
              customers: [
                { id: a.id, tradeName: a.tradeName, city: a.city, externalId: a.externalId, distanceM },
                { id: b.id, tradeName: b.tradeName, city: b.city, externalId: b.externalId, distanceM },
              ],
            });
          }
        }
      }
      if (groups.length >= limit) break;
    }
    return groups.slice(0, limit);
  }

  async distinctCities() {
    const rows = await this.prisma.customer.groupBy({
      by: ['city'],
      _count: { _all: true },
      orderBy: { city: 'asc' },
    });
    return rows.map((r) => ({ city: r.city, count: r._count._all }));
  }

  async distinctNeighborhoods(city?: string) {
    const rows = await this.prisma.customer.groupBy({
      by: ['neighborhood'],
      where: city ? { city } : { neighborhood: { not: null } },
      _count: { _all: true },
      orderBy: { neighborhood: 'asc' },
    });
    return rows
      .filter((r) => r.neighborhood !== null)
      .map((r) => ({ neighborhood: r.neighborhood as string, count: r._count._all }));
  }

  async softDelete(id: string, actorId: string | null) {
    const existing = await this.prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Cliente nao encontrado.');
    const updated = await this.prisma.customer.update({
      where: { id },
      data: { status: CustomerStatus.INATIVO },
    });
    await this.audit.record({
      actorId, action: 'customer.deactivated', entity: 'Customer', entityId: id,
      before: { status: existing.status }, after: { status: updated.status },
    });
    return updated;
  }

  /** Prepara o INSERT/UPDATE reaproveitando a regra de classificacao. */
  buildData(input: CustomerInput, geocodeStatus: GeocodeStatus, importBatchId: string | null): Prisma.CustomerCreateInput {
    const tradeName = input.tradeName?.trim();
    if (!tradeName) throw new BadRequestException('Nome do estabelecimento e obrigatorio.');
    if (!input.city?.trim()) throw new BadRequestException('Cidade e obrigatoria.');
    return {
      externalId: input.externalId ?? null,
      sourceSystem: input.sourceSystem ?? 'MANUAL',
      tradeName,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      addressLine: input.addressLine ?? null,
      neighborhood: input.neighborhood ?? null,
      city: input.city.trim(),
      state: (input.state ?? 'PI').toUpperCase().slice(0, 2),
      zipCode: input.zipCode ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      geocodeStatus,
      status: input.status ?? CustomerStatus.ATIVO,
      notes: input.notes ?? null,
      openingHours: input.openingHours ?? null,
      defaultServiceS: input.defaultServiceS ?? null,
      priority: input.priority ?? 5,
      isDemo: input.isDemo ?? false,
      importBatch: importBatchId ? { connect: { id: importBatchId } } : undefined,
    };
  }

  /**
   * Mantem a coluna geography em sincronia com lat/lng.
   * A coluna e gerenciada fora do Prisma (tipo nao suportado), entao o
   * INSERT/UPDATE precisa popular o ST_MakePoint explicitamente.
   */
  private async syncLocationColumn(
    tx: Prisma.TransactionClient,
    id: string,
    latitude: number | null | undefined,
    longitude: number | null | undefined,
    valid: boolean,
  ): Promise<void> {
    if (valid && latitude != null && longitude != null) {
      await tx.$executeRaw`
        UPDATE "customers"
           SET "location" = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
         WHERE "id" = ${id}::uuid
      `;
    } else {
      await tx.$executeRaw`
        UPDATE "customers" SET "location" = NULL WHERE "id" = ${id}::uuid
      `;
    }
  }
}

export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
