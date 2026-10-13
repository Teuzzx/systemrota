'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Banner, buttonClass, ErrorBlock, Field, inputClass, LoadingBlock, Panel } from '@/components/ui';
import { formatDistance, formatDuration } from '@/lib/format';

interface JourneyReport {
  rowCount: number;
  totals: {
    journeys: number;
    distanceM: number;
    concluded: number;
    notDone: number;
    serviceS: number;
    travelS: number;
    averageServiceS: number | null;
    medianServiceS: number | null;
    serviceSampleSize: number;
  };
  note: string;
  rows: Array<{
    journeyId: string;
    data: string;
    motorista: string;
    rota: string;
    distanciaGpsM: number;
    clientesPlanejados: number;
    clientesConcluidos: number;
    clientesNaoAtendidos: number;
    tempoAtendimentoS: number;
    tempoDeslocamentoS: number;
    tempoNaoClassificadoS: number;
  }>;
}

interface FuelRow {
  journeyId: string;
  motorista: string;
  veiculo: string | null;
  distanciaKm: number;
  litrosEstimados: number | null;
  custoEstimado: number | null;
  confianca: string;
  isEstimate: true;
}

/** TELA 8 — RELATORIOS. Sempre derivados de dados persistidos. */
export default function RelatoriosPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<JourneyReport | null>(null);
  const [fuel, setFuel] = useState<FuelRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', new Date(from).toISOString());
    if (to) p.set('to', new Date(to).toISOString());
    return p;
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = params().toString();
      const [journeys, fuelReport] = await Promise.all([
        api.get<JourneyReport>(`/reports/journeys?${query}`),
        api.get<{ rows: FuelRow[] }>(`/reports/fuel?${query}`),
      ]);
      setReport(journeys);
      setFuel(fuelReport.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar relatorio.');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { void load(); }, [load]);

  const query = params().toString();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-body font-semibold text-ink">Relatorios</h1>
        <p className="text-table text-ink-secondary">
          Todos os numeros vem de eventos persistidos. Estimativas sao rotuladas como estimativa.
        </p>
      </header>

      <Panel title="Filtros e exportacao">
        <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <Field label="De"><input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Ate"><input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex items-end">
            <button type="button" className={buttonClass} onClick={() => void load()}>Gerar</button>
          </div>
          <div className="flex items-end gap-2">
            <a className={buttonClass} href={`/api/reports/journeys.csv?${query}`} download>CSV</a>
            <a className={buttonClass} href={`/api/reports/journeys.xlsx?${query}`} download>XLSX</a>
          </div>
        </div>
      </Panel>

      {error ? <ErrorBlock message={error} onRetry={() => void load()} /> : null}
      {loading ? <LoadingBlock label="Gerando relatorio" /> : null}

      {report ? (
        <>
          <section aria-label="Totais do periodo" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-md border border-border-subtle bg-surface p-4">
              <div className="text-label uppercase text-ink-secondary">Jornadas</div>
              <div className="tabular mt-2 text-metric font-semibold text-ink">{report.totals.journeys}</div>
              <div className="mt-1 text-body text-ink-secondary">{report.rowCount} linhas detalhadas</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-surface p-4">
              <div className="text-label uppercase text-ink-secondary">Distancia</div>
              <div className="tabular mt-2 text-metric font-semibold text-ink">{formatDistance(report.totals.distanceM)}</div>
              <div className="mt-1 text-body text-ink-secondary">por GPS (estimativa)</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-surface p-4">
              <div className="text-label uppercase text-ink-secondary">Atendimento</div>
              <div className="tabular mt-2 text-metric font-semibold text-ink">{formatDuration(report.totals.serviceS)}</div>
              <div className="mt-1 text-body text-ink-secondary">
                media {formatDuration(report.totals.averageServiceS)} ({report.totals.serviceSampleSize} amostras)
              </div>
            </div>
            <div className="rounded-md border border-border-subtle bg-surface p-4">
              <div className="text-label uppercase text-ink-secondary">Visitas nao realizadas</div>
              <div className="tabular mt-2 text-metric font-semibold text-ink">{report.totals.notDone}</div>
              <div className="mt-1 text-body text-ink-secondary">{report.totals.concluded} concluidas</div>
            </div>
          </section>

          <Banner tone="warn">{report.note}</Banner>

          <Panel title="Detalhamento por jornada">
            <ul className="divide-y divide-border-subtle">
              {report.rows.map((row) => (
                <li key={row.journeyId} className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-table">
                  <div className="col-span-2 tabular text-ink-secondary">{row.data.slice(0, 10)}</div>
                  <div className="col-span-2 truncate text-ink">{row.motorista}</div>
                  <div className="col-span-1 tabular text-ink-secondary">{row.rota}</div>
                  <div className="col-span-2 tabular text-ink-secondary">{formatDistance(row.distanciaGpsM)}</div>
                  <div className="col-span-2 tabular text-ink-secondary">
                    {row.clientesConcluidos}/{row.clientesPlanejados} · {row.clientesNaoAtendidos} nao realizados
                  </div>
                  <div className="col-span-3 tabular text-ink-secondary">
                    {formatDuration(row.tempoAtendimentoS)} atend. · {formatDuration(row.tempoDeslocamentoS)} desloc. ·{' '}
                    {formatDuration(row.tempoNaoClassificadoS)} sem classificacao
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Planejamento de combustivel" description="Estimativa — nao e despesa registrada nem leitura de hodometro">
            {!fuel || fuel.length === 0 ? (
              <p className="px-4 py-6 text-body text-ink-secondary">Sem jornadas finalizadas no periodo.</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {fuel.map((row) => (
                  <li key={row.journeyId} className="grid grid-cols-12 items-center gap-2 px-4 py-2 text-table">
                    <div className="col-span-3 truncate text-ink">{row.motorista}</div>
                    <div className="col-span-2 tabular text-ink-secondary">{row.veiculo ?? 'sem veiculo'}</div>
                    <div className="col-span-2 tabular text-ink-secondary">{formatDistance(row.distanciaKm * 1000)}</div>
                    <div className="col-span-2 tabular text-ink-secondary">
                      {row.litrosEstimados !== null ? `${row.litrosEstimados} L` : 'sem consumo cadastrado'}
                    </div>
                    <div className="col-span-2 tabular text-ink-secondary">
                      {row.custoEstimado !== null ? `R$ ${row.custoEstimado.toFixed(2)}` : '--'}
                    </div>
                    <div className="col-span-1 text-label uppercase text-ink-muted">{row.confianca}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
