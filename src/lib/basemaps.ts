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
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors © CARTO',
      subdomains: ['a', 'b', 'c', 'd'],
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
}

export const DEFAULT_OVERLAYS: OverlayToggles = {
  settlements: true,
  points: true,
  flagged: true,
  boundaries: false,
};
