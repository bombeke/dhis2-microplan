import bbox from '@turf/bbox';

/**
 * GRID3 NGA Settlement Extents v4.0 access.
 *
 * IMPORTANT: the v4.0 FeatureServer has NO ward/state/settlement-name attribute
 * fields — its columns are block_id, country, iso3, extent_type, mgrs_code,
 * building metrics, composite_class, etc. So we cannot filter by `ward_name`.
 * Instead we filter SPATIALLY: take the selected org unit's geometry, compute
 * its bounding box, and query the FeatureServer for settlement blocks whose
 * geometry intersects that envelope. This works for any org-unit level (state,
 * LGA, ward, facility catchment) as long as the unit has geometry in DHIS2.
 */

const DEFAULT_GRID3_URL =
  'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/GRID3_NGA_settlement_extents_v4_0/FeatureServer/0';

export interface Grid3Settlement {
  id: string; // block_id
  extentType: string; // "Built-up Area" | "Small Settlement Area"
  areaSqm: number | null;
  compositeClass: string | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface Grid3FetchResult {
  settlements: Grid3Settlement[];
  exceededTransferLimit: boolean; // true if the server capped the result set
}

/** [minLng, minLat, maxLng, maxLat] envelope from any GeoJSON geometry. */
export function geometryToEnvelope(
  geometry: GeoJSON.Geometry
): [number, number, number, number] {
  return bbox({ type: 'Feature', geometry, properties: {} }) as [
    number,
    number,
    number,
    number
  ];
}

/**
 * Query GRID3 v4.0 for settlement blocks intersecting the given envelope.
 * Returns GeoJSON-normalised polygons. Paginates via resultOffset until the
 * server stops reporting exceededTransferLimit (bounded by maxPages).
 */
export async function fetchGrid3ByEnvelope(
  envelope: [number, number, number, number],
  opts?: { url?: string; maxPages?: number; pageSize?: number; signal?: AbortSignal }
): Promise<Grid3FetchResult> {
  const url = opts?.url ?? DEFAULT_GRID3_URL;
  const pageSize = opts?.pageSize ?? 2000;
  const maxPages = opts?.maxPages ?? 10; // cap to avoid pulling all of Nigeria
  const [minX, minY, maxX, maxY] = envelope;

  const settlements: Grid3Settlement[] = [];
  let offset = 0;
  let exceeded = false;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: 'block_id,extent_type,block_area_sqm,composite_class',
      geometry: JSON.stringify({
        xmin: minX,
        ymin: minY,
        xmax: maxX,
        ymax: maxY,
        spatialReference: { wkid: 4326 },
      }),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      returnGeometry: 'true',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });

    const res = await fetch(`${url}/query?${params.toString()}`, { signal: opts?.signal });
    if (!res.ok) throw new Error(`GRID3 query failed: ${res.status}`);
    const fc = (await res.json()) as GeoJSON.FeatureCollection & {
      properties?: { exceededTransferLimit?: boolean };
      exceededTransferLimit?: boolean;
    };

    const feats = fc.features ?? [];
    for (const f of feats) {
      if (!f.geometry) continue;
      if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
      const p = f.properties ?? {};
      settlements.push({
        id: String((p as any).block_id ?? f.id ?? `${offset}-${settlements.length}`),
        extentType: String((p as any).extent_type ?? ''),
        areaSqm: (p as any).block_area_sqm != null ? Number((p as any).block_area_sqm) : null,
        compositeClass: (p as any).composite_class ?? null,
        geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      });
    }

    exceeded = Boolean(fc.exceededTransferLimit || fc.properties?.exceededTransferLimit);
    if (!exceeded || feats.length === 0) break;
    offset += feats.length;
  }

  return { settlements, exceededTransferLimit: exceeded };
}
