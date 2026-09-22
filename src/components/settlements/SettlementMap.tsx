import React, { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import bbox from '@turf/bbox';
import { getBasemap } from '../../lib/basemaps';
import type { GeoValue, GpsMethod } from '../../lib/gpsEditStore';
import type { Polygonal, SettlementRecord } from '../../lib/settlementRegistry';
import { hasGps } from '../../lib/settlementRows';
import { cn } from '../../lib/ui';

/**
 * The settlement map behind "View on map" and "Pick on map".
 *
 * maplibre-gl directly, like the main map (Dhis2Map), and for the same reason:
 * we own the style lifecycle, so every source and layer is added only once
 * the style is ready. The basemap is a single raster layer swapped in place
 * rather than a new style, which would wipe the data layers with it.
 *
 * What it draws:
 *  - the other settlements of the same ward, for context (grey);
 *  - the settlement's current point and polygon (blue);
 *  - the proposed point and polygon, if any (amber).
 *
 * Hovering any of them shows its details in a card that follows the pointer;
 * clicking pins the card. In pick mode three tools share the map: Point (the
 * default — click to place, then drag the marker to refine), Draw area
 * (press and drag to draw a freehand outline; releasing closes it) and Pan.
 * The pointer's coordinates are always shown at the bottom, which is what a
 * field supervisor reading a GPS off a phone actually needs.
 */

export type MapTool = 'point' | 'polygon' | 'pan';

export interface ContextSettlement {
  record: SettlementRecord;
  geo: GeoValue;
  status: string;
}

interface Props {
  focus: SettlementRecord;
  current: GeoValue;
  /** the proposal to show (view) or edit (pick) */
  proposed: GeoValue | null;
  focusStatus: string;
  context: ContextSettlement[];
  mode: 'view' | 'pick';
  tool?: MapTool;
  onToolChange?: (t: MapTool) => void;
  onChange?: (v: GeoValue, method: GpsMethod) => void;
}

const SRC = { ctx: 'ms-ctx', cur: 'ms-cur', prop: 'ms-prop', draw: 'ms-draw' } as const;
const BASE_OPTIONS = [
  { id: 'osm', label: 'Streets' },
  { id: 'imagery', label: 'Satellite' },
  { id: 'osmDark', label: 'Dark' },
] as const;

const NIGERIA: [number, number] = [8.6753, 9.082];

type Props2 = Record<string, string | number | boolean | null>;
interface HoverInfo {
  x: number;
  y: number;
  props: Props2;
  pinned: boolean;
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});

function geoFeatures(geo: GeoValue | null, props: Props2): GeoJSON.Feature[] {
  if (!geo) return [];
  const out: GeoJSON.Feature[] = [];
  if (geo.polygon) out.push({ type: 'Feature', geometry: geo.polygon, properties: { ...props, shape: 'polygon' } });
  if (hasGps(geo)) {
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [geo.lon!, geo.lat!] },
      properties: { ...props, shape: 'point' },
    });
  }
  return out;
}

const recordProps = (r: SettlementRecord, geo: GeoValue, status: string, kind: string): Props2 => ({
  kind,
  id: r.id,
  name: r.name || '(unnamed)',
  place: [r.ward, r.lga, r.state].filter(Boolean).join(' · '),
  households: r.households,
  source: r.source,
  lat: geo.lat,
  lon: geo.lon,
  hasPolygon: !!geo.polygon,
  status,
});

function setBasemap(map: maplibregl.Map, id: string) {
  const cfg = getBasemap(id).config;
  if (map.getLayer('basemap')) map.removeLayer('basemap');
  if (map.getSource('basemap')) map.removeSource('basemap');
  if (!cfg) return;
  const tiles = (cfg.subdomains?.length ? cfg.subdomains : ['a']).map((s) => cfg.url.replace('{s}', s));
  map.addSource('basemap', {
    type: 'raster',
    tiles,
    tileSize: 256,
    attribution: cfg.attribution ?? '',
    maxzoom: cfg.maxZoom ?? 19,
  });
  const first = map.getStyle().layers.find((l) => l.id !== 'bg')?.id;
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' }, first);
}

function setData(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

function addLayers(map: maplibregl.Map) {
  for (const id of Object.values(SRC)) map.addSource(id, { type: 'geojson', data: fc([]) });
  const isPoly = ['==', ['get', 'shape'], 'polygon'] as any;
  const isPoint = ['==', ['get', 'shape'], 'point'] as any;

  map.addLayer({ id: 'ctx-fill', type: 'fill', source: SRC.ctx, filter: isPoly, paint: { 'fill-color': '#64748b', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'ctx-line', type: 'line', source: SRC.ctx, filter: isPoly, paint: { 'line-color': '#64748b', 'line-width': 1 } });
  map.addLayer({
    id: 'ctx-pt',
    type: 'circle',
    source: SRC.ctx,
    filter: isPoint,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 5],
      'circle-color': '#64748b',
      'circle-opacity': 0.85,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  });

  map.addLayer({ id: 'cur-fill', type: 'fill', source: SRC.cur, filter: isPoly, paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.14 } });
  map.addLayer({ id: 'cur-line', type: 'line', source: SRC.cur, filter: isPoly, paint: { 'line-color': '#0284c7', 'line-width': 2 } });
  map.addLayer({
    id: 'cur-pt',
    type: 'circle',
    source: SRC.cur,
    filter: isPoint,
    paint: { 'circle-radius': 7, 'circle-color': '#0284c7', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
  });

  map.addLayer({ id: 'prop-fill', type: 'fill', source: SRC.prop, filter: isPoly, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.22 } });
  map.addLayer({
    id: 'prop-line',
    type: 'line',
    source: SRC.prop,
    filter: isPoly,
    paint: { 'line-color': '#d97706', 'line-width': 2.5, 'line-dasharray': [2, 1.2] },
  });
  map.addLayer({
    id: 'prop-pt',
    type: 'circle',
    source: SRC.prop,
    filter: isPoint,
    paint: { 'circle-radius': 8, 'circle-color': '#f59e0b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
  });

  map.addLayer({
    id: 'draw-line',
    type: 'line',
    source: SRC.draw,
    paint: { 'line-color': '#d97706', 'line-width': 3 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });
}

const HOVER_LAYERS = ['ctx-pt', 'ctx-fill', 'cur-pt', 'cur-fill', 'prop-pt', 'prop-fill'];

/** Drop points closer than ~1 m to their predecessor, and cap the ring size. */
function tidyRing(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-5 || Math.abs(last[1] - p[1]) > 1e-5) out.push(p);
  }
  const step = Math.ceil(out.length / 600);
  return step > 1 ? out.filter((_, i) => i % step === 0) : out;
}

export function polygonCentre(poly: Polygonal): { lat: number; lon: number } {
  const [minX, minY, maxX, maxY] = bbox(poly as any);
  return { lat: +((minY + maxY) / 2).toFixed(6), lon: +((minX + maxX) / 2).toFixed(6) };
}

export const SettlementMap: React.FC<Props> = ({
  focus,
  current,
  proposed,
  focusStatus,
  context,
  mode,
  tool = 'point',
  onToolChange,
  onChange,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);
  const [baseId, setBaseId] = useState<string>('osm');
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [locating, setLocating] = useState(false);

  // map handlers are registered once; they read the latest values from here
  const live = useRef({ tool, mode, proposed, onChange, pinned: false });
  live.current = { tool, mode, proposed, onChange, pinned: hover?.pinned ?? false };

  /* ---- init once ---- */
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef2f6' } }],
      },
      center: NIGERIA,
      zoom: 5.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.touchZoomRotate.disableRotation();

    map.on('load', () => {
      setBasemap(map, 'osm');
      addLayers(map);
      setReady(true);
    });

    // live pointer coordinates, written straight to the DOM — no re-render per move
    map.on('mousemove', (e) => {
      if (coordRef.current) {
        coordRef.current.textContent = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
      }
    });

    const showHover = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (live.current.pinned) return;
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = live.current.mode === 'pick' && live.current.tool !== 'pan' ? 'crosshair' : 'pointer';
      setHover({ x: e.point.x, y: e.point.y, props: f.properties as Props2, pinned: false });
    };
    const hideHover = () => {
      if (live.current.pinned) return;
      map.getCanvas().style.cursor = live.current.mode === 'pick' && live.current.tool !== 'pan' ? 'crosshair' : '';
      setHover(null);
    };
    for (const l of HOVER_LAYERS) {
      map.on('mousemove', l, showHover);
      map.on('mouseleave', l, hideHover);
    }

    map.on('click', (e) => {
      const { mode: m, tool: t, onChange: change, proposed: p } = live.current;
      if (m === 'pick' && t === 'point') {
        change?.(
          {
            lat: +e.lngLat.lat.toFixed(6),
            lon: +e.lngLat.lng.toFixed(6),
            polygon: p?.polygon ?? null,
          },
          'MAP_POINT'
        );
        return;
      }
      const hit = map.queryRenderedFeatures(e.point, { layers: HOVER_LAYERS })[0];
      if (hit) setHover({ x: e.point.x, y: e.point.y, props: hit.properties as Props2, pinned: true });
      else setHover(null);
    });

    // ---- freehand polygon ----
    let drawing: [number, number][] | null = null;
    let lastPx: maplibregl.Point | null = null;
    const start = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (live.current.mode !== 'pick' || live.current.tool !== 'polygon') return;
      if ('points' in e && e.points.length > 1) return; // pinch zoom
      e.preventDefault();
      drawing = [[e.lngLat.lng, e.lngLat.lat]];
      lastPx = e.point;
      setHover(null);
    };
    const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!drawing) return;
      if (lastPx && lastPx.dist(e.point) < 4) return;
      lastPx = e.point;
      drawing.push([e.lngLat.lng, e.lngLat.lat]);
      setData(map, SRC.draw, fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: drawing }, properties: {} }]));
    };
    const end = () => {
      if (!drawing) return;
      const ring = tidyRing(drawing);
      drawing = null;
      lastPx = null;
      setData(map, SRC.draw, fc([]));
      if (ring.length < 3) return;
      const polygon: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [[...ring.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]), [+ring[0][0].toFixed(6), +ring[0][1].toFixed(6)]]],
      };
      const p = live.current.proposed;
      const centre = polygonCentre(polygon);
      live.current.onChange?.(
        {
          // keep a point that is already there; otherwise use the outline's centre
          lat: p && hasGps(p) ? p.lat : centre.lat,
          lon: p && hasGps(p) ? p.lon : centre.lon,
          polygon,
        },
        'MAP_POLYGON'
      );
    };
    map.on('mousedown', start);
    map.on('touchstart', start);
    map.on('mousemove', move);
    map.on('touchmove', move);
    map.on('mouseup', end);
    map.on('touchend', end);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(boxRef.current);
    return () => {
      ro.disconnect();
      markerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ---- tool → interaction ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const drawingArea = mode === 'pick' && tool === 'polygon';
    if (drawingArea) map.dragPan.disable();
    else map.dragPan.enable();
    map.getCanvas().style.cursor = mode === 'pick' && tool !== 'pan' ? 'crosshair' : '';
  }, [mode, tool, ready]);

  /* ---- basemap ---- */
  useEffect(() => {
    if (ready && mapRef.current) setBasemap(mapRef.current, baseId);
  }, [baseId, ready]);

  /* ---- data ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const ctx: GeoJSON.Feature[] = [];
    for (const c of context) {
      if (c.record.id === focus.id) continue;
      ctx.push(...geoFeatures(c.geo, recordProps(c.record, c.geo, c.status, 'Nearby settlement')));
    }
    setData(map, SRC.ctx, fc(ctx));
  }, [ready, context, focus.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    setData(map, SRC.cur, fc(geoFeatures(current, recordProps(focus, current, focusStatus, 'Current'))));
  }, [ready, current, focus, focusStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // in pick mode the point is a draggable marker, so only the outline is a layer
    const shown = proposed && mode === 'pick' ? { ...proposed, lat: null, lon: null } : proposed;
    setData(map, SRC.prop, fc(geoFeatures(shown, recordProps(focus, proposed ?? current, focusStatus, 'Proposed'))));

    if (mode !== 'pick') return;
    if (proposed && hasGps(proposed)) {
      if (!markerRef.current) {
        const m = new maplibregl.Marker({ color: '#f59e0b', draggable: true });
        m.on('dragend', () => {
          const ll = m.getLngLat();
          const p = live.current.proposed;
          live.current.onChange?.(
            { lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6), polygon: p?.polygon ?? null },
            'MAP_POINT'
          );
        });
        markerRef.current = m;
      }
      markerRef.current.setLngLat([proposed.lon!, proposed.lat!]).addTo(map);
    } else {
      markerRef.current?.remove();
    }
  }, [ready, proposed, mode, focus, current, focusStatus]);

  /* ---- first fit ---- */
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || fitted.current) return;
    fitted.current = true;
    const target = proposed ?? current;
    const poly = target.polygon ?? current.polygon;
    if (poly) {
      const [a, b, c, d] = bbox(poly as any);
      map.fitBounds([a, b, c, d], { padding: 60, maxZoom: 17, duration: 0 });
    } else if (hasGps(target)) {
      map.jumpTo({ center: [target.lon!, target.lat!], zoom: 15 });
    } else if (hasGps(current)) {
      map.jumpTo({ center: [current.lon!, current.lat!], zoom: 15 });
    } else {
      const pts = context.filter((c) => hasGps(c.geo)).map((c) => [c.geo.lon!, c.geo.lat!]);
      if (pts.length) {
        const [a, b, c, d] = bbox({ type: 'MultiPoint', coordinates: pts } as any);
        map.fitBounds([a, b, c, d], { padding: 60, maxZoom: 14, duration: 0 });
      }
    }
  }, [ready, proposed, current, context]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = +pos.coords.latitude.toFixed(6);
        const lon = +pos.coords.longitude.toFixed(6);
        mapRef.current?.flyTo({ center: [lon, lat], zoom: 16 });
        if (mode === 'pick') onChange?.({ lat, lon, polygon: proposed?.polygon ?? null }, 'DEVICE');
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15_000 }
    );
  }, [mode, onChange, proposed?.polygon]);

  const toolBtn = (t: MapTool, label: string, icon: React.ReactNode, hint: string) => (
    <button
      key={t}
      type="button"
      title={hint}
      aria-pressed={tool === t}
      onClick={() => onToolChange?.(t)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold transition',
        tool === t ? 'bg-ink text-white shadow-card' : 'text-ink hover:bg-panel2'
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    // The wrapper is what's positioned, not the map container: maplibre stamps
    // `.maplibregl-map { position: relative }` on its container, and as
    // unlayered CSS that beats Tailwind's `absolute` (utilities live in a
    // cascade layer), which collapsed the container to 0px — a blank map.
    // A plain h-full/w-full container fills the wrapper whatever its position.
    <div className="absolute inset-0 overflow-hidden bg-panel2">
      <div ref={boxRef} className="h-full w-full" />

      {/* tools */}
      <div className="pointer-events-none absolute left-2 right-12 top-2 flex flex-wrap items-start gap-2">
        {mode === 'pick' && (
          <div className="pointer-events-auto flex rounded-lg border border-line bg-panel/95 p-0.5 shadow-float backdrop-blur" role="toolbar" aria-label="Map tools">
            {toolBtn(
              'point',
              'Point',
              <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>,
              'Click the map to place the settlement point; drag the marker to adjust'
            )}
            {toolBtn(
              'polygon',
              'Draw area',
              <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2} aria-hidden><path d="M4 16c2-6 5-10 9-11s6 3 5 6-5 3-6 6 3 4 6 3" strokeLinecap="round" /></svg>,
              'Press and drag to draw the settlement outline freehand; release to close it'
            )}
            {toolBtn(
              'pan',
              'Pan',
              <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden><path d="M13 2v7h2V4.5a1.5 1.5 0 0 1 3 0V13h-.1l.1 1.9c0 3.9-2.7 7.1-6.5 7.1-2.4 0-4.2-1.1-5.6-3.3L3 13.4l1.6-1.1 2.4 2.3V5.5a1.5 1.5 0 0 1 3 0V11h1V2h2z" /></svg>,
              'Move the map without placing anything'
            )}
          </div>
        )}
        <div className="pointer-events-auto flex rounded-lg border border-line bg-panel/95 p-0.5 shadow-float backdrop-blur" role="radiogroup" aria-label="Basemap">
          {BASE_OPTIONS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={baseId === b.id}
              onClick={() => setBaseId(b.id)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[12px] font-medium transition',
                baseId === b.id ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-panel2 hover:text-ink'
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          title={mode === 'pick' ? 'Use this device’s location as the point' : 'Go to my location'}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/95 px-2.5 py-1.5 text-[12px] font-medium text-ink shadow-float backdrop-blur transition hover:border-accent/60 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className={cn('size-4 fill-current', locating && 'animate-pulse')} aria-hidden>
            <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 3h-2.06A7 7 0 0 0 13 5.06V3h-2v2.06A7 7 0 0 0 5.06 11H3v2h2.06A7 7 0 0 0 11 18.94V21h2v-2.06A7 7 0 0 0 18.94 13H21v-2zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10z" />
          </svg>
          <span className="hidden sm:inline">{locating ? 'Locating…' : mode === 'pick' ? 'Use my location' : 'My location'}</span>
        </button>
      </div>

      {/* hint for the active tool */}
      {mode === 'pick' && (
        <div className="pointer-events-none absolute bottom-9 left-1/2 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1 text-center text-[11.5px] font-medium text-white shadow-float">
          {tool === 'point' && 'Click to place the point · drag the marker to adjust'}
          {tool === 'polygon' && 'Press and drag to draw the outline · release to close it'}
          {tool === 'pan' && 'Drag to move the map'}
        </div>
      )}

      {/* legend + pointer readout */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-panel/95 px-2.5 py-1.5 text-[11px] text-muted shadow-card backdrop-blur">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-sky-600 ring-2 ring-white" />Current</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-amber-500 ring-2 ring-white" />Proposed</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-slate-500" />Same ward</span>
        </div>
        <span className="rounded-md bg-panel/95 px-2 py-1 font-mono text-[11px] tabular-nums text-muted shadow-card backdrop-blur">
          <span ref={coordRef}>—</span>
        </span>
      </div>

      {hover && <HoverCard info={hover} box={boxRef.current} onClose={() => setHover(null)} />}
    </div>
  );
};

/* ---- the details card ---- */

const HoverCard: React.FC<{ info: HoverInfo; box: HTMLDivElement | null; onClose: () => void }> = ({
  info,
  box,
  onClose,
}) => {
  const p = info.props;
  const w = 256;
  const bw = box?.clientWidth ?? 800;
  const bh = box?.clientHeight ?? 600;
  // keep the card inside the map, flipping to the other side of the pointer near an edge
  const left = info.x + 16 + w > bw ? Math.max(8, info.x - 16 - w) : info.x + 16;
  const top = Math.min(Math.max(8, info.y - 20), Math.max(8, bh - 220));
  const coord = (v: unknown) => (typeof v === 'number' ? v.toFixed(6) : '—');
  const kindCls =
    p.kind === 'Proposed'
      ? 'bg-amber-100 text-amber-800'
      : p.kind === 'Current'
        ? 'bg-sky-100 text-sky-800'
        : 'bg-panel2 text-muted';
  return (
    <div
      className={cn(
        'absolute z-10 flex w-64 flex-col gap-1.5 rounded-xl border border-line bg-panel p-3 text-[12px] shadow-float',
        !info.pinned && 'pointer-events-none'
      )}
      style={{ left, top }}
      role={info.pinned ? 'dialog' : 'tooltip'}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={cn('mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', kindCls)}>
            {String(p.kind)}
          </span>
          <p className="m-0 truncate text-[13.5px] font-semibold text-ink">{String(p.name)}</p>
          <p className="m-0 truncate text-[11.5px] text-muted">{String(p.place || '—')}</p>
        </div>
        {info.pinned && (
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-muted hover:bg-panel2 hover:text-ink">
            ✕
          </button>
        )}
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted">Latitude</dt>
        <dd className="m-0 text-right font-mono tabular-nums text-ink">{coord(p.lat)}</dd>
        <dt className="text-muted">Longitude</dt>
        <dd className="m-0 text-right font-mono tabular-nums text-ink">{coord(p.lon)}</dd>
        <dt className="text-muted">Polygon</dt>
        <dd className="m-0 text-right text-ink">{p.hasPolygon ? 'Yes' : 'No'}</dd>
        <dt className="text-muted">Households</dt>
        <dd className="m-0 text-right tabular-nums text-ink">
          {typeof p.households === 'number' ? p.households.toLocaleString() : '—'}
        </dd>
        <dt className="text-muted">Source</dt>
        <dd className="m-0 truncate text-right text-ink">{p.source ? String(p.source) : '—'}</dd>
        <dt className="text-muted">Status</dt>
        <dd className="m-0 text-right text-ink">{String(p.status)}</dd>
      </dl>
      <p className="m-0 text-[10.5px] text-faint">ID {String(p.id)}</p>
    </div>
  );
};
