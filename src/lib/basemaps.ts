import type maplibregl from 'maplibre-gl';

/**
 * Basemap registry — mirrors the default basemap choices offered by the DHIS2
 * Maps web app (OSM, OSM Light, OSM Dark, Bing-style imagery via Esri, plus a
 * "none" option). Each entry maps to a raster tile config the maplibre-gl
 * engine understands. Deployments can extend this list (e.g. with org-specific
 * WMS layers) without touching the map component.
 */
export interface Basemap {
  id: string;
  name: string;
  // tileLayer config passed straight to map.createLayer({ type: 'tileLayer', ... })
  config: {
    url: string;
    attribution?: string;
    subdomains?: string[];
    maxZoom?: number;
  } | null; // null = no basemap
  thumbnailColor: string; // small swatch in the picker
}

export const BASEMAPS: Basemap[] = [
  {
    id: 'osmLight',
    name: 'OSM Light',
    config: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      subdomains: ['a', 'b', 'c'],
      maxZoom: 19,
    },
    thumbnailColor: '#e8e8e8',
  },
  {
    id: 'osm',
    name: 'OSM Standard',
    config: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      subdomains: ['a', 'b', 'c'],
      maxZoom: 19,
    },
    thumbnailColor: '#aadaa0',
  },
  {
    id: 'osmDark',
    name: 'OSM Dark',
    config: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors © CARTO',
      subdomains: ['a', 'b', 'c', 'd'],
      maxZoom: 19,
    },
    thumbnailColor: '#1b232d',
  },
  {
    id: 'imagery',
    name: 'Satellite imagery',
    config: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri',
      maxZoom: 19,
    },
    thumbnailColor: '#3b5e3a',
  },
  {
    id: 'none',
    name: 'No basemap',
    config: null,
    thumbnailColor: '#0b1014',
  },
];

export const DEFAULT_BASEMAP_ID = 'osmLight';

export const getBasemap = (id: string): Basemap =>
  BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];

/**
 * Overlay layer toggles. These mirror the thematic/event/boundary layer
 * families in the Maps app; in this app they switch which of the microplan
 * overlays render.
 */
export interface OverlayToggles {
  settlements: boolean; // geoJson polygons
  points: boolean; // donutCluster tracker/event points
  flagged: boolean; // out-of-bounds points
  boundaries: boolean; // org-unit boundary context
  // Settlement boundaries resolved from the geoservice (team + user week
  // settlements) and the GRID3 extents. Toggling this draws/hides those
  // boundary outlines + fills without a refetch.
  settlementBoundaries: boolean;
}

export const DEFAULT_OVERLAYS: OverlayToggles = {
  settlements: false,
  points: true,
  flagged: true,
  boundaries: true,
  settlementBoundaries: true,
};

/** Build the basemap style object for maplibre from our Basemap config. */
export function basemapStyle(basemap?: Basemap): maplibregl.StyleSpecification {
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
