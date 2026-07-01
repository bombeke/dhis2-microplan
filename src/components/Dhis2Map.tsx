import React, { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import bbox from '@turf/bbox';
import type { Settlement, FlagResult, TrackerPoint } from '../types';
import type { Basemap, OverlayToggles } from '../lib/basemaps';
import type { SelectedOrgUnitLayers } from '../hooks/useSelectedOrgUnitLayers';

/**
 * Map rendered with **maplibre-gl directly** (replacing @dhis2/maps-gl, whose
 * async `layer.addTo()` raced the GL style load and threw
 * "Style is not done loading"). We replicate the maps-app MapView behaviour —
 * basemap + per-layer sources, clustered event points, coordinate/feature
 * popups, a fit-to-data bounds pass, and a loading mask — but own the style
 * lifecycle ourselves so every source/layer mutation runs only after the style
 * is ready. Clustering uses MapLibre's native GeoJSON clustering, which keeps
 * zooming smooth even with large point sets. Turf is used for bbox math.
 *
 * Layer model (mirrors the DHIS2 Maps app layer families):
 *  - raster basemap          (tileLayer equivalent)
 *  - settlements fill+line   (geoJson polygons)
 *  - clustered points        (clientCluster/donutCluster equivalent)
 *  - flagged points          (emphasis layer for out-of-bounds)
 */

const STAGE_COLORS: Record<string, string> = {
  enrollment: '#2f6df6',
  dose1: '#8b5cf6',
  dose2: '#f59e0b',
  default: '#7a5cf0',
};

export interface MicroplanLayerData {
  id: string;
  settlements: Settlement[];
  flags: FlagResult[];
}

const SRC = {
  settlements: 'mp-settlements',
  points: 'mp-points',
  flagged: 'mp-flagged',
  grid3: 'sel-grid3',
  weeks: 'sel-weeks',
  events: 'sel-events',
} as const;

const LYR = {
  settlementFill: 'mp-settlement-fill',
  settlementLine: 'mp-settlement-line',
  clusters: 'mp-clusters',
  clusterCount: 'mp-cluster-count',
  point: 'mp-point',
  flagged: 'mp-flagged-point',
  // selected-org-unit overlays
  grid3Line: 'sel-grid3-line',
  grid3Fill: 'sel-grid3-fill',
  weeksFill: 'sel-weeks-fill',
  weeksLine: 'sel-weeks-line',
  eventClusters: 'sel-event-clusters',
  eventClusterCount: 'sel-event-cluster-count',
  eventPoint: 'sel-event-point',
} as const;

// Per-week highlight colours (weeks 1..5) for the uploaded-settlement overlay.
const WEEK_COLORS: Record<number, string> = {
  1: '#f97316', // orange
  2: '#22c55e', // green
  3: '#3b82f6', // blue
  4: '#a855f7', // purple
  5: '#ec4899', // pink
};

const featureFromSettlement = (s: Settlement) => ({
  type: 'Feature' as const,
  id: s.id,
  geometry: s.geometry,
  properties: { id: s.id, name: s.name, population: s.population ?? null, ward: s.ward },
});

const pointFeature = (p: TrackerPoint, flagged: boolean) => ({
  type: 'Feature' as const,
  id: p.id,
  geometry: { type: 'Point' as const, coordinates: p.coordinate },
  properties: {
    id: p.id,
    name: p.name ?? p.id,
    stage: p.programStage ?? p.kind,
    teamCode: p.teamCode ?? '',
    color: flagged ? '#ef4444' : STAGE_COLORS[p.programStage ?? 'default'] ?? STAGE_COLORS.default,
    flagged: flagged ? 1 : 0,
  },
});

const fmtCoord = (n: number) => n.toFixed(5);
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
const rowHtml = (label: string, value: string) =>
  `<div class="map-popup__row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;

/** Create or update a plain (non-clustered) GeoJSON source. */
function upsertGeoJson(map: maplibregl.Map, id: string, features: GeoJSON.Feature[]) {
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
  const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (existing) existing.setData(data);
  else map.addSource(id, { type: 'geojson', data });
}

/** Build the basemap style object for maplibre from our Basemap config. */
function basemapStyle(basemap?: Basemap): maplibregl.StyleSpecification {
  const cfg = basemap?.config;
  const sources: maplibregl.StyleSpecification['sources'] = {};
  const layers: maplibregl.LayerSpecification[] = [];
  if (cfg) {
    const tiles = (cfg.subdomains?.length ? cfg.subdomains : ['a', 'b', 'c']).map((s) =>
      cfg.url.replace('{s}', s)
    );
    sources.basemap = {
      type: 'raster',
      tiles,
      tileSize: 256,
      attribution: cfg.attribution ?? '',
      maxzoom: cfg.maxZoom ?? 19,
    };
    layers.push({ id: 'basemap', type: 'raster', source: 'basemap' });
  }
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources,
    layers: layers.length
      ? layers
      : [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef2f6' } }],
  };
}

export const Dhis2Map: React.FC<{
  microplans: MicroplanLayerData[];
  basemap?: Basemap;
  overlays?: OverlayToggles;
  loading?: boolean;
  selected?: SelectedOrgUnitLayers | null;
}> = ({ microplans, basemap, overlays, loading, selected }) => {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const readyRef = useRef(false);

  const ov: OverlayToggles =
    overlays ?? { settlements: true, points: true, flagged: true, boundaries: false };

  /** Run a fn once the style is loaded; queue it on 'load' otherwise. */
  const whenReady = useCallback((map: maplibregl.Map, fn: () => void) => {
    if (map.isStyleLoaded()) fn();
    else map.once('load', fn);
  }, []);

  // ---- init once ----------------------------------------------------------
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyle(basemap),
      center: [8.6753, 9.082], // Nigeria
      zoom: 5.5,
      attributionControl: { compact: true },
      // smooth-zoom feel
      scrollZoom: true,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      readyRef.current = true;
    });

    // coordinate popup on empty-map click (maps-app behaviour)
    map.on('click', (e) => {
      // if a feature layer handled it, those handlers fire first and we bail
      const hit = map.queryRenderedFeatures(e.point, {
        layers: [LYR.settlementFill, LYR.point, LYR.flagged, LYR.clusters].filter((id) =>
          map.getLayer(id)
        ),
      });
      if (hit.length) return;
      openPopup(
        map,
        `<div class="map-popup__title">Coordinate</div>` +
          `<div class="map-popup__coord">${fmtCoord(e.lngLat.lat)}, ${fmtCoord(e.lngLat.lng)}</div>`,
        [e.lngLat.lng, e.lngLat.lat]
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPopup = useCallback((map: maplibregl.Map, html: string, lngLat: [number, number]) => {
    if (popupRef.current) popupRef.current.remove();
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(lngLat)
      .setHTML(`<div class="map-popup">${html}</div>`)
      .addTo(map);
  }, []);

  // ---- basemap swap (rebuild style, then re-add overlays) ------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // setStyle replaces sources/layers; we re-add overlay sources on styledata.
    map.setStyle(basemapStyle(basemap));
    const reAdd = () => {
      mountOverlays();
      map.off('styledata', reAdd);
    };
    map.on('styledata', reAdd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // ---- mount/update overlay sources + layers ------------------------------
  const mountOverlays = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const settlementFeatures: GeoJSON.Feature[] = [];
    const pointFeatures: GeoJSON.Feature[] = [];
    const flaggedFeatures: GeoJSON.Feature[] = [];

    for (const mp of microplans) {
      if (ov.settlements) settlementFeatures.push(...mp.settlements.map(featureFromSettlement));
      for (const f of mp.flags) {
        if (f.inside && ov.points) pointFeatures.push(pointFeature(f.point, false));
        else if (!f.inside && ov.flagged) flaggedFeatures.push(pointFeature(f.point, true));
      }
    }

    const upsertSource = (id: string, features: GeoJSON.Feature[], cluster = false) => {
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
      const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
      } else {
        map.addSource(id, {
          type: 'geojson',
          data,
          ...(cluster ? { cluster: true, clusterRadius: 60, clusterMaxZoom: 16 } : {}),
        });
      }
    };

    upsertSource(SRC.settlements, settlementFeatures);
    upsertSource(SRC.points, pointFeatures, true);
    upsertSource(SRC.flagged, flaggedFeatures);

    // settlement polygons
    if (!map.getLayer(LYR.settlementFill)) {
      map.addLayer({
        id: LYR.settlementFill,
        type: 'fill',
        source: SRC.settlements,
        paint: { 'fill-color': '#2bb5a0', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: LYR.settlementLine,
        type: 'line',
        source: SRC.settlements,
        paint: { 'line-color': '#0c8f7d', 'line-width': 1 },
      });
      map.on('click', LYR.settlementFill, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        openPopup(
          map,
          `<div class="map-popup__title">${escapeHtml(String(p.name ?? 'Settlement'))}</div>` +
            (p.ward ? rowHtml('Ward', String(p.ward)) : '') +
            (p.population != null && p.population !== 'null'
              ? rowHtml('Population', Number(p.population).toLocaleString())
              : '') +
            `<div class="map-popup__coord">${fmtCoord(e.lngLat.lat)}, ${fmtCoord(e.lngLat.lng)}</div>`,
          [e.lngLat.lng, e.lngLat.lat]
        );
      });
    }

    // clustered in-bounds points
    if (!map.getLayer(LYR.clusters)) {
      map.addLayer({
        id: LYR.clusters,
        type: 'circle',
        source: SRC.points,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#2f6df6',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 20, 100, 28],
        },
      });
      map.addLayer({
        id: LYR.clusterCount,
        type: 'symbol',
        source: SRC.points,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: LYR.point,
        type: 'circle',
        source: SRC.points,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 5,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });
      // zoom into a cluster on click (smooth easeTo)
      map.on('click', LYR.clusters, (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: [LYR.clusters] })[0];
        const clusterId = f?.properties?.cluster_id;
        const src = map.getSource(SRC.points) as maplibregl.GeoJSONSource;
        if (clusterId == null || !src) return;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (f.geometry as any).coordinates, zoom: zoom + 0.2, duration: 500 });
        });
      });
      map.on('click', LYR.point, (e) => {
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        openPopup(
          map,
          `<div class="map-popup__title">${escapeHtml(String(p.name))}</div>` +
            rowHtml('Stage', String(p.stage)) +
            (p.teamCode ? rowHtml('Team', String(p.teamCode)) : '') +
            `<div class="map-popup__coord">${fmtCoord(e.lngLat.lat)}, ${fmtCoord(e.lngLat.lng)}</div>`,
          [e.lngLat.lng, e.lngLat.lat]
        );
      });
      for (const id of [LYR.clusters, LYR.point]) {
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''));
      }
    }

    // flagged points (emphasis)
    if (!map.getLayer(LYR.flagged)) {
      map.addLayer({
        id: LYR.flagged,
        type: 'circle',
        source: SRC.flagged,
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': 6,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(239,68,68,0.35)',
        },
      });
      map.on('click', LYR.flagged, (e) => {
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        openPopup(
          map,
          `<div class="map-popup__title">${escapeHtml(String(p.name))}</div>` +
            rowHtml('Stage', String(p.stage)) +
            (p.teamCode ? rowHtml('Team', String(p.teamCode)) : '') +
            `<div class="map-popup__coord">${fmtCoord(e.lngLat.lat)}, ${fmtCoord(e.lngLat.lng)}</div>` +
            `<div class="map-popup__flag">⚠ Outside assigned settlement</div>`,
          [e.lngLat.lng, e.lngLat.lat]
        );
      });
      map.on('mouseenter', LYR.flagged, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', LYR.flagged, () => (map.getCanvas().style.cursor = ''));
    }

    // fit to data
    const allFeatures = [...settlementFeatures, ...pointFeatures, ...flaggedFeatures];
    if (allFeatures.length) {
      try {
        const b = bbox({ type: 'FeatureCollection', features: allFeatures });
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 13, duration: 600 });
      } catch {
        /* ignore degenerate bbox */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [microplans, ov.settlements, ov.points, ov.flagged, openPopup]);

  // re-mount overlays whenever data/toggles change (guarded by style load)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, mountOverlays);
  }, [mountOverlays, whenReady]);

  // ---- selected-org-unit overlays (GRID3 / week settlements / events) ------
  const mountSelected = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // Step 1 — GRID3 settlement extents as boundary-line polygons
    const grid3Features: GeoJSON.Feature[] = (selected?.grid3 ?? []).map((s) => ({
      type: 'Feature',
      id: s.id,
      geometry: s.geometry,
      properties: { id: s.id, extentType: s.extentType, areaSqm: s.areaSqm },
    }));
    upsertGeoJson(map, SRC.grid3, grid3Features);
    if (!map.getLayer(LYR.grid3Fill)) {
      map.addLayer({
        id: LYR.grid3Fill,
        type: 'fill',
        source: SRC.grid3,
        paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.06 },
      });
      map.addLayer({
        id: LYR.grid3Line,
        type: 'line',
        source: SRC.grid3,
        paint: { 'line-color': '#4338ca', 'line-width': 1.4 },
      });
      map.on('click', LYR.grid3Fill, (e) => {
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        openPopup(
          map,
          `<div class="map-popup__title">GRID3 settlement block</div>` +
            rowHtml('Type', String(p.extentType ?? '—')) +
            (p.areaSqm ? rowHtml('Area', `${Math.round(Number(p.areaSqm)).toLocaleString()} m²`) : '') +
            rowHtml('Block', String(p.id)),
          [e.lngLat.lng, e.lngLat.lat]
        );
      });
    }

    // Step 2 — uploaded settlements highlighted by week (one colour per week)
    const weekFeatures: GeoJSON.Feature[] = [];
    for (const ws of selected?.weekSettlements ?? []) {
      for (const s of ws.settlements) {
        weekFeatures.push({
          type: 'Feature',
          id: `${ws.week}:${s.id}`,
          geometry: s.geometry,
          properties: {
            id: s.id,
            name: s.name,
            week: ws.week,
            color: WEEK_COLORS[ws.week] ?? '#f59e0b',
            population: s.population ?? null,
          },
        });
      }
    }
    upsertGeoJson(map, SRC.weeks, weekFeatures);
    if (!map.getLayer(LYR.weeksFill)) {
      map.addLayer({
        id: LYR.weeksFill,
        type: 'fill',
        source: SRC.weeks,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 },
      });
      map.addLayer({
        id: LYR.weeksLine,
        type: 'line',
        source: SRC.weeks,
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
      });
      map.on('click', LYR.weeksFill, (e) => {
        const p = e.features?.[0]?.properties as any;
        if (!p) return;
        openPopup(
          map,
          `<div class="map-popup__title">${escapeHtml(String(p.name))}</div>` +
            rowHtml('Outreach week', `Week ${p.week}`) +
            (p.population != null && p.population !== 'null'
              ? rowHtml('Population', Number(p.population).toLocaleString())
              : ''),
          [e.lngLat.lng, e.lngLat.lat]
        );
      });
    }

    // Step 3 — DHIS2 event coordinates, clustered
    const eventFeatures: GeoJSON.Feature[] = (selected?.eventPoints ?? []).map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: p.coordinate },
      properties: { id: p.id, name: p.name ?? p.id, stage: p.programStage ?? p.kind },
    }));
    const evSrc = map.getSource(SRC.events) as maplibregl.GeoJSONSource | undefined;
    const evData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: eventFeatures };
    if (evSrc) evSrc.setData(evData);
    else
      map.addSource(SRC.events, {
        type: 'geojson',
        data: evData,
        cluster: true,
        clusterRadius: 60,
        clusterMaxZoom: 16,
      });
    if (!map.getLayer(LYR.eventClusters)) {
      map.addLayer({
        id: LYR.eventClusters,
        type: 'circle',
        source: SRC.events,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#0ea5e9',
          'circle-opacity': 0.85,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 20, 100, 28],
        },
      });
      map.addLayer({
        id: LYR.eventClusterCount,
        type: 'symbol',
        source: SRC.events,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: LYR.eventPoint,
        type: 'circle',
        source: SRC.events,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#0284c7',
          'circle-radius': 5,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.on('click', LYR.eventClusters, (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: [LYR.eventClusters] })[0];
        const clusterId = f?.properties?.cluster_id;
        const src = map.getSource(SRC.events) as maplibregl.GeoJSONSource;
        if (clusterId == null || !src) return;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (f.geometry as any).coordinates, zoom: zoom + 0.2, duration: 500 });
        });
      });
    }

    // fit to the selected unit's data on first population
    const fitFeatures = [...grid3Features, ...weekFeatures, ...eventFeatures];
    if (fitFeatures.length) {
      try {
        const b = bbox({ type: 'FeatureCollection', features: fitFeatures });
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 14, duration: 600 });
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, openPopup]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, mountSelected);
  }, [mountSelected, whenReady]);

  return (
    <div className="mapview-wrap" style={{ position: 'relative', height: '70vh', width: '100%' }}>
      <div ref={ref} className="mapview" style={{ height: '100%', width: '100%' }} />
      {loading && (
        <div className="map-mask">
          <div className="map-mask__spinner" />
        </div>
      )}
    </div>
  );
};
