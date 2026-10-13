import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RoutingProvider, HeuristicRoutingProvider, LegEstimate, LatLon } from '@rota/shared';
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`OSRM respondeu ${response.status}`);
      const body = (await response.json()) as {
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
}
