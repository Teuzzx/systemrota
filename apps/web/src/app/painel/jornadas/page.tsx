'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { JourneyRow, Paginated } from '@/lib/types';
import {
  buttonClass, ErrorBlock, Field, inputClass, LoadingBlock, Panel, StatusBadge,
} from '@/components/ui';
import { formatDateTime, formatDistance, formatDuration, journeyStatusLabel } from '@/lib/format';

/** TELA 7 — HISTORICO DE JORNADAS. */
export default function JornadasPage() {
  const [data, setData] = useState<Paginated<JourneyRow> | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      params.set('pageSize', '50');
      setData(await api.get<Paginated<JourneyRow>>(`/journeys?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar jornadas.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <LoadingBlock label="Carregando historico" />;
  if (error && !data) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-body font-semibold text-ink">Historico de jornadas</h1>
        <p className="text-table text-ink-secondary">{data?.total ?? 0} jornadas no periodo</p>
      </header>

      <Panel title="Filtros">
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <Field label="De"><input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Ate"><input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex items-end"><button type="button" className={buttonClass} onClick={() => void load()}>Aplicar</button></div>
        </div>
      </Panel>

      <Panel title="Jornadas">
        {data?.data.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-secondary">Nenhuma jornada registrada no periodo.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(data?.data ?? []).map((journey) => {
              const status = journeyStatusLabel(journey.status);
              return (
                <li key={journey.id} className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-table">
                  <div className="col-span-2 tabular text-ink-secondary">{formatDateTime(journey.startedAt)}</div>
                  <div className="col-span-2 truncate text-ink">{journey.driver?.user.name ?? '--'}</div>
                  <div className="col-span-1 tabular text-ink-secondary">{journey.route?.code ?? '--'}</div>
                  <div className="col-span-2 tabular text-ink-secondary">{formatDuration(
                    journey.endedAt
                      ? (new Date(journey.endedAt).getTime() - new Date(journey.startedAt).getTime()) / 1000
                      : null,
                  )}</div>
                  <div className="col-span-2 tabular text-ink-secondary">{formatDistance(journey.gpsDistanceM)}</div>
                  <div className="col-span-2 tabular text-ink-secondary">
                    {journey.stopsConcluded}/{journey.stopsPlanned} concluidos
                    {journey.stopsNotDone > 0 ? ` · ${journey.stopsNotDone} nao realizados` : ''}
                  </div>
                  <div className="col-span-2 tabular text-ink-secondary">
                    {formatDuration(journey.serviceTotalS)} atend. · {formatDuration(journey.travelTotalS)} desloc.
                  </div>
                  <div className="col-span-1"><StatusBadge label={status.label} tone={status.tone} /></div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
