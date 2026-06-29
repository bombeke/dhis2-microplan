import React, { useEffect, useRef } from 'react';
// @dhis2/maps-gl is the DHIS2 Maps rendering engine (wrapper over Mapbox/MapLibre
// GL). Its default export is the `Map` class; layer types include tileLayer,
// boundary, geoJson, choropleth, clientCluster, donutCluster, events, markers.
import D2Map from '@dhis2/maps-gl';
import bbox from '@turf/bbox';
import type { Settlement, FlagResult, TrackerPoint } from '../types';
import type { Basemap, OverlayToggles } from '../lib/basemaps';

/**
 * Map rendered with the official DHIS2 Maps engine (@dhis2/maps-gl) rather than
 * raw MapLibre, so it shares the exact layer sources DHIS2 Maps app uses:
 *  - tileLayer   → OSM basemap (swap for your configured DHIS2 basemap)
 *  - geoJson     → settlement polygons (one layer per active microplan)
 *  - boundary    → org-unit boundary context
 *  - donutCluster→ tracker/event points, grouped by program stage
 *  - geoJson     → flagged (out-of-bounds) points, styled red
 *
 * Each uploaded microplan contributes its own settlement + point layers, so the
 * map filters (user / period / level / org unit) simply choose which microplans'
 * layers are mounted.
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

const featureFromSettlement = (s: Settlement) => ({
  type: 'Feature' as const,
  id: s.id,
  geometry: s.geometry,
  properties: {
    id: s.id,
    name: s.name,
    population: s.population ?? null,
    ward: s.ward,
  },
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
    flagged,
  },
});

export const Dhis2Map: React.FC<{
  microplans: MicroplanLayerData[];
  basemap?: Basemap;
  overlays?: OverlayToggles;
}> = ({ microplans, basemap, overlays }) => {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerObjsRef = useRef<any[]>([]);
  const basemapObjRef = useRef<any>(null);

  const ov: OverlayToggles =
    overlays ?? { settlements: true, points: true, flagged: true, boundaries: false };

  // init the DHIS2 map once
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new (D2Map as any)(ref.current, {
      // start centred on Nigeria
      center: [8.6753, 9.082],
      zoom: 5.5,
    });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // basemap layer — swap live whenever the chosen basemap changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // remove previous basemap
      if (basemapObjRef.current) {
        try {
          basemapObjRef.current.removeFrom?.(map);
        } catch {
          /* noop */
        }
        basemapObjRef.current = null;
      }
      const cfg = basemap?.config;
      if (!cfg) return; // "No basemap" choice
      const layer = map.createLayer({
        type: 'tileLayer',
        url: cfg.url,
        attribution: cfg.attribution,
        subdomains: cfg.subdomains,
        maxZoom: cfg.maxZoom,
      });
      layer.addTo(map);
      // keep the basemap beneath overlays
      layer.setIndex?.(0);
      basemapObjRef.current = layer;
    };

    if (map.styleIsLoaded?.()) apply();
    else map.on('ready', apply);
    return () => map.off?.('ready', apply);
  }, [basemap]);

  // (re)build overlay layers whenever the active microplans change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const mount = () => {
      // tear down previous overlays
      for (const l of layerObjsRef.current) {
        try {
          l.removeFrom?.(map);
        } catch {
          /* noop */
        }
      }
      layerObjsRef.current = [];

      const allSettlementFeatures: any[] = [];

      for (const mp of microplans) {
        // settlement polygons → DHIS2 geoJson layer
        if (ov.settlements && mp.settlements.length) {
          const data = mp.settlements.map(featureFromSettlement);
          allSettlementFeatures.push(...data);
          const layer = map.createLayer({
            type: 'geoJson',
            data,
            style: {
              color: '#0c8f7d',
              weight: 1,
              fillColor: '#2bb5a0',
              fillOpacity: 0.18,
            },
          });
          layer.addTo(map);
          layerObjsRef.current.push(layer);
        }

        // in-bounds points → donutCluster grouped by stage
        const inBounds = ov.points
          ? mp.flags.filter((f) => f.inside).map((f) => pointFeature(f.point, false))
          : [];
        if (inBounds.length) {
          const cluster = map.createLayer({
            type: 'donutCluster',
            data: inBounds,
            groups: Object.entries(STAGE_COLORS)
              .filter(([k]) => k !== 'default')
              .map(([name, color]) => ({ name, color })),
            radius: 60,
          });
          cluster.addTo(map);
          layerObjsRef.current.push(cluster);
        }

        // flagged points → red geoJson layer (kept separate for emphasis)
        const flagged = ov.flagged
          ? mp.flags.filter((f) => !f.inside).map((f) => pointFeature(f.point, true))
          : [];
        if (flagged.length) {
          const layer = map.createLayer({
            type: 'geoJson',
            data: flagged,
            style: { color: '#ef4444', radius: 5, fillColor: '#ef4444', fillOpacity: 0.85 },
          });
          layer.addTo(map);
          layerObjsRef.current.push(layer);
        }
      }

      // fit to all settlements in view
      if (allSettlementFeatures.length) {
        const b = bbox({ type: 'FeatureCollection', features: allSettlementFeatures });
        try {
          map.fitBounds(
            [
              [b[0], b[1]],
              [b[2], b[3]],
            ],
            { padding: 50, maxZoom: 12 }
          );
        } catch {
          /* fitBounds may throw before style load; ignore */
        }
      }
    };

    if (map.styleIsLoaded?.()) mount();
    else map.on('ready', mount);

    return () => {
      map.off?.('ready', mount);
    };
  }, [microplans, ov.settlements, ov.points, ov.flagged, ov.boundaries]);

  return <div ref={ref} className="mapview" style={{ height: '70vh', width: '100%' }} />;
};
