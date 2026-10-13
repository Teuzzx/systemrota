'use client';

import type { ReactNode } from 'react';
import type { Freshness } from '@/lib/types';
import {
  formatDataAge, freshnessTone, TONE_CLASS, type Tone,
} from '@/lib/format';

/** Ponto + rotulo. Rotulo e obrigatorio: status nunca so por cor. */
export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-sm px-2 py-1 text-label font-semibold uppercase ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

/**
 * MetricTile: numero + contexto obrigatorio.
 * Sem a linha de contexto o tile nao e renderizado (numero solto e enganoso).
 */
export function MetricTile({
  label, value, context, tone = 'neutral',
}: {
  label: string;
  value: string | number;
  context: string;
  tone?: Tone;
}) {
  const valueTone =
    tone === 'ok' ? 'text-status-ok'
      : tone === 'progress' ? 'text-status-progress'
        : tone === 'warn' ? 'text-status-warn'
          : tone === 'critical' ? 'text-status-critical'
            : 'text-ink';
  return (
    <div className="rounded-md border border-border-subtle bg-surface p-4">
      <div className="text-label font-semibold uppercase text-ink-secondary">{label}</div>
      <div className={`tabular mt-2 text-metric font-semibold ${valueTone}`}>{value}</div>
      <div className="mt-1 text-body text-ink-secondary">{context}</div>
    </div>
  );
}

/**
 * FreshnessStrip: idade do dado em tempo real.
 * Regra dura: posicao antiga nunca e apresentada como atual.
 */
export function FreshnessStrip({
  ageSeconds, freshness,
}: {
  ageSeconds: number | null;
  freshness: Freshness;
}) {
  const tone = freshnessTone(freshness);
  const bar = tone === 'ok' ? 'bg-status-ok' : tone === 'warn' ? 'bg-status-warn' : tone === 'critical' ? 'bg-status-critical' : 'bg-status-neutral';
  const text = tone === 'ok' ? 'ATUAL' : tone === 'warn' ? 'PARCIAL' : tone === 'critical' ? 'DESATUALIZADO' : 'SEM DADO';
  return (
    <span className="inline-flex items-center gap-2" title={`Idade do dado: ${formatDataAge(ageSeconds)}`}>
      <span aria-hidden className={`h-0.5 w-8 rounded-full ${bar}`} />
      <span className={`text-label font-semibold uppercase ${TONE_CLASS[tone]}`}>
        {text} · {formatDataAge(ageSeconds)}
      </span>
    </span>
  );
}

export function Panel({
  title, actions, children, description,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border-subtle bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div>
          <h2 className="text-body font-semibold text-ink">{title}</h2>
          {description ? <p className="text-table text-ink-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

export function DataTable<T>({
  columns, rows, emptyMessage, rowKey,
}: {
  columns: Array<{ key: string; header: string; align?: 'left' | 'right' }>;
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    // Vazio em painel de operacao significa zero, nao "nada aqui ainda".
    return (
      <p className="px-4 py-6 text-body text-ink-secondary">{emptyMessage}</p>
    );
  }
  return (
    <table className="w-full border-collapse text-table">
      <thead className="sticky top-0 bg-raised">
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={`border-b border-border-subtle px-4 py-2 text-label font-semibold uppercase text-ink-secondary ${
                column.align === 'right' ? 'text-right' : 'text-left'
              }`}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={rowKey(row)}
            className={index % 2 === 1 ? 'bg-raised/40 transition-colors duration-DEFAULT hover:bg-raised' : 'transition-colors duration-DEFAULT hover:bg-raised'}
          >
            {columns.map((column) => (
              <td
                key={column.key}
                className={`border-b border-border-subtle px-4 py-2 text-ink ${
                  column.align === 'right' ? 'tabular text-right' : 'text-left'
                }`}
              >
                {(row as Record<string, ReactNode>)[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Field({
  label, hint, children,
}: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-label font-semibold uppercase text-ink-secondary">{label}</span>
      {children}
      {hint ? <span className="text-table text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'rounded-sm border border-border-subtle bg-raised px-3 py-2 text-body text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none';

export const buttonClass =
  'rounded-sm border border-border-strong bg-raised px-3 py-2 text-body font-semibold text-ink transition-colors duration-DEFAULT hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50';

export const primaryButtonClass =
  'rounded-sm border border-accent bg-accent px-3 py-2 text-body font-semibold text-ink-inverse transition-colors duration-DEFAULT hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

export function Banner({
  tone = 'warn', children,
}: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`rounded-sm border px-4 py-3 text-body ${TONE_CLASS[tone]}`}>{children}</div>
  );
}

export function LoadingBlock({ label = 'Carregando dados do servidor' }: { label?: string }) {
  return (
    <div role="status" className="px-4 py-6 text-body text-ink-secondary">
      <span className="tabular">{label}...</span>
    </div>
  );
}

/**
 * Esqueleto de carregamento.
 * A forma imita a linha final do dado, evitando salto de layout quando o
 * conteudo chega. `aria-hidden`: quem anuncia o carregamento e o rotulo acima.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-sm bg-raised ${className}`}
      style={{ animationDuration: '1400ms' }}
    />
  );
}

export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <span className="sr-only" role="status">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/**
 * Barra de progresso de conclusao.
 *
 * Regra dura: quando nao ha dado (`null`) a barra NAO e desenhada. O operador
 * precisa distinguir "0%" de "ainda nao sei" — um zero sem contexto e enganoso.
 */
export function ProgressBar({
  pct, label, detail,
}: { pct: number | null | undefined; label: string; detail?: string }) {
  const known = pct !== null && pct !== undefined && Number.isFinite(pct);
  if (!known) {
    return (
      <div className="px-4 py-3">
        <div className="text-label font-semibold uppercase text-ink-secondary">{label}</div>
        <div className="mt-2 text-table text-ink-muted">Sem dado suficiente para calcular.</div>
      </div>
    );
  }
  const clamped = Math.min(100, Math.max(0, pct));
  const bar = clamped >= 80 ? 'bg-status-ok'
    : clamped >= 40 ? 'bg-status-progress'
      : clamped > 0 ? 'bg-status-warn'
        : 'bg-status-neutral';
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-label font-semibold uppercase text-ink-secondary">{label}</span>
        <span className="tabular text-body font-semibold text-ink">
          {clamped.toFixed(0).replace('.', ',')}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-raised"
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${clamped}%` }} />
      </div>
      {detail ? <p className="mt-1 text-table text-ink-muted">{detail}</p> : null}
    </div>
  );
}

/**
 * Estado de conexao do painel.
 * Distingue "parou" de "ainda nao ha jornada" — os dois estados sao diferentes
 * para quem despacha rota.
 */
export function ConnectionPill({
  state, lastUpdatedLabel,
}: { state: 'conectado' | 'reconectando' | 'offline'; lastUpdatedLabel?: string }) {
  const config = {
    conectado: { text: 'AO VIVO', tone: 'ok' as Tone },
    reconectando: { text: 'RECONECTANDO', tone: 'warn' as Tone },
    offline: { text: 'SEM CONEXAO', tone: 'critical' as Tone },
  }[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-sm border border-border-subtle px-2 py-1 ${TONE_CLASS[config.tone]}`}
      title={lastUpdatedLabel ? `Ultima atualizacao: ${lastUpdatedLabel}` : undefined}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full bg-current ${state === 'reconectando' ? 'animate-pulse' : ''}`}
      />
      <span className="text-label font-semibold uppercase">{config.text}</span>
      {lastUpdatedLabel ? (
        <span aria-hidden className="tabular text-label opacity-70">· {lastUpdatedLabel}</span>
      ) : null}
    </span>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 rounded-sm border border-status-critical bg-status-critical-dim px-4 py-3">
      <p className="text-body text-status-critical">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={`mt-3 ${buttonClass}`}>
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

export function EmptyBlock({ message }: { message: string }) {
  return <p className="px-4 py-6 text-body text-ink-secondary">{message}</p>;
}
