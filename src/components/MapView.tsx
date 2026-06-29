import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import bbox from '@turf/bbox';
import { buildClusterLayers, clustersFor } from '../lib/clustering';
import type { Settlement, FlagResult, GeoSourceConfig } from '../types';

/**
 * MapLibre GL map. Settlement polygons render as a GeoJSON source; tracker /
 * event points render as Supercluster-driven circle layers, recomputed on
 * moveend so only on-screen clusters exist. Flagged (out-of-bounds) points
 * get a distinct red layer. PMTiles is wired via the protocol handler so a
 * locally-hosted settlement archive can stream as vector tiles.
 */
export const MapView: React.FC<{
  settlements: Map<string, Settlement>;
  flags: FlagResult[];
  geoSource: GeoSourceConfig;
  focusTeam: string | null;
}> = ({ settlements, flags, geoSource }) => {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // one-time init
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
      container: ref.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [8.6753, 9.082], // Nigeria
      zoom: 5.5,
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('settlements', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'settlements-fill',
        type: 'fill',
        source: 'settlements',
        paint: { 'fill-color': '#2bb5a0', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'settlements-line',
        type: 'line',
        source: 'settlements',
        paint: { 'line-color': '#0c8f7d', 'line-width': 1 },
      });

      map.addSource('clusters', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'clusters-circle',
        type: 'circle',
        source: 'clusters',
        paint: {
          'circle-color': [
            'case',
            ['get', 'flagged'], '#e8453c',
            ['match', ['get', 'layerKey'], 'enrollment', '#2f6df6', '#7a5cf0'],
          ],
          'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 1, 6, 100, 22],
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'clusters-count',
        type: 'symbol',
        source: 'clusters',
        layout: { 'text-field': ['get', 'sum'], 'text-size': 11 },
        paint: { 'text-color': '#fff' },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      maplibregl.removeProtocol('pmtiles');
    };
  }, []);

  // render polygons when settlements change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const features = [...settlements.values()].map((s) => ({
      type: 'Feature' as const,
      geometry: s.geometry,
      properties: { id: s.id, name: s.name, population: s.population ?? null },
    }));
    const src = map.getSource('settlements') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features });
    if (features.length) {
      const b = bbox({ type: 'FeatureCollection', features });
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 12 });
    }
  }, [settlements]);

  // recompute clusters on data change and on map movement
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layers = buildClusterLayers(flags);

    const update = () => {
      if (!map.isStyleLoaded()) return;
      const b = map.getBounds();
      const bb: [number, number, number, number] = [
        b.getWest(), b.getSouth(), b.getEast(), b.getNorth(),
      ];
      const zoom = map.getZoom();
      const features = layers.flatMap((layer) =>
        clustersFor(layer, bb, zoom).map((c: any) => ({
          ...c,
          properties: {
            ...c.properties,
            layerKey: layer.key.startsWith('stage') ? 'stage' : layer.key,
            flagged: layer.key === 'flagged',
            sum: c.properties.sum ?? c.properties.point_count ?? 1,
          },
        }))
      );
      const src = map.getSource('clusters') as maplibregl.GeoJSONSource | undefined;
      src?.setData({ type: 'FeatureCollection', features });
    };

    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [flags]);

  return <div ref={ref} className="mapview" style={{ height: '60vh', width: '100%' }} />;
};
