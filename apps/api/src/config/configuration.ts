/**
 * Configuracao tipada da aplicacao.
 * Falha de proposito no boot de producao quando faltam segredos: e melhor
 * nao subir do que subir com segredo padrao.
 */
export type NodeEnv = 'development' | 'test' | 'production';

export type RoutingProviderName = 'heuristic' | 'osrm' | 'graphhopper';
export type DbDriver = 'postgresql' | 'pglite';
/**
 * `engine`      -> binario nativo do Prisma (padrao em producao).
 * `pg-adapter`  -> driver adapter sobre node-postgres. Usado quando o alvo e o
 *                  PGlite, cujo servidor de socket nao se da bem com o
 *                  protocolo binario do engine nativo.
 * O SQL, o schema e as migracoes sao IDENTICOS nos dois transportes.
 */
export type DbTransport = 'engine' | 'pg-adapter';

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  db: {
    driver: DbDriver;
    transport: DbTransport;
    url: string;
    pglitePort: number;
    pgliteDataDir: string | null;
  };
  auth: {
    accessSecret: string;
    accessTtlSeconds: number;
    refreshTtlDays: number;
    maxFailedLogins: number;
    lockoutMinutes: number;
  };
  routing: {
    provider: RoutingProviderName;
    osrmBaseUrl: string | null;
    graphhopperUrl: string | null;
    graphhopperApiKey: string | null;
    timeoutMs: number;
  };
  tracking: {
    locationRetentionDays: number;
    aggregateRetentionDays: number;
  };
  operations: {
    allowDemoSeed: boolean;
    defaultServiceSeconds: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
    authMax: number;
  };
}

function str(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Variavel de ambiente ${key} deve ser numerica. Recebido: ${raw}`);
  }
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'sim'].includes(raw.toLowerCase());
}

function optional(key: string): string | null {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? null : raw;
}

const DEV_ACCESS_SECRET = 'dev-only-insecure-access-secret-change-me';

export function loadConfig(): AppConfig {
  const nodeEnv = str('NODE_ENV', 'development') as NodeEnv;
  const isProduction = nodeEnv === 'production';

  const dbDriver = str('DB_DRIVER', isProduction ? 'postgresql' : 'pglite') as DbDriver;
  const pglitePort = num('PGLITE_PORT', 54329);
  // Contra PGlite o engine nativo do Prisma desincroniza o protocolo de wire
  // (ver docs/ADR-0002.md); o driver adapter sobre node-postgres e estavel.
  const dbTransport = str(
    'DB_TRANSPORT',
    dbDriver === 'pglite' ? 'pg-adapter' : 'engine',
  ) as DbTransport;

  let databaseUrl = optional('DATABASE_URL');
  if (!databaseUrl) {
    if (isProduction) {
      throw new Error(
        'DATABASE_URL e obrigatoria em producao. Ver .env.example para o formato.',
      );
    }
    databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${pglitePort}/postgres?schema=public`;
  }

  const accessSecret = str('JWT_ACCESS_SECRET', DEV_ACCESS_SECRET);
  if (isProduction && accessSecret === DEV_ACCESS_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET precisa ser definido em producao (valor padrao de desenvolvimento recusado).',
    );
  }
  if (isProduction && accessSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET deve ter ao menos 32 caracteres em producao.');
  }

  const routingProvider = str('ROUTING_PROVIDER', 'heuristic') as RoutingProviderName;
  const osrmBaseUrl = optional('OSRM_BASE_URL');
  if (routingProvider === 'osrm' && !osrmBaseUrl) {
    throw new Error('ROUTING_PROVIDER=osrm exige OSRM_BASE_URL.');
  }
  const graphhopperUrl = optional('GRAPHHOPPER_URL');
  const graphhopperApiKey = optional('GRAPHHOPPER_API_KEY');
  if (routingProvider === 'graphhopper' && (!graphhopperUrl || !graphhopperApiKey)) {
    throw new Error('ROUTING_PROVIDER=graphhopper exige GRAPHHOPPER_URL e GRAPHHOPPER_API_KEY.');
  }

  return {
    nodeEnv,
    isProduction,
    port: num('PORT', 4000),
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    db: {
      driver: dbDriver,
      transport: dbTransport,
      url: databaseUrl,
      pglitePort,
      pgliteDataDir: optional('PGLITE_DATA_DIR'),
    },
    auth: {
      accessSecret,
      accessTtlSeconds: num('JWT_ACCESS_TTL_SECONDS', 900),
      refreshTtlDays: num('JWT_REFRESH_TTL_DAYS', 14),
      maxFailedLogins: num('AUTH_MAX_FAILED_LOGINS', 5),
      lockoutMinutes: num('AUTH_LOCKOUT_MINUTES', 15),
    },
    routing: {
      provider: routingProvider,
      osrmBaseUrl,
      graphhopperUrl,
      graphhopperApiKey,
      timeoutMs: num('ROUTING_TIMEOUT_MS', 5000),
    },
    tracking: {
      locationRetentionDays: num('LOCATION_RETENTION_DAYS', 90),
      aggregateRetentionDays: num('AGGREGATE_RETENTION_DAYS', 730),
    },
    operations: {
      allowDemoSeed: bool('ALLOW_DEMO_SEED', !isProduction),
      defaultServiceSeconds: num('DEFAULT_SERVICE_SECONDS', 900),
    },
    rateLimit: {
      windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
      max: num('RATE_LIMIT_MAX', 300),
      authMax: num('RATE_LIMIT_AUTH_MAX', 10),
    },
  };
}

export const APP_CONFIG = 'APP_CONFIG';
