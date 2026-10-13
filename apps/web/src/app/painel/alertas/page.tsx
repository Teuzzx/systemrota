'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AlertRow, Paginated } from '@/lib/types';
import { buttonClass, ErrorBlock, inputClass, LoadingBlock, Panel, primaryButtonClass, StatusBadge } from '@/components/ui';
import { formatDateTime, severityTone } from '@/lib/format';

/** Alertas automaticos: lista, ciclo de vida e reavaliacao sob demanda. */
export default function AlertasPage() {
  const [data, setData] = useState<Paginated<AlertRow> | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      setData(await api.get<Paginated<AlertRow>>(`/alerts?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar alertas.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: 'acknowledge' | 'resolve') {
    setMessage(null);
    try {
      await api.post(`/alerts/${id}/${action}`, {});
      setMessage(action === 'resolve' ? 'Alerta resolvido.' : 'Alerta reconhecido.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao atualizar alerta.');
    }
  }

  if (loading && !data) return <LoadingBlock label="Carregando alertas" />;
  if (error && !data) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-body font-semibold text-ink">Alertas</h1>
          <p className="text-table text-ink-secondary">{data?.total ?? 0} registros</p>
        </div>
        <div className="flex items-center gap-2">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="ABERTO">Aberto</option>
            <option value="RECONHECIDO">Reconhecido</option>
            <option value="RESOLVIDO">Resolvido</option>
          </select>
          <button type="button" className={buttonClass} onClick={() => void load()}>Filtrar</button>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={async () => {
              await api.post('/alerts/evaluate', {});
              await load();
            }}
          >
            Reavaliar agora
          </button>
        </div>
      </header>

      {message ? <p className="text-body text-ink-secondary">{message}</p> : null}

      <Panel title="Alertas automaticos" description="Cada alerta carrega o dado verificavel que o originou">
        {data?.data.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-secondary">Nenhum alerta registrado.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(data?.data ?? []).map((alert) => (
              <li key={alert.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-body text-ink">{alert.title}</div>
                    <div className="text-table text-ink-secondary">{alert.message}</div>
                    <div className="tabular mt-1 text-table text-ink-muted">
                      regra: {alert.ruleKey} · ocorrencias: {alert.occurrences} · primeira vez:{' '}
                      {formatDateTime(alert.firstSeenAt)} · ultima: {formatDateTime(alert.lastSeenAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge label={alert.severity} tone={severityTone(alert.severity)} />
                    <StatusBadge
                      label={alert.status}
                      tone={alert.status === 'RESOLVIDO' ? 'ok' : alert.status === 'ABERTO' ? 'warn' : 'progress'}
                    />
                  </div>
                </div>
                {alert.status === 'ABERTO' ? (
                  <div className="flex gap-2">
                    <button type="button" className={buttonClass} onClick={() => void act(alert.id, 'acknowledge')}>Reconhecer</button>
                    <button type="button" className={buttonClass} onClick={() => void act(alert.id, 'resolve')}>Resolver</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
