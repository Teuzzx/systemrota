import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { RouteStatus } from '@prisma/client';
import { Permission } from '@rota/shared';
import { CurrentUser, RequirePermissions } from '../../auth/guards';
import { RoutesService } from './routes.service';

class CreateRouteDto {
  @IsString() @MinLength(1) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(160) region?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) cities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) neighborhoods?: string[];
  @IsOptional() @IsString() driverId?: string | null;
  @IsString() plannedDate!: string;
  @IsOptional() @IsString() plannedStartAt?: string | null;
  @IsOptional() @IsString() plannedEndAt?: string | null;
  @IsOptional() @IsBoolean() returnToBase?: boolean;
}

class UpdateRouteDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(160) region?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) cities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) neighborhoods?: string[];
  @IsOptional() @IsString() driverId?: string | null;
  @IsOptional() @IsString() plannedDate?: string;
  @IsOptional() @IsString() plannedStartAt?: string | null;
  @IsOptional() @IsString() plannedEndAt?: string | null;
  @IsOptional() @IsBoolean() returnToBase?: boolean;
}

export class RouteStopInputDto {
  @IsString() customerId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sequence?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) priority?: number;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() estServiceS?: number;
  @IsOptional() @Type(() => Number) estTravelFromPrevS?: number;
  @IsOptional() @Type(() => Number) estDistanceFromPrevM?: number;
  @IsOptional() @IsString() timeWindowStart?: string | null;
  @IsOptional() @IsString() timeWindowEnd?: string | null;
  @IsOptional() @IsString() @MaxLength(500) note?: string | null;
}

class SetStopsDto {
  @IsArray() @ArrayNotEmpty() stops!: RouteStopInputDto[];
  @IsOptional() @IsString() @MaxLength(500) changeNote?: string;
}

class ListRoutesQuery {
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(Object.values(RouteStatus)) status?: RouteStatus;
  @IsOptional() @IsString() driverId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

class CancelRouteDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

@ApiTags('Rotas')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  @RequirePermissions(Permission.ROUTES_READ)
  @ApiOperation({ summary: 'Lista rotas com filtros por data, status e motorista.' })
  list(@Query() query: ListRoutesQuery) {
    return this.routes.list(query);
  }

  @Get('assigned')
  @RequirePermissions(Permission.JOURNEYS_READ_OWN, Permission.ROUTES_READ)
  @ApiOperation({ summary: 'Rotas atribuidas a um motorista em uma data (consumo do app).' })
  assigned(@Query('driverId') driverId: string, @Query('date') date?: string) {
    return this.routes.assignedToDriver(driverId, date);
  }

  @Get(':idOrCode')
  @RequirePermissions(Permission.ROUTES_READ)
  @ApiOperation({ summary: 'Detalhe da rota com a versao vigente de planejamento.' })
  findOne(@Param('idOrCode') idOrCode: string) {
    return this.routes.findByIdOrCode(idOrCode);
  }

  @Get(':id/versions')
  @RequirePermissions(Permission.ROUTES_READ)
  versions(@Param('id') id: string) {
    return this.routes.versions(id);
  }

  @Post()
  @RequirePermissions(Permission.ROUTES_WRITE)
  @ApiOperation({ summary: 'Cria rota. O codigo (R1..R4 e outros) e registro administravel.' })
  create(@Body() dto: CreateRouteDto, @CurrentUser() user: { userId: string }) {
    return this.routes.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ROUTES_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateRouteDto, @CurrentUser() user: { userId: string }) {
    return this.routes.update(id, dto, user.userId);
  }

  @Put(':id/stops')
  @RequirePermissions(Permission.ROUTES_WRITE)
  @ApiOperation({
    summary: 'Substitui paradas e ordem, criando uma nova versao de planejamento.',
    description: 'Toda reorganizacao gera nova versao com diff auditado.',
  })
  setStops(@Param('id') id: string, @Body() dto: SetStopsDto, @CurrentUser() user: { userId: string }) {
    return this.routes.setStops(id, dto.stops, dto.changeNote ?? 'Reorganizacao manual', user.userId);
  }

  @Post(':id/publish')
  @RequirePermissions(Permission.ROUTES_PUBLISH)
  @ApiOperation({ summary: 'Publica a rota para o motorista.' })
  publish(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.routes.publish(id, user.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions(Permission.ROUTES_WRITE)
  cancel(@Param('id') id: string, @Body() dto: CancelRouteDto, @CurrentUser() user: { userId: string }) {
    return this.routes.cancel(id, dto.reason, user.userId);
  }

  @Delete(':id')
  @RequirePermissions(Permission.ROUTES_WRITE)
  @ApiOperation({ summary: 'Arquiva a rota (preserva historico).' })
  archive(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.routes.archive(id, user.userId);
  }
}
