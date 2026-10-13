'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Paginated, RouteRow } from '@/lib/types';
import {
  Banner, buttonClass, ErrorBlock, Field, inputClass, LoadingBlock, Panel, primaryButtonClass, StatusBadge,
} from '@/components/ui';
import { formatDistance, formatDuration, routeStatusLabel } from '@/lib/format';

/**
 * TELA 5 — PLANEJAMENTO DE ROTAS.
 * Sugestao de otimizacao e sempre exibida com inclusoes, exclusoes e motivos.
 */
interface Suggestion {
  runId: string;
  result: {
    provider: string;
    networkBased: boolean;
    totalDistanceM: number;
    totalTravelS: number;
    totalServiceS: number;
    estimatedFinishAt: string;
    suggestedCustomerOrder: string[];
    excluded: Array<{ customerId: string; reason: string; detail: string }>;
    constraints: string[];
    confidenceNote: string;
    included: Array<{ customerId: string; sequence: number; plannedArrivalAt: string }>;
  };
}

export default function RotasPage() {
  const [data, setData] = useState<Paginated<RouteRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<Paginated<RouteRow>>('/routes'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar rotas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function publish(route: RouteRow) {
    setMessage(null);
    try {
      await api.post(`/routes/${route.id}/publish`);
      setMessage(`Rota ${route.code} publicada para o motorista.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Falha ao publicar.');
    }
  }

  if (loading && !data) return <LoadingBlock label="Carregando rotas" />;
  if (error && !data) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-body font-semibold text-ink">Rotas</h1>
        <p className="text-table text-ink-secondary">
          Os codigos (R1..R4 e outros) sao registros administravelis, nunca constantes do sistema.
        </p>
      </header>

      {message ? <Banner tone="warn">{message}</Banner> : null}

      {suggestion ? <SuggestionPanel suggestion={suggestion} onClose={() => setSuggestion(null)} /> : null}

      <CreateRouteForm onCreated={async () => { await load(); }} onSuggest={setSuggestion} />

      <Panel title="Rotas cadastradas">
        {data?.data.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-secondary">Nenhuma rota cadastrada.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(data?.data ?? []).map((route) => {
              const status = routeStatusLabel(route.status);
              return (
                <li key={route.id} className="grid grid-cols-6 items-center gap-2 px-4 py-2 text-table">
                  <div className="tabular font-semibold text-ink">{route.code}</div>
                  <div className="text-ink">{route.name}</div>
                  <div className="tabular text-ink-secondary">{route.plannedDate.slice(0, 10)}</div>
                  <div className="tabular text-ink-secondary">v{route.currentVersion} · {route._count?.stops ?? 0} paradas</div>
                  <div><StatusBadge label={status.label} tone={status.tone} /></div>
                  <div className="text-right">
                    {route.status === 'ATRIBUIDA' ? (
                      <button type="button" className={buttonClass} onClick={() => void publish(route)}>Publicar</button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function SuggestionPanel({ suggestion, onClose }: { suggestion: Suggestion; onClose: () => void }) {
  const { result } = suggestion;
  return (
    <Panel
      title="Sugestao de sequencia"
      description={`Provedor: ${result.provider} · estimativas nao sao horarios garantidos`}
      actions={<button type="button" className={buttonClass} onClick={onClose}>Fechar</button>}
    >
      <div className="grid grid-cols-2 gap-4 border-b border-border-subtle p-4 lg:grid-cols-4">
        <div>
          <div className="text-label uppercase text-ink-secondary">Distancia estimada</div>
          <div className="tabular text-body text-ink">{formatDistance(result.totalDistanceM)}</div>
        </div>
        <div>
          <div className="text-label uppercase text-ink-secondary">Deslocamento</div>
          <div className="tabular text-body text-ink">{formatDuration(result.totalTravelS)}</div>
        </div>
        <div>
          <div className="text-label uppercase text-ink-secondary">Atendimento</div>
          <div className="tabular text-body text-ink">{formatDuration(result.totalServiceS)}</div>
        </div>
        <div>
          <div className="text-label uppercase text-ink-secondary">Previsao de fim</div>
          <div className="tabular text-body text-ink">{new Date(result.estimatedFinishAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <div>
          <h3 className="text-label font-semibold uppercase text-ink-secondary">Sequencia sugerida</h3>
          <ol className="mt-2 flex flex-col gap-1">
            {result.included.map((stop) => (
              <li key={stop.customerId} className="tabular flex items-center gap-3 text-body text-ink">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-status-progress-dim text-status-progress">
                  {stop.sequence}
                </span>
                <span className="tabular">
                  {new Date(stop.plannedArrivalAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </span>
                <span className="truncate">{stop.customerId}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-label font-semibold uppercase text-ink-secondary">Nao incluidos</h3>
            {result.excluded.length === 0 ? (
              <p className="text-table text-ink-secondary">Todos os clientes selecionados foram incluidos.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {result.excluded.map((item) => (
                  <li key={item.customerId} className="text-table text-ink-secondary">
                    <StatusBadge label={item.reason.replace(/_/g, ' ')} tone="warn" /> {item.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-label font-semibold uppercase text-ink-secondary">Restricoes consideradas</h3>
            <ul className="mt-1 list-disc pl-4 text-table text-ink-secondary">
              {result.constraints.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <Banner tone={result.networkBased ? 'ok' : 'warn'}>{result.confidenceNote}</Banner>
        </div>
      </div>
    </Panel>
  );
}

function CreateRouteForm({
  onCreated, onSuggest,
}: { onCreated: () => Promise<void>; onSuggest: (s: Suggestion) => void }) {
  const [form, setForm] = useState({ code: '', name: '', plannedDate: new Date().toISOString().slice(0, 10), region: '' });
  const [customerIds, setCustomerIds] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/routes', form);
      await onCreated();
      setForm({ ...form, code: '', name: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar rota.');
    } finally {
      setBusy(false);
    }
  }

  async function suggest(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ids = customerIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) throw new Error('Informe ao menos um cliente (IDs separados por virgula).');
      onSuggest(await api.post<Suggestion>('/optimization/suggest', { customerIds: ids }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao sugerir sequencia.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Criar rota e sugerir sequencia">
      <form onSubmit={submit} className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
        <Field label="Codigo" hint="Ex.: R5"><input className={inputClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></Field>
        <Field label="Nome"><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Data planejada"><input className={inputClass} type="date" value={form.plannedDate} onChange={(e) => setForm({ ...form, plannedDate: e.target.value })} required /></Field>
        <Field label="Regiao"><input className={inputClass} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></Field>
        <div className="col-span-2 lg:col-span-4">
          <Field label="Clientes para otimizar" hint="IDs separados por virgula. Clientes sem coordenadas sao excluidos com motivo.">
            <input className={inputClass} value={customerIds} onChange={(e) => setCustomerIds(e.target.value)} />
          </Field>
        </div>
        <div className="col-span-4 flex items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={busy}>Criar rota</button>
          <button type="button" className={buttonClass} onClick={(e) => void suggest(e as unknown as React.FormEvent)} disabled={busy}>
            Sugerir sequencia
          </button>
          {error ? <span className="text-body text-status-critical">{error}</span> : null}
        </div>
      </form>
    </Panel>
  );
}
