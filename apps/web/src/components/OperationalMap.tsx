'use client';

import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { DriverPosition } from '@/lib/types';
import { formatDataAge } from '@/lib/format';
import { activeTileProvider, OPERACAO_CENTER } from '@/lib/map/providers';
import {
  boundsOf, describeGeometrySource, isDegenerateBounds, sanitizePath, toLatLon,
  type LatLon,
} from '@/lib/map/geometry';

/**
 * Mapa operacional sobre Leaflet + OpenStreetMap.
 *
 * Decisoes que valem registro:
 *
 * 1. **CircleMarker em vez de Marker.** O pino padrao do Leaflet depende de
 *    arquivos PNG resolvidos por caminho em tempo de build, o que quebra em
 *    bundlers. CircleMarker e SVG puro, nao tem asset e herda a paleta do
 *    painel.
 *
 * 2. **Nada e desenhado sem coordenada real.** Marcador so aparece quando o
 *    registro tem lat/lng valido. Ausente vira "pendente de geolocalizacao" na
 *    lista, nunca um ponto inventado no mapa.
 *
 * 3. **Trajado distingue planejamento de registro** — tracejado vs. solido —
 *    e distingue malha viaria de linha reta, conforme `geometryNetworkBased`.
 */

export type MarkerStatus = 'ok' | 'progress' | 'warn' | 'neutral' | 'critical';

export interface MapStop {
  id: string;
  latitude: number | null;
  longitude: number | null;
  status: MarkerStatus;
  label: string;
  sequence?: number;
  isDemo?: boolean;
}

/** Origem da geometria recebida da API. */
export interface GeometrySource {
  networkBased: boolean;
  provider: string;
}

/** Aplica zoom automatico quando o conjunto de pontos muda. */
function FitToPoints({ points }: { points: LatLon[] }) {
  const map = useMap();
  const bounds = useMemo(() => boundsOf(points), [points]);

  useEffect(() => {
    if (!bounds || bounds === undefined) return;
    if (isDegenerateBounds(bounds)) {
      // Um unico ponto nao tem area; zoom fixo evita divisao por zero.
      const first = points[0];
      if (first) map.setView([first.latitude, first.longitude], 14, { animate: false });
      return;
    }
    map.fitBounds(
      [
        [bounds.minLat, bounds.minLng],
        [bounds.maxLat, bounds.maxLng],
      ],
      { padding: [48, 48], maxZoom: 16, animate: false },
    );
    // `bounds` e derivado de `points`; recriar so quando os pontos mudam.
  }, [map, bounds, points]);

  return null;
}

/** Centro inicial: area da operacao quando ainda nao ha ponto algum. */
function InitialView({ points }: { points: LatLon[] }) {
  const map = useMap();
  useEffect(() => {
    const first = points[0];
    if (!first) {
      map.setView([OPERACAO_CENTER.latitude, OPERACAO_CENTER.longitude], OPERACAO_CENTER.zoom, {
        animate: false,
      });
    }
  }, [map, points]);
  return null;
}

function statusColor(status: MarkerStatus): string {
  switch (status) {
    case 'ok': return 'var(--status-ok)';
    case 'progress': return 'var(--status-progress)';
    case 'warn': return 'var(--status-warn)';
    case 'critical': return 'var(--status-critical)';
    default: return 'var(--status-neutral)';
  }
}

export function OperationalMap({
  drivers, stops, track, plannedTrack, geometrySource, selectedDriverId, onSelectDriver,
}: {
  drivers: DriverPosition[];
  stops: MapStop[];
  track?: Array<{ latitude: number; longitude: number }>;
  plannedTrack?: Array<{ latitude: number; longitude: number }>;
  /** Quando ausente, o trajeto e tratado como estimativa (nunca como rota real). */
  geometrySource?: GeometrySource;
  selectedDriverId?: string | null;
  onSelectDriver?: (driverId: string) => void;
}) {
  const provider = activeTileProvider();

  const trackPath = useMemo(() => sanitizePath(track), [track]);
  const plannedPath = useMemo(() => sanitizePath(plannedTrack), [plannedTrack]);

  // Fonte da geometria: padrao e "nao basedada em rede", nunca assumida real.
  const source: GeometrySource = geometrySource ?? { networkBased: false, provider: 'desconhecido' };

  const allPoints = useMemo<LatLon[]>(() => {
    const fromDrivers = drivers
      .map((d) => toLatLon(d.latitude, d.longitude))
      .filter((p): p is LatLon => p !== null);
    const fromStops = stops
      .map((s) => toLatLon(s.latitude, s.longitude))
      .filter((p): p is LatLon => p !== null);
    return [...fromDrivers, ...fromStops, ...trackPath, ...plannedPath];
  }, [drivers, stops, trackPath, plannedPath]);

  const hasDemo = drivers.some((d) => d.driverName.includes('DEMO')) || stops.some((s) => s.isDemo);

  const center: [number, number] = allPoints.length > 0
    ? [allPoints[0].latitude, allPoints[0].longitude]
    : [OPERACAO_CENTER.latitude, OPERACAO_CENTER.longitude];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-md border border-border-subtle">
        <MapContainer
          center={center}
          zoom={OPERACAO_CENTER.zoom}
          scrollWheelZoom
          style={{ height: 520, width: '100%' }}
          className="bg-base"
        >
          {/*
            Atribuicao e obrigatoria por lei (ODbL) e por politica do OSM.
            Nao remover nem ocultar sem um provedor proprio com licenca propria.
          */}
          <TileLayer
            url={provider.url}
            attribution={provider.attribution}
            maxZoom={provider.maxZoom}
            // Passar `undefined` explicitamente SUBSTITUI o default do Leaflet
            // ('abc') em vez de deixar o default agir, e o _getSubdomain quebra
            // com "Cannot read properties of undefined". Por isso o fallback.
            subdomains={provider.subdomains ?? 'abc'}
          />

          <InitialView points={allPoints} />
          {allPoints.length > 0 ? <FitToPoints points={allPoints} /> : null}

          {/* Trajeto PLANEJADO: tracejado. Nunca confundido com o registrado. */}
          {plannedPath.length > 1 ? (
            <Polyline
              positions={plannedPath.map((p) => [p.latitude, p.longitude] as [number, number])}
              pathOptions={{ color: 'var(--status-neutral)', weight: 3, dashArray: '7 7', opacity: 0.9 }}
            />
          ) : null}

          {/* Trajeto REGISTRADO: solido. */}
          {trackPath.length > 1 ? (
            <Polyline
              positions={trackPath.map((p) => [p.latitude, p.longitude] as [number, number])}
              pathOptions={{
                color: 'var(--accent)',
                weight: 4,
                opacity: source.networkBased ? 1 : 0.55,
                // Linha reta e desenhada pontilhado-fino para nao parecer rota.
                dashArray: source.networkBased ? undefined : '2 8',
              }}
            />
          ) : null}

          {/* Clientes: circulo pequeno, sequencia quando houver. */}
          {stops.map((stop) => {
            const point = toLatLon(stop.latitude, stop.longitude);
            // Sem coordenada valida: nada e desenhado. O filtro acontece aqui.
            if (!point) return null;
            return (
              <CircleMarker
                key={stop.id}
                center={[point.latitude, point.longitude]}
                radius={6}
                pathOptions={{
                  color: 'var(--bg-base)',
                  weight: 2,
                  fillColor: statusColor(stop.status),
                  fillOpacity: 0.95,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  <span className="font-medium">
                    {stop.sequence ? `${stop.sequence}. ` : ''}{stop.label}
                  </span>
                  {stop.isDemo ? <span className="ml-1 text-xs uppercase">(DEMO)</span> : null}
                </Tooltip>
              </CircleMarker>
            );
          })}

          {/* Motoristas: circulo maior com anel quando o dado e antigo. */}
          {drivers.map((driver) => {
            const point = toLatLon(driver.latitude, driver.longitude);
            if (!point) return null;
            const stale =
              driver.freshness === 'DESATUALIZADO' || driver.freshness === 'PARCIALMENTE_ATUALIZADO';
            const tone: MarkerStatus =
              driver.freshness === 'ATUAL'
                ? 'ok'
                : driver.freshness === 'PARCIALMENTE_ATUALIZADO'
                  ? 'warn'
                  : driver.freshness === 'INDISPONIVEL'
                    ? 'neutral'
                    : 'critical';
            const selected = driver.driverId === selectedDriverId;
            return (
              <CircleMarker
                key={driver.driverId}
                center={[point.latitude, point.longitude]}
                radius={selected ? 10 : 8}
                pathOptions={{
                  color: selected ? 'var(--accent)' : stale ? statusColor(tone) : 'var(--bg-base)',
                  weight: selected || stale ? 3 : 2,
                  // Anel tracejado = dado desatualizado (mesma semantica do SVG antigo).
                  dashArray: stale ? '4 4' : undefined,
                  fillColor: statusColor(tone),
                  fillOpacity: 0.95,
                }}
                eventHandlers={onSelectDriver ? { click: () => onSelectDriver(driver.driverId) } : undefined}
              >
                <Tooltip direction="right" offset={[10, 0]} permanent={false}>
                  <span className="font-medium">{driver.driverName}</span>
                  <br />
                  <span className="text-xs">{formatDataAge(driver.dataAgeSeconds)}</span>
                  {driver.driverName.includes('DEMO') ? (
                    <><br /><span className="text-xs uppercase">(DEMO)</span></>
                  ) : null}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {hasDemo ? (
          <div className="pointer-events-none absolute left-3 top-3 z-[400] rounded-sm border border-status-warn bg-status-warn-dim px-2 py-1 text-label font-semibold uppercase text-status-warn">
            Dados de demonstracao
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label uppercase text-ink-secondary">
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-ok" />posicao atual</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-warn" />parcialmente atualizado</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-critical" />desatualizado</span>
        <span><span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-status-neutral" />cliente da rota</span>
        <span className="text-ink-muted">{describeGeometrySource(source.networkBased, source.provider)}</span>
        <span className="text-ink-muted">Base: {provider.label}</span>
      </div>
    </div>
  );
}