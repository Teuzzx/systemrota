'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DriverPosition } from '@/lib/types';
import { OperationalMap, type GeometrySource, type MapStop } from '@/components/OperationalMap';
import { Banner, ErrorBlock, FreshnessStrip, LoadingBlock, Panel, StatusBadge } from '@/components/ui';
import { formatDataAge, formatDistance, formatDuration } from '@/lib/format';
import { sanitizePath, type LatLon } from '@/lib/map/geometry';
import { activeTileProvider } from '@/lib/map/providers';

interface DriverDetail {
  driver: { id: string; user: { name: string; email: string; phone: string | null } };
  journey: {
    id: string; status: string; startedAt: string; elapsedSeconds: number;
    distanceM: number; stopsPlanned: number; stopsConcluded: number; stopsNotDone: number;
    route: { id: string; code: string; name: string } | null;
  } | null;
  currentCustomer: { id: string; tradeName: string } | null;
  nextVisit: { sequence: number; customer: { id: string; tradeName: string } } | null;
  lastPosition: {
    latitude: number; longitude: number; capturedAt: string; receivedAt: string;
    dataAgeSeconds: number | null;
    freshness: 'ATUAL' | 'PARCIALMENTE_ATUALIZADO' | 'DESATUALIZADO' | 'INDISPONIVEL';
    accuracyM: number;
  } | null;
  isRealTrackingData: boolean;
}

/** Detalhe da rota, como devolvido por GET /api/routes/:id. */
interface RouteDetail {
  currentVersionData: {
    version: number;
    stops: Array<{
      sequence: number;
      status: string;
      customer: {
        id: string;
        tradeName: string;
        city: string | null;
        neighborhood: string | null;
        latitude: number | null;
        longitude: number | null;
        geocodeStatus: string;
      };
    }>;
  } | null;
}

/** Converte o status de visita do dominio para a cor do marcador. */
function visitStatusToMarker(status: string): MapStop['status'] {
  switch (status) {
    case 'CONCLUIDA': return 'ok';
    case 'EM_DESLOCAMENTO':
    case 'CHEGADA_REGISTRADA':
    case 'EM_ATENDIMENTO': return 'progress';
    case 'NAO_REALIZADA': return 'warn';
    case 'CANCELADA': return 'neutral';
    default: return 'neutral';
  }
}

/**
 * TELA 3 — MAPA OPERACIONAL.
 * Trajeto e posicao sao desenhados SO quando existe dado real.
 */
export default function MapaPage() {
  const [positions, setPositions] = useState<DriverPosition[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DriverDetail | null>(null);
  const [track, setTrack] = useState<LatLon[]>([]);
  const [plannedTrack, setPlannedTrack] = useState<LatLon[]>([]);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [geometrySource, setGeometrySource] = useState<GeometrySource | undefined>(undefined);
  const [routingProvider, setRoutingProvider] = useState<{ name: string; networkBased: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Pega a geometria sobre a malha viaria na API.
   *
   * Se a API responder com `networkBased: false`, o mapa desenha linha reta E
   * rotula como estimativa. O caso "deu timeout e nao veio nada" cai em
   * `undefined`, que tambem e tratado como estimativa.
   */
  const fetchGeometry = useCallback(async (waypoints: LatLon[]) => {
    const clean = sanitizePath(waypoints);
    if (clean.length < 2) {
      setGeometrySource({ networkBased: false, provider: 'sem pontos suficientes' });
      return clean;
    }
    try {
      const result = await api.post<{ points: LatLon[]; networkBased: boolean; provider: string }>(
        '/routing/geometry',
        { waypoints: clean },
      );
      setGeometrySource({ networkBased: result.networkBased, provider: result.provider });
      return sanitizePath(result.points);
    } catch {
      setGeometrySource({ networkBased: false, provider: 'indisponivel' });
      return clean;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPositions(await api.get<DriverPosition[]>('/locations/positions'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar posicoes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  // Provedor de roteamento em uso: alimenta o aviso sobre a origem do trajeto.
  useEffect(() => {
    void (async () => {
      try {
        setRoutingProvider(await api.get<{ name: string; networkBased: boolean }>('/routing/provider'));
      } catch {
        // Ausencia de informacao nao bloqueia o mapa; a legenda ja diz
        // "estimado" enquanto geometrySource nao confirmar malha viaria.
        setRoutingProvider(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setTrack([]);
      setPlannedTrack([]);
      return;
    }
    void (async () => {
      try {
        const result = await api.get<DriverDetail>(`/dashboard/drivers/${selected}`);
        setDetail(result);
        if (result.journey) {
          const route = await api.get<{ isRealData: boolean; points: LatLon[] }>(
            `/locations/journeys/${result.journey.id}/track`,
          );
          const registrado = route.isRealData ? sanitizePath(route.points) : [];
          // Geometria viaria quando houver motor; linha reta e rotulada como tal.
          setTrack(await fetchGeometry(registrado));

          // Paradas planejadas: o detalhe da rota ja expoe latitude/longitude de
          // cada cliente. Parada sem coordenada valida nao entra no desenho.
          const routeId = result.journey.route?.id;
          if (routeId) {
            const rota = await api.get<RouteDetail>(`/routes/${routeId}`);
            const version = rota.currentVersionData;
            const pontosPlanejados = (version?.stops ?? []).map((s) => ({
              latitude: s.customer.latitude,
              longitude: s.customer.longitude,
            }));
            setPlannedTrack(await fetchGeometry(sanitizePath(pontosPlanejados)));
            setStops(
              (version?.stops ?? []).map((s) => ({
                id: s.customer.id,
                latitude: s.customer.latitude,
                longitude: s.customer.longitude,
                status: visitStatusToMarker(s.status),
                label: s.customer.tradeName,
                sequence: s.sequence,
                isDemo: s.customer.tradeName.includes('DEMO'),
              })),
            );
          } else {
            setPlannedTrack([]);
            setStops([]);
          }
        } else {
          setTrack([]);
          setPlannedTrack([]);
          setStops([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar detalhe do motorista.');
      }
    })();
  }, [selected, fetchGeometry]);

  if (loading && positions.length === 0) return <LoadingBlock label="Carregando mapa operacional" />;

  // Paradas sem coordenada: aviso explicito, nunca um ponto inventado no mapa.
  const semCoordenada = stops.filter((s) => s.latitude === null || s.longitude === null);
  const tile = activeTileProvider();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-body font-semibold text-ink">Mapa operacional</h1>
        <p className="text-table text-ink-secondary">
          Base {tile.label} · tracejado = planejamento · solido = trajeto registrado
          {routingProvider
            ? ` · roteamento: ${routingProvider.name}${routingProvider.networkBased ? '' : ' (estimado, sem motor viario)'}`
            : ''}
        </p>
      </header>

      {error ? <ErrorBlock message={error} onRetry={() => void load()} /> : null}

      {semCoordenada.length > 0 ? (
        <Banner tone="warn">
          <strong>{semCoordenada.length} cliente(s) sem coordenada valida</strong> — nao aparecem no mapa.{' '}
          <span className="tabular">
            {semCoordenada.map((s) => s.label).slice(0, 6).join(', ')}
            {semCoordenada.length > 6 ? '…' : ''}
          </span>
        </Banner>
      ) : null}

      {!routingProvider?.networkBased ? (
        <Banner tone="neutral">
          Sem motor de roteamento viario configurado. Os trajetos sao <strong>estimados em linha reta</strong>{' '}
          e nao seguem as ruas — configure <span className="tabular">ROUTING_PROVIDER=osrm</span> e{' '}
          <span className="tabular">OSRM_BASE_URL</span> para desenho sobre a via real.
        </Banner>
      ) : null}

      <OperationalMap
        drivers={positions}
        stops={stops}
        track={track}
        plannedTrack={plannedTrack}
        geometrySource={
          geometrySource ?? {
            networkBased: routingProvider?.networkBased ?? false,
            provider: routingProvider?.name ?? 'nao verificado',
          }
        }
        selectedDriverId={selected}
        onSelectDriver={(id) => setSelected(id === selected ? null : id)}
      />

      {detail ? (
        <Panel title={detail.driver.user.name} description={detail.driver.user.email}>
          <dl className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
            <div>
              <dt className="text-label uppercase text-ink-secondary">Rota atual</dt>
              <dd className="text-body text-ink">{detail.journey?.route ? `${detail.journey.route.code} — ${detail.journey.route.name}` : 'sem rota'}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Status da jornada</dt>
              <dd className="text-body text-ink">{detail.journey?.status ?? 'SEM DADO'}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Clientes</dt>
              <dd className="tabular text-body text-ink">
                {detail.journey ? `${detail.journey.stopsConcluded} de ${detail.journey.stopsPlanned}` : '--'}
              </dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Distancia</dt>
              <dd className="tabular text-body text-ink">{formatDistance(detail.journey?.distanceM ?? null)}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Tempo de jornada</dt>
              <dd className="tabular text-body text-ink">{formatDuration(detail.journey?.elapsedSeconds ?? null)}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Cliente atual</dt>
              <dd className="text-body text-ink">{detail.currentCustomer?.tradeName ?? 'SEM DADO'}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Proximo cliente</dt>
              <dd className="text-body text-ink">
                {detail.nextVisit ? `${detail.nextVisit.sequence}. ${detail.nextVisit.customer.tradeName}` : 'nenhum'}
              </dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Ultima posicao</dt>
              <dd className="text-body">
                {detail.lastPosition ? (
                  <FreshnessStrip ageSeconds={detail.lastPosition.dataAgeSeconds} freshness={detail.lastPosition.freshness} />
                ) : (
                  <StatusBadge label="SEM DADO" tone="neutral" />
                )}
              </dd>
            </div>
          </dl>
          {!detail.isRealTrackingData ? (
            <p className="px-4 pb-4 text-table text-ink-muted">
              Sem pontos de localizacao registrados para esta jornada: nenhum trajeto e desenhado.
            </p>
          ) : null}
        </Panel>
      ) : (
        <Panel title="Selecione um motorista" description="Clique no marcador no mapa">
          <p className="px-4 py-6 text-body text-ink-secondary">
            {positions.length === 0
              ? 'Nenhum motorista com jornada ativa no momento.'
              : 'Clique em um marcador para ver rota, progresso e ultima posicao.'}
          </p>
        </Panel>
      )}

      <Panel title="Posicoes recebidas" description="Idade do dado por linha">
        {positions.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-secondary">Nenhuma posicao recebida.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {positions.map((position) => (
              <li key={position.driverId} className="flex items-center justify-between gap-3 px-4 py-2">
                <div>
                  <div className="text-body text-ink">{position.driverName}</div>
                  <div className="tabular text-table text-ink-secondary">
                    {position.routeCode ? `Rota ${position.routeCode}` : 'sem rota'} ·{' '}
                    {position.latitude.toFixed(4)}, {position.longitude.toFixed(4)} · precisão {Math.round(position.accuracyM)} m
                  </div>
                </div>
                <FreshnessStrip ageSeconds={position.dataAgeSeconds} freshness={position.freshness} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-table text-ink-muted">
        Dados de posicao sao gerados por GPS no aparelho e podem ser imprecisos; nao sao usados como prova de presenca.
        Ultima atualizacao: {formatDataAge(positions[0]?.dataAgeSeconds ?? null)}.
      </p>
    </div>
  );
}
