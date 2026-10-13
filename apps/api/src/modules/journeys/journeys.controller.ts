import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OccurrenceType, permissionsForRoles, Permission } from '@rota/shared';
import {
  CurrentUser, RequireAnyPermission, RequirePermissions, type AuthPrincipal,
} from '../../auth/guards';

/**
 * Escopo de leitura de jornada.
 *
 * `null` = sem restricao: o chamador tem `journeys:read:all` (operacao).
 * string = o driverId que a jornada precisa ter: o chamador so tem
 * `journeys:read:own` e por isso so enxerga a propria jornada.
 *
 * Sem isto, a permissao responderia "pode ler jornadas" sem responder "de
 * quem", e qualquer motorista abriria a jornada alheia pelo id.
 */
function readScope(user: AuthPrincipal): string | null {
  const granted = new Set<Permission>([
    ...permissionsForRoles(user.roles),
    ...user.permissions,
  ]);
  if (granted.has(Permission.JOURNEYS_READ_ALL)) return null;
  // Sem driverId associado, nada satisfaz a restricao — melhor que vazar.
  return user.driverId ?? '';
}
import { JourneysService } from './journeys.service';

class StartJourneyDto {
  @IsOptional() @IsString() routeId?: string | null;
  @IsOptional() @IsString() routeVersionId?: string | null;
  @IsOptional() @Type(() => Number) routeVersionAtStart?: number | null;
  @IsISO8601({}, { message: 'startedAt deve ser ISO 8601.' }) startedAt!: string;
}

class VisitEventDto {
  @IsString() journeyId!: string;
  @IsString() customerId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sequence?: number;
  @IsISO8601() capturedAt!: string;
  @IsString() type!: 'ARRIVED' | 'SERVICE_STARTED' | 'SERVICE_ENDED' | 'NOT_DONE';
  @IsOptional() @IsString() notDoneReason?: OccurrenceType;
  @IsOptional() @IsString() @MaxLength(500) notDoneNote?: string;
  @IsOptional() @IsString() source?: 'GPS' | 'MANUAL';
  @IsOptional() @IsString() @MaxLength(500) manualJustification?: string;
  @IsOptional() @Type(() => Number) latitude?: number;
  @IsOptional() @Type(() => Number) longitude?: number;
  @IsOptional() @Type(() => Number) accuracyM?: number;
}

class PauseJourneyDto {
  @IsISO8601() capturedAt!: string;
  @IsOptional() @IsString() reason?: string;
}

class FinishJourneyDto {
  @IsISO8601() capturedAt!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) pauseTotalS?: number;
}

class CancelJourneyDto {
  @IsString() @MaxLength(300) reason!: string;
}

class HistoryQuery {
  @IsOptional() @IsString() driverId?: string;
  @IsOptional() @IsString() routeId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

@ApiTags('Jornadas e visitas')
@Controller()
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Get('journeys/active')
  @RequirePermissions(Permission.JOURNEYS_READ_OWN)
  @ApiOperation({ summary: 'Jornada ativa do motorista autenticado.' })
  async active(@CurrentUser() user: { driverId: string | null }) {
    if (!user.driverId) return null;
    return this.journeys.findActive(user.driverId);
  }

  @Post('journeys')
  @RequirePermissions(Permission.JOURNEYS_WRITE_OWN)
  @ApiOperation({
    summary: 'Inicia jornada.',
    description: 'Uma jornada ativa por motorista. Jornada sem rota e permitida e fica registrada como sem paradas.',
  })
  start(@Body() dto: StartJourneyDto, @CurrentUser() user: { userId: string }) {
    return this.journeys.start(
      { driverUserId: user.userId, routeId: dto.routeId, routeVersionId: dto.routeVersionId, routeVersionAtStart: dto.routeVersionAtStart, startedAt: dto.startedAt },
      {},
    );
  }

  @Post('journeys/:id/pause')
  @RequirePermissions(Permission.JOURNEYS_WRITE_OWN)
  pause(@Param('id') id: string, @Body() dto: PauseJourneyDto, @CurrentUser() user: { driverId: string | null }) {
    return this.journeys.pause(id, requireDriver(user), dto.capturedAt, { reason: dto.reason });
  }

  @Post('journeys/:id/resume')
  @RequirePermissions(Permission.JOURNEYS_WRITE_OWN)
  resume(@Param('id') id: string, @CurrentUser() user: { driverId: string | null }) {
    return this.journeys.resume(id, requireDriver(user));
  }

  @Post('journeys/:id/finish')
  @RequirePermissions(Permission.JOURNEYS_WRITE_OWN)
  @ApiOperation({ summary: 'Encerra a jornada e consolida tempos e indicadores.' })
  finish(@Param('id') id: string, @Body() dto: FinishJourneyDto, @CurrentUser() user: { driverId: string | null }) {
    return this.journeys.finish(id, requireDriver(user), dto.capturedAt, dto.pauseTotalS ?? 0);
  }

  @Post('journeys/:id/cancel')
  @RequirePermissions(Permission.JOURNEYS_WRITE_OWN)
  cancel(@Param('id') id: string, @Body() dto: CancelJourneyDto, @CurrentUser() user: { driverId: string | null }) {
    return this.journeys.cancel(id, requireDriver(user), dto.reason);
  }

  @Get('journeys/:id')
  @RequireAnyPermission(Permission.JOURNEYS_READ_OWN, Permission.JOURNEYS_READ_ALL)
  summary(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.journeys.summary(id, readScope(user));
  }

  @Get('journeys/:id/breakdown')
  @RequireAnyPermission(Permission.JOURNEYS_READ_OWN, Permission.JOURNEYS_READ_ALL)
  @ApiOperation({ summary: 'Linha do tempo com tempos separados e qualidade da medicao.' })
  breakdown(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.journeys.buildBreakdown(id, readScope(user));
  }

  @Get('journeys/:id/forecast')
  @RequireAnyPermission(Permission.JOURNEYS_READ_OWN, Permission.JOURNEYS_READ_ALL)
  @ApiOperation({ summary: 'Previsao de conclusao (estimativa com nivel de confianca).' })
  forecast(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.journeys.forecast(id, 900, readScope(user));
  }

  @Get('journeys')
  @RequirePermissions(Permission.JOURNEYS_READ_ALL)
  @ApiOperation({ summary: 'Historico de jornadas filtrado.' })
  history(@Query() query: HistoryQuery) {
    return this.journeys.history({
      driverId: query.driverId,
      routeId: query.routeId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Post('visits/events')
  @RequirePermissions(Permission.VISITS_WRITE_OWN)
  @ApiOperation({
    summary: 'Registra chegada, inicio/fim de atendimento ou visita nao realizada.',
    description: 'Chegada e inicio de atendimento sao eventos distintos. Reenvio do mesmo evento e reconhecido.',
  })
  visitEvent(@Body() dto: VisitEventDto, @CurrentUser() user: { userId: string }) {
    return this.journeys.recordVisitEvent(
      {
        journeyId: dto.journeyId,
        customerId: dto.customerId,
        sequence: dto.sequence,
        capturedAt: dto.capturedAt,
        type: dto.type,
        notDoneReason: dto.notDoneReason ?? null,
        notDoneNote: dto.notDoneNote,
        source: dto.source,
        manualJustification: dto.manualJustification,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracyM: dto.accuracyM,
      },
      user.userId,
    );
  }
}

function requireDriver(user: { driverId: string | null }): string {
  if (!user.driverId) {
    throw new ForbiddenException('Usuario autenticado nao possui perfil de motorista.');
  }
  return user.driverId;
}
