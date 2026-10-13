/**
 * Tipos de dominio do painel, espelhando @rota/shared via API.
 * Formatacao e regras de permissao ficam em lib/format.ts e lib/permissions.ts
 * (funcoes puras, testadas).
 */
export type RoleKey = 'ADMINISTRADOR' | 'SUPERVISOR' | 'MOTORISTA';

export type Freshness = 'ATUAL' | 'PARCIALMENTE_ATUALIZADO' | 'DESATUALIZADO' | 'INDISPONIVEL';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: RoleKey[];
  permissions: string[];
  driverId: string | null;
  mustChangePassword: boolean;
}

export interface DriverPosition {
  driverId: string;
  driverName: string;
  journeyId: string;
  routeId: string | null;
  routeCode: string | null;
  journeyStatus: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: string;
  receivedAt: string;
  speedMps: number | null;
  bearingDeg: number | null;
  connectivity: string;
  batteryPct: number | null;
  dataAgeSeconds: number | null;
  freshness: Freshness;
}

export interface DashboardOverview {
  generatedAt: string;
  drivers: { total: number; inJourney: number; withFreshLocation: number; withStaleLocation: number };
  routes: { planned: number; inProgress: number; concluded: number };
  journeys: { totalInRange: number };
  visits: {
    planned: number;
    concluded: number;
    remaining: number;
    notDone: number;
    completionPct: number | null;
  };
  distance: { gpsMeters: number; manualMeters: number; note: string };
  service: {
    totalSeconds: number;
    travelSeconds: number;
    averageServiceS: number | null;
    medianServiceS: number | null;
    sampleSize: number;
  };
  occurrences: { pending: number };
  alerts: { open: number };
  dataFreshness: { positionsWithData: number; positionsTotal: number; note: string };
}

export interface CustomerRow {
  id: string;
  externalId: string | null;
  tradeName: string;
  city: string;
  neighborhood: string | null;
  addressLine: string | null;
  latitude: number | null;
  longitude: number | null;
  geocodeStatus: string;
  status: string;
  phone: string | null;
  isDemo: boolean;
  lastVisitAt: string | null;
}

export interface RouteRow {
  id: string;
  code: string;
  name: string;
  city: string;
  plannedDate: string;
  status: string;
  currentVersion: number;
  driverId: string | null;
  driverName?: string | null;
  _count?: { stops: number };
}

export interface DriverRow {
  id: string;
  code: string | null;
  status: string;
  homeCity: string | null;
  isDemo: boolean;
  user: { id: string; name: string; email: string; phone: string | null; status: string; lastLoginAt: string | null };
  _count?: { journeys: number; routes: number };
}

export interface JourneyRow {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  gpsDistanceM: number;
  serviceTotalS: number;
  travelTotalS: number;
  stopsPlanned: number;
  stopsConcluded: number;
  stopsNotDone: number;
  isDemo: boolean;
  driver?: { user: { name: string } };
  route?: { code: string; name: string } | null;
}

export interface AlertRow {
  id: string;
  ruleKey: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  context: unknown;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  driver?: { user: { name: string } } | null;
}

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  pages?: number;
  data: T[];
}
