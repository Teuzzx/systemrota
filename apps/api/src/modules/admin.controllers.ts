import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { DriverStatus, UserStatus } from '@prisma/client';
import { Permission } from '@rota/shared';
import type { Response } from 'express';
import { CurrentUser, RequirePermissions } from '../auth/guards';
import { UsersService } from './users/users.service';
import { ImportsService } from './imports/imports.service';
import { SettingsService } from './settings/settings.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';

class CreateDriverDto {
  @IsEmail() @MaxLength(180) email!: string;
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(120) homeCity?: string;
  @IsOptional() @IsString() @MaxLength(120) homeNeighborhood?: string;
  @IsOptional() @IsNumber() homeLatitude?: number;
  @IsOptional() @IsNumber() homeLongitude?: number;
  @IsOptional() @IsString() @MaxLength(60) licenseNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsIn(Object.values(DriverStatus)) status?: DriverStatus;
  @IsOptional() @IsString() vehicleId?: string;
}

class UpdateDriverDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsIn(Object.values(DriverStatus)) status?: DriverStatus;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsString() @MaxLength(120) homeCity?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsIn(Object.values(UserStatus)) userStatus?: UserStatus;
}

class CreateAdministratorDto {
  @IsEmail() @MaxLength(180) email!: string;
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
  @IsOptional() @IsString() @MaxLength(120) department?: string;
  @IsOptional() @IsBoolean() canManageSettings?: boolean;
}

class ListDriversQuery {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(Object.values(DriverStatus)) status?: DriverStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

class AuditLogsQuery {
  @IsString() entity!: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
}

@ApiTags('Usuarios e motoristas')
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('users')
  @RequirePermissions(Permission.USERS_READ)
  listUsers() {
    return this.users.listUsers();
  }

  @Get('drivers')
  @RequirePermissions(Permission.DRIVERS_READ)
  listDrivers(@Query() query: ListDriversQuery) {
    return this.users.listDrivers(query);
  }

  @Post('drivers')
  @RequirePermissions(Permission.DRIVERS_WRITE)
  @ApiOperation({ summary: 'Cadastra motorista com usuario, perfil e senha inicial obrigatoria de troca.' })
  createDriver(@Body() dto: CreateDriverDto, @CurrentUser() user: { userId: string }) {
    return this.users.createDriver(dto, user.userId);
  }

  @Patch('drivers/:id')
  @RequirePermissions(Permission.DRIVERS_WRITE)
  updateDriver(@Param('id') id: string, @Body() dto: UpdateDriverDto, @CurrentUser() user: { userId: string }) {
    return this.users.updateDriver(id, dto, user.userId);
  }

  @Post('drivers/:id/active')
  @RequirePermissions(Permission.DRIVERS_WRITE)
  @ApiOperation({ summary: 'Ativa ou desativa a conta. Bloqueia desativacao com jornada aberta.' })
  setActive(
    @Param('id') id: string,
    @Body('active') active: boolean,
    @CurrentUser() user: { userId: string },
  ) {
    return this.users.setDriverActive(id, Boolean(active), user.userId);
  }

  @Post('administrators')
  @RequirePermissions(Permission.USERS_WRITE)
  createAdministrator(@Body() dto: CreateAdministratorDto, @CurrentUser() user: { userId: string }) {
    return this.users.createAdministrator(dto, user.userId);
  }

  @Get('vehicles')
  @RequirePermissions(Permission.DRIVERS_READ)
  vehicles() {
    return this.users.vehicles();
  }

  @Post('vehicles')
  @RequirePermissions(Permission.DRIVERS_WRITE)
  @ApiOperation({ summary: 'Cadastra veiculo com consumo medio e custo por litro (base do planejamento de combustivel).' })
  createVehicle(@Body() body: Record<string, unknown>, @CurrentUser() user: { userId: string }) {
    return this.users.createVehicle(body as never, user.userId);
  }

  @Get('audit-logs')
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'Trilha de auditoria (senhas e tokens nunca sao registrados).' })
  auditLogs(@Query() query: AuditLogsQuery) {
    return this.prisma.auditLog.findMany({
      where: { entity: query.entity, entityId: query.entityId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, query.limit ?? 100),
    });
  }
}

class MappingDto {
  @IsObject({ message: 'Informe o mapeamento coluna -> campo.' })
  mapping!: Record<string, string>;
}
class CommitImportDto {
  @IsOptional() @IsIn(['SKIP', 'UPDATE_FIELDS']) onConflict?: 'SKIP' | 'UPDATE_FIELDS';
  @IsOptional() @IsArray() @IsString({ each: true }) updateFields?: string[];
}

@ApiTags('Importacao de clientes')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('upload')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Etapa 1: upload do arquivo do sistema comercial.',
    description: 'Idempotente por checksum: reenvio do mesmo arquivo reaproveita o lote e nao duplica clientes.',
  })
  upload(
    @UploadedFile() file: { originalname: string; buffer: Buffer; size: number },
    @CurrentUser() user: { userId: string },
  ) {
    if (!file) throw new BadRequestException('Arquivo nao enviado (campo "file").');
    return this.imports.upload(file, user.userId);
  }

  @Post(':id/preview')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  @ApiOperation({ summary: 'Etapas 2-7: colunas, mapeamento, validacao, previa e duplicidades.' })
  preview(@Param('id') id: string, @Body() dto: MappingDto) {
    return this.imports.preview(id, dto.mapping as never);
  }

  @Post(':id/commit')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  @ApiOperation({ summary: 'Etapas 8-10: confirmacao, processamento e relatorio final.' })
  commit(@Param('id') id: string, @Body() dto: CommitImportDto, @CurrentUser() user: { userId: string }) {
    return this.imports.commit(id, dto as never, user.userId);
  }

  @Get()
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  list() {
    return this.imports.list();
  }

  @Get(':id/errors')
  @RequirePermissions(Permission.CUSTOMERS_IMPORT)
  errors(@Param('id') id: string) {
    return this.imports.errors(id);
  }

  @Get('export/customers.csv')
  @RequirePermissions(Permission.CUSTOMERS_EXPORT)
  async exportCsv(@Res() res: Response, @Query('city') city?: string) {
    const csv = await this.imports.exportCsv({ city });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.csv"');
    res.send(csv);
  }

  @Get('export/customers.xlsx')
  @RequirePermissions(Permission.CUSTOMERS_EXPORT)
  async exportXlsx(@Res() res: Response, @Query('city') city?: string) {
    const buffer = await this.imports.exportXlsx({ city });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="clientes.xlsx"');
    res.send(Buffer.from(buffer));
  }
}

class SettingDto {
  @IsString() @MaxLength(120) key!: string;
  value!: unknown;
  @IsOptional() @IsString() @MaxLength(400) description?: string;
}

@ApiTags('Configuracoes')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_READ)
  list() {
    return this.settings.list();
  }

  @Get('thresholds')
  @RequirePermissions(Permission.SETTINGS_READ)
  thresholds() {
    return this.settings.getThresholds();
  }

  @Get('tracking-policy')
  @RequirePermissions(Permission.SETTINGS_READ)
  trackingPolicy() {
    return this.settings.getTrackingPolicy();
  }

  @Put()
  @RequirePermissions(Permission.SETTINGS_WRITE)
  upsert(@Body() dto: SettingDto, @CurrentUser() user: { userId: string }) {
    return this.settings.upsert(dto.key, dto.value, user.userId, dto.description);
  }
}
