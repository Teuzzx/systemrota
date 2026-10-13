'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AlertRow, DashboardOverview, DriverPosition } from '@/lib/types';
import {
  Banner, ErrorBlock, LoadingBlock, MetricTile, Panel, StatusBadge,
} from '@/components/ui';
import {
  formatDataAge, formatDistance, formatDuration, formatPercent, severityTone,
} from '@/lib/format';

/**
 * TELA 2 — DASHBOARD OPERACIONAL.
 * Todos os indicadores vem de dados persistidos; a origem e a API.
 */
export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [positions, setPositions] = useState<DriverPosition[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, pos, al] = await Promise.all([
        api.get<DashboardOverview>('/dashboard/overview'),
        api.get<DriverPosition[]>('/locations/positions'),
        api.get<{ data: AlertRow[] }>('/alerts?pageSize=5'),
      ]);
      setOverview(ov);
      setPositions(pos);
      setAlerts(al.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar indicadores.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Atualizacao periodica leve: o painel nao exige recarregar a pagina.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !overview) return <LoadingBlock label="Carregando indicadores" />;
  if (error && !overview) return <ErrorBlock message={error} onRetry={() => void load()} />;
  if (!overview) return <ErrorBlock message="Sem dados disponiveis." onRetry={() => void load()} />;

  const hasDemo = positions.some((p) => p.driverName.includes('DEMO'));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-body font-semibold text-ink">Dashboard operacional</h1>
          <p className="text-table text-ink-secondary">
            Gerado em {new Date(overview.generatedAt).toLocaleTimeString('pt-BR')} · indicadores calculados do banco de dados
          </p>
        </div>
      </header>

      {hasDemo ? (
        <Banner tone="warn">
          <strong>Atencao:</strong> ha dados de demonstracao em exibicao (identificados como DEMO). Nao representam a operacao real.
        </Banner>
      ) : null}

      {error ? <Banner tone="critical">Falha na atualizacao: {error}</Banner> : null}

      <section aria-label="Indicadores de frota e rotas" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Motoristas cadastrados"
          value={overview.drivers.total}
          context={`${overview.drivers.inJourney} em jornada`}
        />
        <MetricTile
          label="Com localizacao atual"
          value={overview.drivers.withFreshLocation}
          context={`${overview.drivers.withStaleLocation} com dado desatualizado`}
          tone={overview.drivers.withStaleLocation > 0 ? 'warn' : 'ok'}
        />
        <MetricTile
          label="Rotas planejadas"
          value={overview.routes.planned}
          context={`${overview.routes.inProgress} em andamento · ${overview.routes.concluded} concluidas`}
        />
        <MetricTile
          label="Alertas em aberto"
          value={overview.alerts.open}
          context={`${overview.occurrences.pending} ocorrencias aguardando acompanhamento`}
          tone={overview.alerts.open > 0 ? 'warn' : 'ok'}
        />
      </section>

      <section aria-label="Progresso de visitas" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Clientes planejados"
          value={overview.visits.planned}
          context={`${overview.visits.remaining} restantes`}
        />
        <MetricTile
          label="Clientes atendidos"
          value={overview.visits.concluded}
          context={`${formatPercent(overview.visits.completionPct)} de conclusao`}
          tone="ok"
        />
        <MetricTile
          label="Nao realizados"
          value={overview.visits.notDone}
          context="com justificativa registrada"
          tone={overview.visits.notDone > 0 ? 'warn' : 'neutral'}
        />
        <MetricTile
          label="Distancia percorrida"
          value={formatDistance(overview.distance.gpsMeters)}
          context={overview.distance.note}
        />
      </section>

      <section aria-label="Tempos e alertas" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Tempos de atendimento" description="Medidos a partir dos eventos registrados">
          <dl className="grid grid-cols-2 gap-4 p-4">
            <div>
              <dt className="text-label uppercase text-ink-secondary">Tempo total em atendimento</dt>
              <dd className="tabular text-body text-ink">{formatDuration(overview.service.totalSeconds)}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Tempo total em deslocamento</dt>
              <dd className="tabular text-body text-ink">{formatDuration(overview.service.travelSeconds)}</dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Atendimento medio</dt>
              <dd className="tabular text-body text-ink">
                {formatDuration(overview.service.averageServiceS)}
                <span className="ml-2 text-table text-ink-muted">({overview.service.sampleSize} amostras)</span>
              </dd>
            </div>
            <div>
              <dt className="text-label uppercase text-ink-secondary">Atendimento mediano</dt>
              <dd className="tabular text-body text-ink">{formatDuration(overview.service.medianServiceS)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Posicoes mais recentes" description="Idade do dado e sempre exibida">
          {positions.length === 0 ? (
            <p className="px-4 py-6 text-body text-ink-secondary">Nenhum motorista em jornada no momento.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {positions.slice(0, 6).map((position) => (
                <li key={position.driverId} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-body text-ink">{position.driverName}</div>
                    <div className="tabular text-table text-ink-secondary">
                      {position.routeCode ? `Rota ${position.routeCode}` : 'sem rota'} · {formatDataAge(position.dataAgeSeconds)}
                    </div>
                  </div>
                  <StatusBadge
                    label={position.freshness === 'ATUAL' ? 'ATUAL' : position.freshness === 'INDISPONIVEL' ? 'SEM DADO' : 'DESATUALIZADO'}
                    tone={
                      position.freshness === 'ATUAL'
                        ? 'ok'
                        : position.freshness === 'PARCIALMENTE_ATUALIZADO'
                          ? 'warn'
                          : position.freshness === 'INDISPONIVEL'
                            ? 'neutral'
                            : 'critical'
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Panel title="Alertas recentes" description="Somente alertas com dado verificavel">
        {alerts.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-secondary">Nenhum alerta registrado.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {alerts.map((alert) => (
              <li key={alert.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-body text-ink">{alert.title}</div>
                    <div className="text-table text-ink-secondary">{alert.message}</div>
                  </div>
                  <StatusBadge label={alert.severity} tone={severityTone(alert.severity)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
