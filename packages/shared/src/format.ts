/**
 * Formatadores puros compartilhados entre web e Android.
 * Idioma: pt-BR. Fuso operacional padrao do Brasil (America/Sao_Paulo).
 */

const TZ = 'America/Sao_Paulo';

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** 3725 -> "1h 02m"; 180 -> "3m"; null -> "--". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Idade do dado em linguagem de operacao: "agora", "ha 3 min", "ha 2 h 10 min". */
export function formatDataAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'sem dado';
  if (seconds < 45) return 'agora';
  if (seconds < 3600) return `ha ${Math.floor(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h < 24) return m > 0 ? `ha ${h}h ${String(m).padStart(2, '0')}min` : `ha ${h}h`;
  const d = Math.floor(h / 24);
  return `ha ${d}d ${h % 24}h`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '--';
  const m = Math.max(0, meters);
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km).toLocaleString('pt-BR')} km`;
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/** "Rota R1" vs "rota" em textos genericos. */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
