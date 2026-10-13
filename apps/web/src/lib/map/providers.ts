/**
 * Configuracao de provedores de mapa e de tiles.
 *
 * REGRA DE PROJETO: a troca de provedor e uma operacao de DADOS, nao de codigo.
 * Trocar de OpenStreetMap para um tile proprio (MapTiler,stile proprio, CDN
 * interno) e acrescentar uma entrada em `TILE_PROVIDERS` e em
 * `NEXT_PUBLIC_TILE_PROVIDER`. Nenhum componente precisa mudar.
 *
 * Politica de uso: OpenStreetMap e gratuito, sem chave e sem cadastro, mas tem
 * uma politica publica de uso que precisa ser respeitada. As responsabilidades
 * que assumimos aqui estao marcadas em `usagePolicy` e replicadas em
 * docs/PENDENCIAS.md.
 */

/** Identificador de um provedor de tiles. */
export type TileProviderId =
  | 'osm-standard'
  | 'osm-humanitarian'
  | 'opentopo';

/** Projeto com produto comercial: exige autorizacao explicita do cliente. */
export type CommercialTileProviderId = 'maptiler' | 'stadia';

export interface TileProvider {
  readonly id: TileProviderId | CommercialTileProviderId;
  readonly label: string;
  /** URL de tile. `{z}`, `{x}`, `{y}` sao substituidos pelo Leaflet. */
  readonly url: string;
  /** Atribuicao OBRIGATORIA. Nunca remover: e o que credita o dado. */
  readonly attribution: string;
  readonly maxZoom: number;
  /** Campo no endereco para trocar o host (CDN alternativo). */
  readonly subdomains?: string[];
  /** Requer credencial do cliente. */
  readonly requiresKey: boolean;
  /** Limite de uso declarado pelo provedor, em texto. */
  readonly usagePolicy: string;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/**
 * Padroes de uso que declaramos assumir. O tile oficial do OSM e para uso leve
 * e de baixa frequencia. Uma operacao de despacho com poucos usuarios internos
 * cabe no perfil aceitavel; um painel publico ou de alto volume, nao.
 */
const OSM_POLICY =
  'Uso leve, baixa frequencia, sem download em massa. Nao usar em produto publico ' +
  'ou de alto volume: nesse caso, contratar um provedor ou hospedar o proprio tile.';

export const TILE_PROVIDERS: Record<string, TileProvider> = {
  'osm-standard': {
    id: 'osm-standard',
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
    requiresKey: false,
    usagePolicy: OSM_POLICY,
  },
  'osm-humanitarian': {
    id: 'osm-humanitarian',
    label: 'OSM Humanitarian',
    url: 'https://tile-{s}.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTRIBUTION} &middot; Tiles Humanitari`,
    maxZoom: 19,
    subdomains: ['a', 'b', 'c'],
    requiresKey: false,
    usagePolicy: OSM_POLICY,
  },
  opentopo: {
    id: 'opentopo',
    label: 'OpenTopoMap',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTRIBUTION}, SRTM | &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (CC-BY-SA)`,
    maxZoom: 17,
    requiresKey: false,
    usagePolicy:
      'Uso leve e nao comercial. Politica ainda mais restritiva que a do OSM: nao usar em produto comercial sem verificar os termos.',
  },
  // --- provedores comerciais: NAO ativar sem autorizacao do cliente ---
  maptiler: {
    id: 'maptiler',
    label: 'MapTiler',
    url: 'https://api.maptiler.com/maps/streets-v2/0/default/{z}/{x}/{y}.png?key=NEXT_PUBLIC_MAPTILER_KEY',
    attribution: `${OSM_ATTRIBUTION} &middot; imagery &copy; MapTiler`,
    maxZoom: 20,
    requiresKey: true,
    usagePolicy: 'Requer chave. Gera cobranca acima da cota gratuita. NAO ativar sem autorizacao.',
  },
  stadia: {
    id: 'stadia',
    label: 'Stadia Maps',
    url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png',
    attribution: `${OSM_ATTRIBUTION} &middot; &copy; Stadia Maps`,
    maxZoom: 20,
    requiresKey: false,
    usagePolicy: 'Regras especificas da Stadia; nao assume valido sem revisao. NAO ativar sem autorizacao.',
  },
};

/** Id do provedor ativo, vind do ambiente de build. */
export function activeTileProviderId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_TILE_PROVIDER;
  return fromEnv && TILE_PROVIDERS[fromEnv] ? fromEnv : 'osm-standard';
}

export function activeTileProvider(): TileProvider {
  return TILE_PROVIDERS[activeTileProviderId()];
}

/**
 * Viewpadrao da operacao: Picos, PI. Usado antes de existir qualquer ponto
 * real no mapa, para o painel abrir na area correta em vez de no Oceano
 * Atlantico.
 */
export const OPERACAO_CENTER: { latitude: number; longitude: number; zoom: number } = {
  latitude: -7.0694,
  longitude: -43.0901,
  zoom: 13,
};