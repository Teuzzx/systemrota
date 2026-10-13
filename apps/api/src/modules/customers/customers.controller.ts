import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CustomerStatus, GeocodeStatus } from '@prisma/client';
import { Permission } from '@rota/shared';
import { CurrentUser, RequirePermissions } from '../../auth/guards';
import { CustomersService } from './customers.service';

export class CreateCustomerDto {
  @IsOptional() @IsString() @MaxLength(80) externalId?: string;
  @IsOptional() @IsString() @MaxLength(40) sourceSystem?: string;
  @IsString() @MinLength(2) @MaxLength(200) tradeName!: string;
  @IsOptional() @IsString() @MaxLength(160) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(180) email?: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(120) neighborhood?: string;
  @IsString() @MinLength(2) @MaxLength(120) city!: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(12) zipCode?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsIn(Object.values(CustomerStatus)) status?: CustomerStatus;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(255) openingHours?: string;
  @IsOptional() @IsInt() @Min(30) @Max(14400) defaultServiceS?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsBoolean() isDemo?: boolean;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(200) tradeName?: string;
  @IsOptional() @IsString() @MaxLength(160) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(180) email?: string;
  @IsOptional() @IsString() @MaxLength(255) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(120) neighborhood?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(2) state?: string;
  @IsOptional() @IsString() @MaxLength(12) zipCode?: string;
  @IsOptional() @IsNumber() latitude?: number;
  @IsOptional() @IsNumber() longitude?: number;
  @IsOptional() @IsIn(Object.values(CustomerStatus)) status?: CustomerStatus;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsString() @MaxLength(255) openingHours?: string;
  @IsOptional() @IsInt() @Min(30) @Max(14400) defaultServiceS?: number;
  @IsOptional() @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsString() @MaxLength(80) externalId?: string;
}

export class ListCustomersQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() neighborhood?: string;
  @IsOptional() @IsIn(Object.values(CustomerStatus)) status?: CustomerStatus;
  @IsOptional() @IsIn(Object.values(GeocodeStatus)) geocodeStatus?: GeocodeStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
  @IsOptional() @IsIn(['tradeName', 'lastVisitAt', 'createdAt']) sort?: 'tradeName' | 'lastVisitAt' | 'createdAt';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
}

@ApiTags('Clientes')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Lista clientes com filtros e paginacao.' })
  list(@Query() query: ListCustomersQuery) {
    return this.customers.list({
      search: query.search,
      city: query.city,
      neighborhood: query.neighborhood,
      status: query.status,
      geocodeStatus: query.geocodeStatus,
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
      order: query.order,
    });
  }

  @Get('nearby')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({
    summary: 'Clientes dentro de um raio (PostGIS ST_DWithin).',
    description: 'Consulta espacial real sobre indice GiST, nao distancia em linha reta em memoria.',
  })
  nearby(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('radiusM') radiusM = '2000',
    @Query('limit') limit = '50',
  ) {
    return this.customers.findNearby({
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusM: Number(radiusM),
      limit: Number(limit),
    });
  }

  @Get('pending-geocode')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Clientes pendentes de correcao geografica.' })
  pendingGeocode() {
    return this.customers.listPendingGeocode();
  }

  @Get('duplicates')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({
    summary: 'Sugestoes de cadastro duplicado.',
    description: 'Apenas sugestoes: o sistema nunca funde ou apaga cadastro automaticamente.',
  })
  duplicates() {
    return this.customers.findPossibleDuplicates();
  }

  @Get('facets/cities')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  cities() {
    return this.customers.distinctCities();
  }

  @Get('facets/neighborhoods')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  neighborhoods(@Query('city') city?: string) {
    return this.customers.distinctNeighborhoods(city);
  }

  @Get(':id')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  @ApiOperation({ summary: 'Detalhe do cliente com historico recente de visitas.' })
  findOne(@Param('id') id: string) {
    return this.customers.findById(id);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Cadastra cliente. Coordenadas sao validadas automaticamente.' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: { userId: string }) {
    return this.customers.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Atualiza cliente.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.customers.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions(Permission.CUSTOMERS_WRITE)
  @ApiOperation({ summary: 'Desativa cliente (exclusao logica preserva o historico).' })
  remove(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.customers.softDelete(id, user.userId);
  }
}
