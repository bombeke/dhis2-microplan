import buffer from '@turf/buffer';

/**
 * Access to the "Settlements_in_Nigeria" GRID3 settlement-NAMES FeatureServer.
 *
 * Unlike the GRID3 v4.0 settlement-extents layer (which has NO name fields and
 * must be queried spatially), this layer is POINT geometry with named
 * attributes — notably `set_name` (settlement name), plus wardname, lganame,
 * statename. So we can filter directly by settlement name with a SQL `where`
 * clause, which is what step 1 requires.
 *
 * The features are points; step 2 asks for a maplibre `fill` layer, so we
 * buffer each point into a small polygon (turf) and return a polygon
 * FeatureCollection suitable for a fill layer.
 */

const DEFAULT_URL =
  'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/Settlements_in_Nigeria/FeatureServer/0';

const NAME_FIELD = 'set_name';

export interface SettlementNameFeatureProps {
  set_name: string;
  wardname?: string;
  lganame?: string;
  statename?: string;
  set_id?: string;
  week?: number; // stamped by the caller so the map can colour by week
}

/** Escape a value for an ArcGIS SQL where clause (single quotes doubled). */
export function sqlQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Query the settlements service for the given settlement names and return a
 * polygon FeatureCollection (points buffered to small polygons for a fill
 * layer). Names are matched case-insensitively on `set_name`. Chunks the names
 * into batches to keep the where clause within server limits.
 */
export async function fetchSettlementsByName(
  names: string[],
  opts?: {
    ward?: string;
    state?: string;
    url?: string;
    bufferMeters?: number;
    signal?: AbortSignal;
    chunkSize?: number;
  }
): Promise<GeoJSON.FeatureCollection> {
  const url = opts?.url ?? DEFAULT_URL;
  const bufferMeters = opts?.bufferMeters ?? 500;
  const chunkSize = opts?.chunkSize ?? 100;

  const cleaned = Array.from(
    new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))
  );
  const out: GeoJSON.Feature[] = [];
  if (cleaned.length === 0) return { type: 'FeatureCollection', features: out };

  const scope: string[] = [];
  const ward = opts?.ward?.trim();
  const state = opts?.state?.trim();
  if (ward) scope.push(`UPPER(wardname) = ${sqlQuote(ward.toUpperCase())}`);
  if (state) scope.push(`UPPER(statename) = ${sqlQuote(state.toUpperCase())}`);

  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize);
    const inList = chunk.map((n) => sqlQuote(n.toUpperCase())).join(',');
    const where = [`UPPER(${NAME_FIELD}) IN (${inList})`, ...scope].join(' AND ');

    const params = new URLSearchParams({
      f: 'geojson',
      where,
      outFields: `${NAME_FIELD},wardname,lganame,statename,set_id`,
      returnGeometry: 'true',
      outSR: '4326',
    });

    const res = await fetch(`${url}/query?${params.toString()}`, { signal: opts?.signal });
    if (!res.ok) throw new Error(`Settlements query failed: ${res.status}`);
    const fc = (await res.json()) as GeoJSON.FeatureCollection;

    for (const f of fc.features ?? []) {
      if (!f.geometry) continue;
      if (f.geometry.type === 'Point') {
        try {
          const buffered = buffer(f as any, bufferMeters, { units: 'meters' });
          if (buffered) {
            buffered.properties = { ...(f.properties ?? {}) };
            out.push(buffered as GeoJSON.Feature);
          }
        } catch {
          /* skip un-bufferable */
        }
      } else {
        out.push(f);
      }
    }
  }

  return { type: 'FeatureCollection', features: out };
}



/**
 * Access to the "Settlements_in_Nigeria" GRID3 settlement-NAMES FeatureServer.
 *
 * POINT geometry with named attributes — `set_name`, wardname, lganame,
 * statename. This variant fetches ALL settlements in a given state by
 * `statename`, paging through the service, and returns a polygon
 * FeatureCollection (points buffered to small polygons for a fill layer).
 */

/**
 * Query the settlements service for all settlements in the given state and
 * return a polygon FeatureCollection (points buffered to small polygons for a
 * fill layer). The state name is matched case-insensitively on `statename`.
 * Pages through results via resultOffset until the server stops returning
 * `exceededTransferLimit`.
 */
export async function fetchSettlementsByState(
  state: string,
  opts?: {
    url?: string;
    bufferMeters?: number;
    signal?: AbortSignal;
    pageSize?: number;
  }
): Promise<GeoJSON.FeatureCollection> {
  const url = opts?.url ?? DEFAULT_URL;
  const bufferMeters = opts?.bufferMeters ?? 150;
  const pageSize = opts?.pageSize ?? 2000;

  const out: GeoJSON.Feature[] = [];
  const stateName = state.trim();
  if (!stateName) return { type: 'FeatureCollection', features: out };

  const where = `UPPER(statename) = ${sqlQuote(stateName.toUpperCase())}`;

  // set_id -> already emitted. Cheap O(1) guard; also stops us paying the
  // turf buffer cost on a duplicate we're going to throw away anyway.
  const seen = new Set<string>();

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams({
      f: 'geojson',
      where,
      outFields: `${NAME_FIELD},wardname,lganame,statename,set_id`,
      returnGeometry: 'true',
      outSR: '4326',
      orderByFields: 'set_id',   //composite key:`${props.set_id}|${props.wardname}` // stable paging — without this, offsets can repeat/skip rows
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });

    const res = await fetch(`${url}/query?${params.toString()}`, { signal: opts?.signal });
    if (!res.ok) throw new Error(`Settlements query failed: ${res.status}`);
    const fc = (await res.json()) as GeoJSON.FeatureCollection & {
      exceededTransferLimit?: boolean;
      properties?: { exceededTransferLimit?: boolean };
    };

    const features = fc.features ?? [];
    for (const f of features) {
      if (!f.geometry) continue;

      const props = (f.properties ?? {}) as Record<string, unknown>;
      const id =
        props.set_id != null
          ? String(props.set_id)
          : f.id != null
            ? String(f.id)
            : null;

      if (id != null) {
        if (seen.has(id)) continue; // dedupe before buffering
        seen.add(id);
      }

      if (f.geometry.type === 'Point') {
        try {
          const buffered = buffer(f as any, bufferMeters, { units: 'meters' });
          if (buffered) {
            buffered.properties = { ...props };
            out.push(buffered as GeoJSON.Feature);
          }
        } catch {
          /* skip un-bufferable */
        }
      } else {
        out.push(f);
      }
    }

    const more =
      fc.exceededTransferLimit ??
      fc.properties?.exceededTransferLimit ??
      features.length === pageSize;

    if (!more || features.length === 0) break;
    offset += features.length;
  }

  return { type: 'FeatureCollection', features: out };
}