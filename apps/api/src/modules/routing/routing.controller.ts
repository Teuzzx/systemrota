import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNumber, Max, Min, ValidateNested } from 'class-validator';
import { RoutingService } from './routing.service';
import type { LatLon, RouteGeometry } from '@rota/shared';

class WaypointDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

class GeometryBodyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WaypointDto)
  waypoints!: WaypointDto[];
}

/**
 * TELA 3 — suporte do mapa operacional.
 *
 * Devolve a geometria para o painel desenhar SOBRE AS VIAS REAIS quando houver
 * motor de roteamento configurado. Sem ele, a resposta volta em linha reta com
 * `networkBased: false`, e o painel rotula como estimativa — nunca como rota.
 */
@ApiTags('routing')
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get('provider')
  @ApiOperation({
    summary: 'Provedor de roteamento em uso',
    description:
      'Permite ao painel dizer se o trajeto desenhado vem da malha viaria ou e estimativa.',
  })
  provider(): { name: string; networkBased: boolean } {
    return { name: this.routing.providerName, networkBased: this.routing.isNetworkBased };
  }

  @Post('geometry')
  @ApiOperation({
    summary: 'Geometria do trajeto entre pontos, na ordem informada',
    description:
      'Com OSRM configurado devolve os pontos do caminho pelas ruas (networkBased=true). Sem ele, devolve linha reta com networkBased=false.',
  })
  async geometry(@Body() body: GeometryBodyDto): Promise<RouteGeometry & { provider: string }> {
    const waypoints: LatLon[] = body.waypoints.map((w) => ({
      latitude: w.latitude,
      longitude: w.longitude,
    }));
    const result = await this.routing.geometry(waypoints);
    return { ...result, provider: this.routing.providerName };
  }

  @Get('geometry')
  @ApiOperation({
    summary: 'Geometria via querystring (diagnostico)',
    description: 'Formato: -7.07,-45.01;-7.09,-45.04',
  })
  async geometryQuery(@Query('points') points?: string): Promise<RouteGeometry & { provider: string }> {
    const waypoints: LatLon[] = (points ?? '')
      .split(';')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [lat, lng] = pair.split(',').map((n) => Number(n.trim()));
        return { latitude: lat, longitude: lng };
      })
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

    const result = await this.routing.geometry(waypoints);
    return { ...result, provider: this.routing.providerName };
  }
}