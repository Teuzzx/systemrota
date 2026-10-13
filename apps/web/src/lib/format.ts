/**
 * Funcoes puras de apresentacao (testadas sem DOM).
 * Regra do DESIGN_DNA: numero nunca aparece sozinho; estas funcoes sempre
 * produzem rotulo + contexto.
 */
import type { Freshness } from './types';

const TZ = 'America/Sao_Paulo';

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
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

/** Idade do dado em linguagem de operacao. */
export function formatDataAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'sem dado';
  if (seconds < 45) return 'agora';
  if (seconds < 3600) return `ha ${Math.floor(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h < 24) return m > 0 ? `ha ${h}h ${String(m).padStart(2, '0')}min` : `ha ${h}h`;
  return `ha ${Math.floor(h / 24)}d ${h % 24}h`;
}

export type Tone = 'ok' | 'progress' | 'warn' | 'critical' | 'neutral';

export const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-status-ok bg-status-ok-dim',
  progress: 'text-status-progress bg-status-progress-dim',
  warn: 'text-status-warn bg-status-warn-dim',
  critical: 'text-status-critical bg-status-critical-dim',
  neutral: 'text-status-neutral bg-status-neutral-dim',
};

/**
 * Traduz o status de dominio para rotulo curto. O rotulo e obrigatorio:
 * status nunca e comunicado so por cor.
 */
export function visitStatusLabel(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'PLANEJADA': return { label: 'PLANEJADA', tone: 'neutral' };
    case 'EM_DESLOCAMENTO': return { label: 'A CAMINHO', tone: 'progress' };
    case 'CHEGADA_REGISTRADA': return { label: 'CHEGOU', tone: 'progress' };
    case 'EM_ATENDIMENTO': return { label: 'EM ATENDIMENTO', tone: 'progress' };
    case 'CONCLUIDA': return { label: 'CONCLUIDA', tone: 'ok' };
    case 'NAO_REALIZADA': return { label: 'NAO REALIZADA', tone: 'warn' };
    case 'CANCELADA': return { label: 'CANCELADA', tone: 'neutral' };
    default: return { label: status || 'SEM DADO', tone: 'neutral' };
  }
}

export function journeyStatusLabel(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'EM_ANDAMENTO': return { label: 'EM ANDAMENTO', tone: 'progress' };
    case 'PAUSADA': return { label: 'PAUSADA', tone: 'warn' };
    case 'FINALIZADA': return { label: 'FINALIZADA', tone: 'ok' };
    case 'CANCELADA': return { label: 'CANCELADA', tone: 'neutral' };
    default: return { label: status || 'SEM DADO', tone: 'neutral' };
  }
}

export function routeStatusLabel(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'PLANEJADA': return { label: 'PLANEJADA', tone: 'neutral' };
    case 'ATRIBUIDA': return { label: 'ATRIBUIDA', tone: 'progress' };
    case 'PUBLICADA': return { label: 'PUBLICADA', tone: 'progress' };
    case 'EM_EXECUCAO': return { label: 'EM EXECUCAO', tone: 'progress' };
    case 'PAUSADA': return { label: 'PAUSADA', tone: 'warn' };
    case 'CONCLUIDA': return { label: 'CONCLUIDA', tone: 'ok' };
    case 'CANCELADA': return { label: 'CANCELADA', tone: 'warn' };
    case 'ARQUIVADA': return { label: 'ARQUIVADA', tone: 'neutral' };
    default: return { label: status || 'SEM DADO', tone: 'neutral' };
  }
}

export function severityTone(severity: string): Tone {
  if (severity === 'CRITICO') return 'critical';
  if (severity === 'AVISO') return 'warn';
  return 'progress';
}

export function geocodeTone(status: string): { label: string; tone: Tone } {
  switch (status) {
    case 'VALIDADO': return { label: 'COORDENADA OK', tone: 'ok' };
    case 'PENDENTE': return { label: 'REVISAR', tone: 'warn' };
    case 'INVALIDO': return { label: 'COORDENADA INVALIDA', tone: 'critical' };
    default: return { label: 'SEM COORDENADA', tone: 'neutral' };
  }
}

export function freshnessTone(freshness: Freshness): Tone {
  switch (freshness) {
    case 'ATUAL': return 'ok';
    case 'PARCIALMENTE_ATUALIZADO': return 'warn';
    case 'DESATUALIZADO': return 'critical';
    default: return 'neutral';
  }
}
