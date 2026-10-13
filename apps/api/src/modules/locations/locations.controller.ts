import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Connectivity, JourneyEventType } from '@prisma/client';
import { Permission } from '@rota/shared';
import { CurrentUser, RequirePermissions } from '../../auth/guards';
import { LocationsService, LocationPointInput, SyncEventInput } from './locations.service';

class LocationPointDto implements LocationPointInput {
  @IsString() @MaxLength(80) clientPointId!: string;
  @Type(() => Number) @IsInt() @Min(0) sequenceNo!: number;
  @IsNumber() latitude!: number;
  @IsNumber() longitude!: number;
  @IsNumber() accuracyM!: number;
  @IsISO8601() capturedAt!: string;
  @IsOptional() @IsNumber() speedMps?: number | null;
  @IsOptional() @IsNumber() bearingDeg?: number | null;
  @IsOptional() @IsIn(Object.values(Connectivity)) connectivity?: Connectivity;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) batteryPct?: number | null;
  @IsOptional() @IsBoolean() isSimulated?: boolean;
}

class IngestLocationsDto {
  @IsString() journeyId!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LocationPointDto)
  points!: LocationPointDto[];
}

class SyncEventDto implements SyncEventInput {
  @IsString() @MaxLength(80) clientEventId!: string;
  @IsString() journeyId!: string;
  @Type(() => Number) @IsInt() sequenceNo!: number;
  @IsIn(Object.values(JourneyEventType)) type!: JourneyEventType;
  @IsISO8601() capturedAt!: string;
  @IsOptional() payload?: unknown;
  @IsOptional() @IsNumber() latitude?: number | null;
  @IsOptional() @IsNumber() longitude?: number | null;
  @IsOptional() @IsNumber() accuracyM?: number | null;
}

class SyncEventsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SyncEventDto)
  events!: SyncEventDto[];
}

class PositionsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(86400) staleAfterS?: number;
}

@ApiTags('Localizacao e sincronizacao')
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post('locations/batch')
  @RequirePermissions(Permission.LOCATIONS_READ_OWN)
  @ApiOperation({
    summary: 'Envia lote de pontos de localizacao.',
    description:
      'Idempotente por clientPointId. Reenvio do mesmo ponto e reconhecido como duplicidade e nao contabiliza distancia duas vezes.',
  })
  ingest(
    @Body() dto: IngestLocationsDto,
    @CurrentUser() user: { driverId: string | null },
  ) {
    return this.locations.ingestBatch(requireDriver(user), dto.journeyId, dto.points);
  }

  @Post('sync/events')
  @RequirePermissions(Permission.JOURNEYS_WRITE_OWN)
  @ApiOperation({
    summary: 'Sincroniza eventos operacionais pendentes (offline-first).',
    description:
      'Idempotente por clientEventId. Retorna conflitos de versao de rota quando o admin alterou a rota durante o offline.',
  })
  sync(
    @Body() dto: SyncEventsDto,
    @CurrentUser() user: { driverId: string | null },
  ) {
    return this.locations.ingestEvents(requireDriver(user), dto.events);
  }

  @Get('locations/positions')
  @RequirePermissions(Permission.LOCATIONS_READ_ALL)
  @ApiOperation({
    summary: 'Posicao mais recente por motorista com idade do dado e indicador de desatualizacao.',
  })
  positions(@Query() query: PositionsQuery) {
    return this.locations.latestPositions(query.staleAfterS ?? 300);
  }

  @Get('locations/journeys/:journeyId/track')
  @RequirePermissions(Permission.LOCATIONS_READ_ALL, Permission.LOCATIONS_READ_OWN)
  @ApiOperation({
    summary: 'Trajeto efetivamente registrado da jornada.',
    description: 'Sem pontos registrados, retorna lista vazia com isRealData=false: nada e desenhado por invencao.',
  })
  track(@Param('journeyId') journeyId: string) {
    return this.locations.journeyTrack(journeyId);
  }

  @Post('maintenance/purge-location')
  @RequirePermissions(Permission.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Executa a politica de retencao de localizacao. Restrito a administracao.' })
  purge(@CurrentUser() user: { roles: string[] }) {
    if (!user.roles.includes('ADMINISTRADOR')) {
      throw new ForbiddenException('Apenas administradores executam a manutencao de retencao.');
    }
    return this.locations.purgeExpired();
  }
}

function requireDriver(user: { driverId: string | null }): string {
  if (!user.driverId) {
    throw new ForbiddenException('Usuario autenticado nao possui perfil de motorista.');
  }
  return user.driverId;
}
