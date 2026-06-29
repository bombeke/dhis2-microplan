import { PMTiles } from 'pmtiles';
import type { GeoSourceConfig, Settlement, Coord } from '../types';
import centroid from '@turf/centroid';

/**
 * Pluggable settlement-geometry providers. All three normalise to the same
 * `Settlement` shape so the rest of the app is source-agnostic. Choose the
 * source per-deployment in Settings; you can also fall back between them.
 */
export interface GeoProvider {
  /** Fetch settlement polygons intersecting a ward (preferred — bounded). */
  byWard(wardId: string, wardName: string): Promise<Settlement[]>;
}

const toCentroid = (g: GeoJSON.Geometry): Coord => {
  const c = centroid({ type: 'Feature', geometry: g, properties: {} });
  return c.geometry.coordinates as Coord;
};

/* ---------------------------------------------------------------- GRID3 / ArcGIS */

export class Grid3Provider implements GeoProvider {
  constructor(private cfg: GeoSourceConfig) {}

  async byWard(_wardId: string, wardName: string): Promise<Settlement[]> {
    const url = new URL(`${this.cfg.arcgisUrl}/query`);
    // ArcGIS REST: attribute filter by ward, return geometry as GeoJSON.
    url.searchParams.set('where', `ward_name='${wardName.replace(/'/g, "''")}'`);
    url.searchParams.set('outFields', '*');
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('resultRecordCount', '2000');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`GRID3 query failed: ${res.status}`);
    const fc = (await res.json()) as GeoJSON.FeatureCollection;

    return fc.features
      .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
      .map((f, i) => {
        const p = f.properties ?? {};
        const geometry = f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        return {
          id: String(p.fid ?? p.OBJECTID ?? `grid3:${wardName}:${i}`),
          name: String(p.settlement_name ?? p.name ?? 'Unknown'),
          ward: wardName,
          state: String(p.state_name ?? ''),
          population: p.population != null ? Number(p.population) : undefined,
          source: 'grid3' as const,
          geometry,
          centroid: toCentroid(geometry),
        };
      });
  }
}

/* ---------------------------------------------------------------- PMTiles (local) */

export class PmtilesProvider implements GeoProvider {
  private archive: PMTiles;
  constructor(private cfg: GeoSourceConfig) {
    this.archive = new PMTiles(cfg.pmtilesUrl!);
  }

  /**
   * PMTiles is consumed as a MapLibre vector source for rendering; for the
   * polygon set used in point-in-polygon flagging we query a companion index.
   * Here we expose the archive header so the map layer can attach directly,
   * and decode features lazily. For ward-bounded retrieval we rely on the
   * vector source's feature querying at render time (see MapView).
   */
  getArchive() {
    return this.archive;
  }

  async byWard(): Promise<Settlement[]> {
    // PMTiles polygons are read off the rendered tiles via
    // map.querySourceFeatures in MapView; nothing to fetch here.
    return [];
  }
}

/* ---------------------------------------------------------------- DHIS2 orgUnit */

export class OrgUnitProvider implements GeoProvider {
  constructor(
    private cfg: GeoSourceConfig,
    private engine: {
      query: (q: unknown) => Promise<any>;
    }
  ) {}

  async byWard(wardId: string, wardName: string): Promise<Settlement[]> {
    // Pull child orgUnits at the settlement level with geometry.
    const data = await this.engine.query({
      ous: {
        resource: 'organisationUnits',
        params: {
          filter: [`parent.id:eq:${wardId}`, `level:eq:${this.cfg.orgUnitLevel}`],
          fields: 'id,name,geometry,attributeValues[value,attribute[id]]',
          paging: 'false',
        },
      },
    });

    return (data.ous.organisationUnits ?? [])
      .filter((ou: any) => ou.geometry && ou.geometry.type !== 'Point')
      .map((ou: any) => {
        const geometry = ou.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
        const popAttr = (ou.attributeValues ?? []).find((a: any) =>
          /pop/i.test(a.attribute?.id ?? '')
        );
        return {
          id: ou.id,
          name: ou.name,
          ward: wardName,
          wardId,
          state: '',
          population: popAttr ? Number(popAttr.value) : undefined,
          source: 'orgunit' as const,
          geometry,
          centroid: toCentroid(geometry),
        };
      });
  }
}

export function makeProvider(
  cfg: GeoSourceConfig,
  engine?: { query: (q: unknown) => Promise<any> }
): GeoProvider {
  switch (cfg.kind) {
    case 'grid3':
      return new Grid3Provider(cfg);
    case 'pmtiles':
      return new PmtilesProvider(cfg);
    case 'orgunit':
      if (!engine) throw new Error('orgUnit provider needs a data engine');
      return new OrgUnitProvider(cfg, engine);
  }
}
