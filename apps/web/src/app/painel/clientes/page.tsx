'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { CustomerRow, Paginated } from '@/lib/types';
import {
  Banner, buttonClass, ErrorBlock, Field, inputClass, LoadingBlock, Panel, primaryButtonClass, StatusBadge,
} from '@/components/ui';
import { formatDateTime, geocodeTone } from '@/lib/format';

/** TELA 6 — CLIENTES: cadastro, filtro, importacao, exportacao e historico. */
export default function ClientesPage() {
  const [data, setData] = useState<Paginated<CustomerRow> | null>(null);
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const [onlyPendingGeo, setOnlyPendingGeo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (city) params.set('city', city);
      if (onlyPendingGeo) params.set('geocodeStatus', 'AUSENTE');
      params.set('pageSize', '50');
      setData(await api.get<Paginated<CustomerRow>>(`/customers?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }, [search, city, onlyPendingGeo]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <LoadingBlock label="Carregando clientes" />;
  if (error && !data) return <ErrorBlock message={error} onRetry={() => void load()} />;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-body font-semibold text-ink">Clientes e pontos de venda</h1>
        <p className="text-table text-ink-secondary">{data?.total ?? 0} cadastros no filtro atual</p>
      </header>

      <ImportPanel onMessage={setMessage} />
      {message ? <Banner tone="ok">{message}</Banner> : null}

      <Panel
        title="Cadastro"
        actions={
          <>
            <a className={buttonClass} href="/api/imports/export/customers.csv" download>Exportar CSV</a>
            <a className={buttonClass} href="/api/imports/export/customers.xlsx" download>Exportar XLSX</a>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 border-b border-border-subtle p-4 lg:grid-cols-4">
          <Field label="Buscar"><input className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, ID ou responsavel" /></Field>
          <Field label="Cidade"><input className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-body text-ink-secondary">
            <input type="checkbox" checked={onlyPendingGeo} onChange={(e) => setOnlyPendingGeo(e.target.checked)} />
            Somente sem coordenada
          </label>
          <div className="flex items-end"><button type="button" className={buttonClass} onClick={() => void load()}>Filtrar</button></div>
        </div>

        {data?.data.length === 0 ? (
          <p className="px-4 py-6 text-body text-ink-secondary">Nenhum cliente no filtro atual.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(data?.data ?? []).map((customer) => {
              const geo = geocodeTone(customer.geocodeStatus);
              return (
                <li key={customer.id} className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-table">
                  <div className="col-span-4 truncate text-ink">
                    {customer.tradeName}
                    {customer.isDemo ? <span className="ml-2 text-label uppercase text-status-warn">demo</span> : null}
                  </div>
                  <div className="col-span-2 text-ink-secondary">{customer.city}</div>
                  <div className="col-span-2 truncate text-ink-secondary">{customer.neighborhood ?? '--'}</div>
                  <div className="col-span-2">
                    <StatusBadge label={geo.label} tone={geo.tone} />
                  </div>
                  <div className="col-span-2 tabular text-right text-ink-secondary">
                    {customer.latitude !== null ? `${customer.latitude.toFixed(4)}, ${customer.longitude?.toFixed(4)}` : '--'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-4 py-3 text-table text-ink-muted">
          Ultima visita registrada: {formatDateTime(data?.data[0]?.lastVisitAt ?? null)} (primeiro registro do filtro).
        </p>
      </Panel>
    </div>
  );
}

interface ImportPreview {
  importId: string;
  headers: string[];
  suggestedMapping: Record<string, string>;
  fields: string[];
  totalRows: number;
  reusedExistingBatch?: boolean;
  mapping?: Record<string, string>;
  summary?: { willInsert: number; willSkip: number; duplicateRows: number; pendingGeocodeRows: number; mappingComplete: boolean };
  issues?: Array<{ rowNumber: number; message: string; severity: string }>;
  duplicates?: Array<{ rowNumber: number; tradeName: string; reason: string }>;
}

function ImportPanel({ onMessage }: { onMessage: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.post<ImportPreview>('/imports/upload', form);
      setPreview(result);
      setMapping(result.suggestedMapping ?? {});
      onMessage(
        result.reusedExistingBatch
          ? 'Arquivo ja processado anteriormente: o lote existente foi reaproveitado (nenhum cliente duplicado).'
          : `${result.totalRows} linhas lidas. Revise o mapeamento antes de confirmar.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ImportPreview>(`/imports/${preview.importId}/preview`, { mapping });
      setPreview({ ...preview, ...result, mapping: result.mapping });
      onMessage(
        `Previa: ${result.summary?.willInsert ?? 0} a inserir, ${result.summary?.willSkip ?? 0} com erro, ` +
        `${result.summary?.duplicateRows ?? 0} possiveis duplicidades, ${result.summary?.pendingGeocodeRows ?? 0} pendentes de coordenada.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao validar.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ insertedCount: number; updatedCount: number; skippedCount: number; errorCount: number }>(
        `/imports/${preview.importId}/commit`,
        { onConflict: 'SKIP' },
      );
      onMessage(
        `Importacao concluida: ${result.insertedCount} inseridos, ${result.updatedCount} atualizados, ` +
        `${result.skippedCount} ignorados, ${result.errorCount} erro(s).`,
      );
      setPreview(null);
      setMapping({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar importacao.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Importar clientes do sistema comercial" description="Fluxo: upload, colunas, mapeamento, validacao, previa, duplicidades, confirmacao, relatorio">
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Arquivo CSV ou XLSX">
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className={inputClass} />
        </Field>
        <button type="button" className={buttonClass} onClick={() => void upload()} disabled={busy}>1. Enviar arquivo</button>
        <button type="button" className={buttonClass} onClick={() => void runPreview()} disabled={busy || !preview}>2. Validar e ver previa</button>
        <button type="button" className={primaryButtonClass} onClick={() => void commit()} disabled={busy || !preview}>3. Confirmar importacao</button>
        {error ? <span className="text-body text-status-critical">{error}</span> : null}
      </div>

      {preview ? (
        <div className="border-t border-border-subtle p-4">
          <h3 className="text-label font-semibold uppercase text-ink-secondary">Mapeamento coluna → campo</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {preview.fields.map((field) => (
              <Field key={field} label={field}>
                <select
                  className={inputClass}
                  value={mapping[field] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                >
                  <option value="">(nao importar)</option>
                  {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>

          {preview.issues?.length ? (
            <>
              <h3 className="mt-4 text-label font-semibold uppercase text-ink-secondary">Pendencias</h3>
              <ul className="mt-1 list-disc pl-4 text-table text-ink-secondary">
                {preview.issues.slice(0, 8).map((issue, i) => (
                  <li key={`${issue.rowNumber}-${i}`}>linha {issue.rowNumber}: {issue.message}</li>
                ))}
              </ul>
            </>
          ) : null}

          {preview.duplicates?.length ? (
            <>
              <h3 className="mt-4 text-label font-semibold uppercase text-ink-secondary">Possiveis duplicidades</h3>
              <ul className="mt-1 list-disc pl-4 text-table text-ink-secondary">
                {preview.duplicates.slice(0, 8).map((dup, i) => (
                  <li key={`${dup.rowNumber}-${i}`}>linha {dup.rowNumber} ({dup.tradeName}): {dup.reason}</li>
                ))}
              </ul>
            </>
          ) : null}

          <Banner tone="warn">
            Clientes sem coordenada confiavel sao importados como PENDENTES de geolocalizacao — nenhuma coordenada e inventada.
            Cabecalhos existentes nunca sao sobrescritos sem regra explicita.
          </Banner>
        </div>
      ) : null}
    </Panel>
  );
}
