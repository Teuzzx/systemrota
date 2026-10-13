import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RoutingProvider, HeuristicRoutingProvider, LegEstimate, LatLon, RouteGeometry,
} from '@rota/shared';
import { APP_CONFIG, AppConfig } from '../../config/configuration';

/**
 * Provedor de rotas via OSRM self-hosted (sem chave, sem custo).
 * Usado quando ROUTING_PROVIDER=osrm e OSRM_BASE_URL esta definido.
 * Se o servico estiver fora do ar, o resultado e sinalizado como indisponivel
 * e o chamador pode recorrer ao provider heuristico.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  readonly networkBased = true;
  readonly defaultServiceS = 900;

  constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

  async estimateLeg(from: LatLon, to: LatLon): Promise<LegEstimate> {
    const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const url = `${this.baseUrl.replace(/\/$/, '')}/route/v1/driving/${coords}?overview=false`;
    const response = await this.fetchJson(url);
    const body = response as {
      code: string;
      routes?: Array<{ distance: number; duration: number }>;
    };
    if (body.code !== 'Ok' || !body.routes?.[0]) throw new Error(`OSRM code=${body.code}`);
    const route = body.routes[0];
    return {
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      networkBased: true,
    };
  }

  /**
   * Geometria REAL sobre a malha viaria.
   *
   * `overview=full` + `geometries=geojson` faz o OSRM devolver os pontos do
   * caminho pelas ruas. E isso que permite desenhar a rota sobre o mapa de
   * verdade, em vez de um segmento reto ligando os clientes.
   *
   * `annotations=false` reduz o payload; so precisamos da geometria.
   */
  async geometry(waypoints: LatLon[]): Promise<RouteGeometry> {
    if (waypoints.length < 2) {
      return { points: waypoints.map((p) => ({ ...p })), networkBased: false };
    }
    const coords = waypoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const url =
      `${this.baseUrl.replace(/\/$/, '')}/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson&annotations=false`;
    const body = (await this.fetchJson(url)) as {
      code: string;
      routes?: Array<{
        geometry?: { type?: string; coordinates?: number[][] };
      }>;
    };
    if (body.code !== 'Ok' || !body.routes?.[0]?.geometry?.coordinates?.length) {
      throw new Error(`OSRM sem geometria (code=${body.code})`);
    }
    // GeoJSON e [longitude, latitude] — a ordem oposta de LatLon.
    const points = body.routes[0].geometry.coordinates
      .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => ({ latitude: c[1], longitude: c[0] }));
    if (points.length < 2) throw new Error('OSRM devolveu geometria degenerada');
    return { points, networkBased: true };
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`OSRM respondeu ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Adapter GraphHopper. Exige credencial; nunca e assumido disponivel. */
export class GraphHopperRoutingProvider implements RoutingProvider {
  readonly name = 'graphhopper';
  readonly networkBased = true;
  readonly defaultServiceS = 900;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  async estimateLeg(from: LatLon, to: LatLon): Promise<LegEstimate> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/api/1/route`);
    url.searchParams.set('point', `${from.latitude},${from.longitude}`);
    url.searchParams.set('point', `${to.latitude},${to.longitude}`);
    url.searchParams.set('profile', 'car');
    url.searchParams.set('locale', 'pt_BR');
    url.searchParams.set('calc_points', 'false');
    url.searchParams.set('key', this.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`GraphHopper respondeu ${response.status}`);
      const body = (await response.json()) as {
        paths?: Array<{ distance: number; time: number }>;
      };
      const path = body.paths?.[0];
      if (!path) throw new Error('GraphHopper sem trajeto');
      return {
        distanceM: Math.round(path.distance),
        durationS: Math.round(path.time / 1000),
        networkBased: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Fabrica de providers de roteamento.
 * Regra: nenhum servico externo e assumido funcional sem credencial/config.
 * O provider heuristico offline e o padrao e funciona sempre.
 */
@Injectable()
export class RoutingService implements OnModuleInit {
  private readonly logger = new Logger(RoutingService.name);
  private primary: RoutingProvider;
  readonly fallback: RoutingProvider = new HeuristicRoutingProvider();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.primary = this.build();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Provedor de rotas: ${this.primary.name} (fallback: ${this.fallback.name})`);
  }

  private build(): RoutingProvider {
    const { provider, osrmBaseUrl, graphhopperUrl, graphhopperApiKey, timeoutMs } = this.config.routing;
    if (provider === 'osrm' && osrmBaseUrl) return new OsrmRoutingProvider(osrmBaseUrl, timeoutMs);
    if (provider === 'graphhopper' && graphhopperUrl && graphhopperApiKey) {
      return new GraphHopperRoutingProvider(graphhopperUrl, graphhopperApiKey, timeoutMs);
    }
    return this.fallback;
  }

  get providerName(): string {
    return this.primary.name;
  }

  get isNetworkBased(): boolean {
    return this.primary.networkBased;
  }

  /**
   * Estima um trecho. Se o provider de rede falhar, cai para o heuristico e
   * marca o resultado como estimativa - nunca inventa dado.
   */
  async estimateLeg(from: LatLon, to: LatLon): Promise<LegEstimate> {
    if (!this.primary.networkBased) return this.primary.estimateLeg(from, to);
    try {
      return await this.primary.estimateLeg(from, to);
    } catch (error) {
      this.logger.warn(
        `Provider ${this.primary.name} indisponivel (${String(error)}). Usando heuristico offline.`,
      );
      const fallbackLeg = await this.fallback.estimateLeg(from, to);
      return { ...fallbackLeg, networkBased: false };
    }
  }

  /**
   * Geometria do trajeto para desenhar no mapa.
   *
   * Se o provider de rede falhar, cai para linha reta e marca
   * `networkBased: false`. O requisito e que o chamador NUNCA apresente esse
   * retorno como "rota pelas ruas": a flag existe para isso.
   */
  async geometry(waypoints: LatLon[]): Promise<RouteGeometry> {
    if (waypoints.length < 2) {
      return { points: waypoints.map((p) => ({ ...p })), networkBased: false };
    }
    if (this.primary.networkBased && this.primary.geometry) {
      try {
        return await this.primary.geometry(waypoints);
      } catch (error) {
        this.logger.warn(
          `Geometria de ${this.primary.name} indisponivel (${String(error)}). Usando linha reta estimada.`,
        );
      }
    }
    return { points: waypoints.map((p) => ({ ...p })), networkBased: false };
  }
}
