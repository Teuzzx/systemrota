'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DriverPosition } from '@/lib/types';
import { OperationalMap, type MapMarker } from '@/components/OperationalMap';
import { ErrorBlock, FreshnessStrip, LoadingBlock, Panel, StatusBadge } from '@/components/ui';
import { formatDataAge, formatDistance, formatDuration } from '@/lib/format';

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

/**
 * TELA 3 — MAPA OPERACIONAL.
 * Trajeto e posicao sao desenhados SO quando existe dado real.
 */
export default function MapaPage() {
  const [positions, setPositions] = useState<DriverPosition[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DriverDetail | null>(null);
  const [track, setTrack] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setTrack([]);
      return;
    }
    void (async () => {
      try {
        const result = await api.get<DriverDetail>(`/dashboard/drivers/${selected}`);
        setDetail(result);
        if (result.journey) {
          const route = await api.get<{ isRealData: boolean; points: Array<{ latitude: number; longitude: number }> }>(
            `/locations/journeys/${result.journey.id}/track`,
          );
          setTrack(route.isRealData ? route.points : []);
        } else {
          setTrack([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Falha ao carregar detalhe do motorista.');
      }
    })();
  }, [selected]);

  if (loading && positions.length === 0) return <LoadingBlock label="Carregando mapa operacional" />;

  const stops: MapMarker[] = [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-body font-semibold text-ink">Mapa operacional</h1>
        <p className="text-table text-ink-secondary">
          Trajeto tracejado = planejamento · linha solida = trajeto efetivamente registrado
        </p>
      </header>

      {error ? <ErrorBlock message={error} onRetry={() => void load()} /> : null}

      <OperationalMap
        drivers={positions}
        stops={stops}
        track={track}
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
