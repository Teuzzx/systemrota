import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AlertSeverity, AlertStatus } from '@prisma/client';
import { Permission } from '@rota/shared';
import { CurrentUser, RequirePermissions } from '../auth/guards';
import { AlertsService } from './alerts/alerts.service';
import { OptimizationService } from './optimization/optimization.service';
import { DashboardService } from './dashboard/dashboard.service';
import { ReportsService } from './reports/reports.service';

class SuggestRouteDto {
  @IsOptional() @IsString() routeId?: string | null;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) customerIds!: string[];
  @IsOptional() @IsNumber() originLatitude?: number;
  @IsOptional() @IsNumber() originLongitude?: number;
  @IsOptional() @IsNumber() destinationLatitude?: number;
  @IsOptional() @IsNumber() destinationLongitude?: number;
  @IsOptional() @IsBoolean() returnToBase?: boolean;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() driverId?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) maxStops?: number;
}

class ApplySuggestionDto {
  @IsOptional() @IsBoolean() includeExcluded?: boolean;
  @IsOptional() @IsString() @MaxLength(500) changeNote?: string;
}

@ApiTags('Otimizacao')
@Controller('optimization')
export class OptimizationController {
  constructor(private readonly optimization: OptimizationService) {}

  @Post('suggest')
  @RequirePermissions(Permission.ROUTES_OPTIMIZE)
  @ApiOperation({
    summary: 'Gera sugestao de sequencia de visitas.',
    description:
      'Retorna sequencia, distancia e duracao estimadas, clientes incluidos, clientes EXCLUIDOS com motivo, restricoes e diferenca em relacao a sequencia anterior. E uma sugestao, nao garantia.',
  })
  suggest(@Body() dto: SuggestRouteDto, @CurrentUser() user: { userId: string }) {
    return this.optimization.suggest(dto, user.userId);
  }

  @Post('runs/:runId/apply/:routeId')
  @RequirePermissions(Permission.ROUTES_WRITE)
  @ApiOperation({ summary: 'Aplica a sugestao na rota, criando nova versao de planejamento.' })
  apply(
    @Param('runId') runId: string,
    @Param('routeId') routeId: string,
    @Body() dto: ApplySuggestionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.optimization.applyToRoute(routeId, runId, dto, user.userId);
  }

  @Get('runs')
  @RequirePermissions(Permission.ROUTES_READ)
  runs(@Query('routeId') routeId?: string) {
    return this.optimization.listRuns(routeId);
  }

  @Get('runs/:runId')
  @RequirePermissions(Permission.ROUTES_READ)
  run(@Param('runId') runId: string) {
    return this.optimization.getRun(runId);
  }
}

class AlertNoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class AlertListQuery {
  @IsOptional() @IsIn(Object.values(AlertStatus)) status?: AlertStatus;
  @IsOptional() @IsIn(Object.values(AlertSeverity)) severity?: AlertSeverity;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

class SilenceDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10080) minutes!: number;
}

@ApiTags('Alertas')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @RequirePermissions(Permission.ALERTS_READ)
  list(@Query() query: AlertListQuery) {
    return this.alerts.list({
      status: query.status,
      severity: query.severity,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('stats')
  @RequirePermissions(Permission.ALERTS_READ)
  stats() {
    return this.alerts.stats();
  }

  @Post('evaluate')
  @RequirePermissions(Permission.ALERTS_READ)
  @ApiOperation({ summary: 'Executa a avaliacao das regras agora. Idempotente por deduplicacao.' })
  evaluate() {
    return this.alerts.evaluate();
  }

  @Post(':id/acknowledge')
  @RequirePermissions(Permission.ALERTS_MANAGE)
  acknowledge(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.alerts.acknowledge(id, user.userId);
  }

  @Post(':id/resolve')
  @RequirePermissions(Permission.ALERTS_MANAGE)
  resolve(@Param('id') id: string, @Body() dto: AlertNoteDto, @CurrentUser() user: { userId: string }) {
    return this.alerts.resolve(id, user.userId, dto.note);
  }

  @Post(':id/silence')
  @RequirePermissions(Permission.ALERTS_MANAGE)
  silence(@Param('id') id: string, @Body() dto: SilenceDto, @CurrentUser() user: { userId: string }) {
    return this.alerts.silence(id, user.userId, dto.minutes);
  }
}

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @RequirePermissions(Permission.JOURNEYS_READ_ALL)
  @ApiOperation({ summary: 'Indicadores operacionais calculados a partir dos dados persistidos.' })
  overview(
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('driverId') driverId?: string,
    @Query('routeId') routeId?: string,
    @Query('city') city?: string,
    @Query('neighborhood') neighborhood?: string,
  ) {
    return this.dashboard.overview({ date, from, to, driverId, routeId, city, neighborhood });
  }

  @Get('drivers/:driverId')
  @RequirePermissions(Permission.JOURNEYS_READ_ALL)
  driverDetail(@Param('driverId') driverId: string) {
    return this.dashboard.driverDetail(driverId);
  }
}

@ApiTags('Relatorios')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('journeys')
  @RequirePermissions(Permission.REPORTS_READ)
  journeys(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('driverId') driverId?: string,
    @Query('routeId') routeId?: string,
    @Query('city') city?: string,
  ) {
    return this.reports.journeys({ from, to, driverId, routeId, city });
  }

  @Get('visits')
  @RequirePermissions(Permission.REPORTS_READ)
  visits(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('driverId') driverId?: string,
    @Query('routeId') routeId?: string,
    @Query('city') city?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.reports.visits({ from, to, driverId, routeId, city, customerId });
  }

  @Get('drivers')
  @RequirePermissions(Permission.REPORTS_READ)
  driverPerformance(@Query('from') from?: string, @Query('to') to?: string, @Query('routeId') routeId?: string) {
    return this.reports.driverPerformance({ from, to, routeId });
  }

  @Get('fuel')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({ summary: 'Estimativa de combustivel. Sempre rotulada como estimativa.' })
  fuel(@Query('from') from?: string, @Query('to') to?: string, @Query('driverId') driverId?: string) {
    return this.reports.fuel({ from, to, driverId });
  }

  @Get('journeys.csv')
  @RequirePermissions(Permission.REPORTS_READ)
  async csv(@Query('from') from?: string, @Query('to') to?: string, @Query('driverId') driverId?: string) {
    return this.reports.exportCsv({ from, to, driverId });
  }

  @Get('journeys.xlsx')
  @RequirePermissions(Permission.REPORTS_READ)
  async xlsx(@Query('from') from?: string, @Query('to') to?: string, @Query('driverId') driverId?: string) {
    return this.reports.exportXlsx({ from, to, driverId });
  }
}
