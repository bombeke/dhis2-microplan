// Core domain types shared across ingestion, search, mapping and flagging.

export type Coord = [number, number]; // [lng, lat] — GeoJSON order, always.

/** A row from the uploaded CSV/Excel microplan. */
export interface MicroplanRow {
  settlement: string; // "Nigeria settlements" column
  teamCode: string;
  ward: string;
  state: string;
  facilityName: string;
  week1: string;
  week2: string;
  week3: string;
  week4: string;
  week5: string;
}

/** Normalised settlement record after matching to a geometry source. */
export interface Settlement {
  id: string; // stable id (grid3 fid, orgUnit id, or hashed name)
  name: string;
  ward: string;
  wardId?: string;
  state: string;
  population?: number;
  source: GeoSourceKind;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  centroid: Coord;
}

/** A team's plan: which settlements it visits, and in which weeks. */
export interface TeamPlan {
  teamCode: string;
  ward: string;
  state: string;
  facilityName: string;
  // settlementId -> set of week numbers (1..5) in which the team visits it
  visits: Record<string, number[]>;
}

/** A data point pulled from tracker enrollments or program-stage events. */
export interface TrackerPoint {
  id: string;
  kind: 'enrollment' | 'event';
  programStage?: string;
  programStageName?: string;
  teamCode?: string;
  coordinate: Coord;
  name?: string;
  value?: number; // numeric metric rendered on the cluster
  attributes?: Record<string, string>;
}

/** Result of evaluating a point against assigned settlement polygons. */
export interface FlagResult {
  point: TrackerPoint;
  inside: boolean;
  matchedSettlementId?: string;
  nearestSettlementId?: string;
  distanceMeters?: number; // to nearest assigned settlement when outside
}

export type GeoSourceKind = 'grid3' | 'pmtiles' | 'orgunit';

export interface GeoSourceConfig {
  kind: GeoSourceKind;
  label: string;
  // GRID3/ArcGIS FeatureServer layer URL
  arcgisUrl?: string;
  // PMTiles archive URL + source-layer name
  pmtilesUrl?: string;
  pmtilesSourceLayer?: string;
  // DHIS2 orgUnit level holding settlement geometry
  orgUnitLevel?: number;
}

export interface Dhis2Period {
  id: string; // e.g. LAST_MONTH, THIS_MONTH, 202506
  name: string;
}
