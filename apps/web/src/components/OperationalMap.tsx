'use client';

import { useMemo } from 'react';
import type { DriverPosition } from '@/lib/types';
import { formatDataAge } from '@/lib/format';

/**
 * Mapa operacional.
 *
 * Renderizador PADRAO: SVG deterministico, sem tile, sem chave, sem rede.
 * Funciona em qualquer rede - importante porque o provedor de mapas nao pode
 * ser assumido disponivel (ver docs/PENDENCIAS.md).
 *
 * Um `TileProvider` pode ser plugado (MapLibre/Mapbox) quando houver credencial:
 * a interface abaixo mantem a troca isolada deste componente.
 */
export interface TileProvider {
  readonly name: string;
  readonly requiresCredential: boolean;
  /** URL de estilo; quando ausente, usamos o renderizador offline. */
  styleUrl?: string;
}

export const OFFLINE_PROVIDER: TileProvider = {
  name: 'offline-svg',
  requiresCredential: false,
};

export interface MapMarker {
  id: string;
  latitude: number | null;
  longitude: number | null;
  kind: 'driver' | 'stop' | 'origin';
  status: 'ok' | 'progress' | 'warn' | 'neutral' | 'critical';
  label: string;
  ageSeconds?: number | null;
}

const COLOR: Record<MapMarker['status'], string> = {
  ok: 'var(--status-ok)',
  progress: 'var(--status-progress)',
  warn: 'var(--status-warn)',
  neutral: 'var(--status-neutral)',
  critical: 'var(--status-critical)',
};

const WIDTH = 900;
const HEIGHT = 520;
const PAD = 48;

/** Projecao equirretangular ajustada ao bounding box dos pontos. */
export function project(
  points: Array<{ latitude: number; longitude: number }>,
): (lat: number, lng: number) => { x: number; y: number } {
  if (points.length === 0) return () => ({ x: WIDTH / 2, y: HEIGHT / 2 });
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Degeneracao: um unico ponto (ou todos iguais) nao pode dividir por zero.
  const latSpan = Math.max(maxLat - minLat, 1e-6);
  const lngSpan = Math.max(maxLng - minLng, 1e-6);
  return (lat: number, lng: number) => ({
    x: PAD + ((lng - minLng) / lngSpan) * (WIDTH - PAD * 2),
    // Tela cresce para baixo; latitude cresce para cima.
    y: HEIGHT - PAD - ((lat - minLat) / latSpan) * (HEIGHT - PAD * 2),
  });
}

export function OperationalMap({
  drivers, stops, track, plannedTrack, provider = OFFLINE_PROVIDER, selectedDriverId, onSelectDriver,
}: {
  drivers: DriverPosition[];
  stops: Array<{ id: string; latitude: number | null; longitude: number | null; status: MapMarker['status']; label: string }>;
  track?: Array<{ latitude: number; longitude: number }>;
  plannedTrack?: Array<{ latitude: number; longitude: number }>;
  provider?: TileProvider;
  selectedDriverId?: string | null;
  onSelectDriver?: (driverId: string) => void;
}) {
  const projectPoint = useMemo(() => {
    const all = [
      ...drivers.map((d) => ({ latitude: d.latitude, longitude: d.longitude })),
      ...stops.filter((s) => s.latitude !== null).map((s) => ({ latitude: s.latitude as number, longitude: s.longitude as number })),
      ...(track ?? []),
      ...(plannedTrack ?? []),
    ];
    return project(all);
  }, [drivers, stops, track, plannedTrack]);

  const polyline = (points: Array<{ latitude: number; longitude: number }> | undefined) =>
    (points ?? []).map((p) => {
      const { x, y } = projectPoint(p.latitude, p.longitude);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

  const hasBaseLayer = Boolean(provider.styleUrl);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full rounded-md border border-border-subtle bg-base"
        role="img"
        aria-label="Mapa operacional com posicoes de motoristas e clientes da rota"
      >
        {hasBaseLayer ? null : (
          <g aria-hidden>
            {/* Grade discreta: serve de referencia sem inventar geografia. */}
            {Array.from({ length: 10 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(i * HEIGHT) / 10} x2={WIDTH} y2={(i * HEIGHT) / 10} stroke="var(--border-subtle)" strokeWidth={1} />
            ))}
            {Array.from({ length: 16 }, (_, i) => (
              <line key={`v${i}`} x1={(i * WIDTH) / 16} y1={0} x2={(i * WIDTH) / 16} y2={HEIGHT} stroke="var(--border-subtle)" strokeWidth={1} />
            ))}
          </g>
        )}

        {/* Trajeto PLANEJADO: tracejado. Nunca confundido com o registrado. */}
        {plannedTrack && plannedTrack.length > 1 ? (
          <polyline points={polyline(plannedTrack)} fill="none" stroke="var(--status-neutral)" strokeWidth={2} strokeDasharray="6 6" />
        ) : null}

        {/* Trajeto REGISTRADO: solido. */}
        {track && track.length > 1 ? (
          <polyline points={polyline(track)} fill="none" stroke="var(--accent)" strokeWidth={2} />
        ) : null}

        {/* Clientes: losango. */}
        {stops.map((stop) => {
          if (stop.latitude === null || stop.longitude === null) return null;
          const { x, y } = projectPoint(stop.latitude, stop.longitude);
          return (
            <polygon
              key={stop.id}
              points={`${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`}
              fill={COLOR[stop.status]}
              aria-label={`${stop.label} (${stop.status})`}
            >
              <title>{stop.label}</title>
            </polygon>
          );
        })}

        {/* Motoristas: circulo com anel. Anel tracejado = dado desatualizado. */}
        {drivers.map((driver) => {
          const { x, y } = projectPoint(driver.latitude, driver.longitude);
          const stale = driver.freshness === 'DESATUALIZADO' || driver.freshness === 'PARCIALMENTE_ATUALIZADO';
          const tone = driver.freshness === 'ATUAL' ? 'ok' : driver.freshness === 'PARCIALMENTE_ATUALIZADO' ? 'warn' : 'critical';
          const selected = driver.driverId === selectedDriverId;
          return (
            <g
              key={driver.driverId}
              onClick={() => onSelectDriver?.(driver.driverId)}
              className={onSelectDriver ? 'cursor-pointer' : undefined}
              role={onSelectDriver ? 'button' : undefined}
              tabIndex={onSelectDriver ? 0 : undefined}
              aria-label={`${driver.driverName}, ${formatDataAge(driver.dataAgeSeconds)}`}
            >
              {stale ? (
                <circle cx={x} cy={y} r={14} fill="none" stroke={COLOR[tone]} strokeWidth={2} strokeDasharray="4 4" />
              ) : null}
              <circle cx={x} cy={y} r={9} fill={COLOR[tone]} stroke={selected ? 'var(--accent)' : 'var(--bg-base)'} strokeWidth={2} />
              <text x={x + 14} y={y + 4} fontSize={11} fill="var(--text-primary)" fontFamily="'IBM Plex Mono', monospace">
                {driver.driverName}
              </text>
              <text x={x + 14} y={y + 17} fontSize={10} fill="var(--text-secondary)" fontFamily="'IBM Plex Mono', monospace">
                {formatDataAge(driver.dataAgeSeconds)}
              </text>
              <title>{`${driver.driverName} - ${formatDataAge(driver.dataAgeSeconds)}`}</title>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-label uppercase text-ink-secondary">
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-ok" />posicao atual</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-warn" />parcialmente atualizado</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-critical" />desatualizado</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-neutral" />trajeto planejado (tracejado)</span>
        <span><span aria-hidden className="mr-1 inline-block h-0.5 w-4 bg-accent" />trajeto registrado</span>
        <span className="text-ink-muted">
          Base cartografica: {provider.requiresCredential ? provider.name : 'offline (sem chave)'}
        </span>
      </div>
    </div>
  );
}
