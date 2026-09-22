import { sqlQuote } from './settlementsGeoservice';
import { fold } from './settlementCatalog';

/**
 * The settlement register behind the Manage Settlements page: every row of the
 * `public.ng_settlements` pg_featureserv collection under a chosen org unit.
 *
 * The service knows places by *name* only (state, lga, ward columns), so an
 * org unit is turned into a CQL filter on those names. DHIS2 names carry
 * decorations the service doesn't ("kn Kano State", "kn Dala Local Government
 * Area", "Dala Ward"), so both sides are reduced to a bare key before they are
 * compared — see `dhisPlaceKey` / `placeKey`.
 *
 * Scale: a whole state is tens of thousands of rows and the country can be
 * several hundred thousand. Rows are fetched in 10 000-row pages, four at a
 * time, with only the columns the table shows, and are kept as flat objects
 * with their search and scope keys precomputed, so filtering 200 000 of them
 * is a single linear scan.
 */

export const SETTLEMENTS_ITEMS_URL =
  'https://maps.jsinigeria.org/collections/public.ng_settlements/items.json';

const PAGE = 10_000;
const CONCURRENCY = 4;
const MAX_PAGES = 80; // 800k — far beyond the register, guards a runaway loop
const PROPERTIES = 'id,settlement,ward,lga,state,households,latitude,longitude,source';

export type Polygonal = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/** Why a row has no usable coordinate. */
export type GpsIssue = 'missing' | 'invalid' | null;

export interface SettlementRecord {
  id: string;
  name: string;
  ward: string;
  lga: string;
  state: string;
  households: number | null;
  lat: number | null;
  lon: number | null;
  source: string | null;
  polygon: Polygonal | null;
  /** 'invalid' when the service holds a value that isn't a WGS84 coordinate */
  gpsIssue: GpsIssue;
  /** bare state / LGA / ward keys, for org-unit scoping */
  sk: string;
  lk: string;
  wk: string;
  /** folded "name ward lga state id", for search */
  k: string;
}

/* ---- names ------------------------------------------------------------------- */

const SUFFIXES = /\b(state|local government area|local government|lga|ward)\b/g;

/** A settlement-service place name reduced to a comparable key: "BRASS 1" → "brass1". */
export const placeKey = (s: string | null | undefined) =>
  fold(s ?? '')
    .replace(SUFFIXES, '')
    .replace(/[^a-z0-9]+/g, '');

/**
 * A DHIS2 org-unit name reduced to the same key. DHIS2 names in this instance
 * carry a two-letter state prefix ("kn Dala"), which the service doesn't.
 */
export const dhisPlaceKey = (s: string | null | undefined) =>
  placeKey(fold(s ?? '').replace(/^[a-z]{2}\s+/, ''));

/** Words of a DHIS2 name, prefix and suffixes dropped: "kn Dala Ward" → ["dala"]. */
const dhisWords = (s: string) =>
  fold(s)
    .replace(/^[a-z]{2}\s+/, '')
    .replace(SUFFIXES, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** A loose ILIKE pattern for a DHIS2 name: "by Brass 1 Ward" → 'brass%1'. */
const ilike = (dhisName: string) => {
  const words = dhisWords(dhisName);
  return words.length ? words.join('%') : null;
};

/* ---- scope: which org unit maps to which filter -------------------------------- */

export interface HierarchyLevels {
  stateLevel: number;
  lgaLevel: number;
  wardLevel: number;
}

export interface OrgUnitWithAncestors {
  id: string;
  name: string;
  level: number;
  ancestors: { id: string; name: string; level: number }[];
}

/** The DHIS2 names of the state / LGA / ward an org unit sits in (or is). */
export interface PlaceScope {
  state?: string;
  lga?: string;
  ward?: string;
}

export function placeScopeOf(ou: OrgUnitWithAncestors, levels: HierarchyLevels): PlaceScope {
  const nameAt = (level: number) =>
    level === ou.level ? ou.name : ou.ancestors.find((a) => a.level === level)?.name;
  const scope: PlaceScope = {};
  if (levels.stateLevel <= ou.level) scope.state = nameAt(levels.stateLevel);
  if (levels.lgaLevel <= ou.level) scope.lga = nameAt(levels.lgaLevel);
  if (levels.wardLevel <= ou.level) scope.ward = nameAt(levels.wardLevel);
  return scope;
}

export const describeScope = (s: PlaceScope) =>
  [s.ward, s.lga, s.state].filter(Boolean).join(' · ') || 'Whole country';

/** A place-key matcher — a row matches when every key present is equal. */
export interface PlaceMatcher {
  sk?: string;
  lk?: string;
  wk?: string;
}

export const matcherOf = (scope: PlaceScope): PlaceMatcher => ({
  ...(scope.state ? { sk: dhisPlaceKey(scope.state) } : {}),
  ...(scope.lga ? { lk: dhisPlaceKey(scope.lga) } : {}),
  ...(scope.ward ? { wk: dhisPlaceKey(scope.ward) } : {}),
});

export const matches = (m: PlaceMatcher, r: Pick<SettlementRecord, 'sk' | 'lk' | 'wk'>) =>
  (!m.sk || m.sk === r.sk) && (!m.lk || m.lk === r.lk) && (!m.wk || m.wk === r.wk);

/* ---- fetching -------------------------------------------------------------------- */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const isValidLat = (v: number | null): v is number => v !== null && v >= -90 && v <= 90;
export const isValidLon = (v: number | null): v is number => v !== null && v >= -180 && v <= 180;

function toRecord(f: any): SettlementRecord | null {
  const p = f?.properties ?? {};
  const id = String(p.id ?? f?.id ?? '');
  if (!id) return null;
  const name = String(p.settlement ?? '').trim();
  const ward = String(p.ward ?? '').trim();
  const lga = String(p.lga ?? '').trim();
  const state = String(p.state ?? '').trim();

  let lat = num(p.latitude);
  let lon = num(p.longitude);
  let polygon: Polygonal | null = null;
  const g = f?.geometry;
  if (g?.type === 'Polygon' || g?.type === 'MultiPolygon') polygon = g;
  else if (g?.type === 'Point' && lat === null && lon === null) {
    lon = num(g.coordinates?.[0]);
    lat = num(g.coordinates?.[1]);
  }

  let gpsIssue: GpsIssue = null;
  if (lat === null || lon === null) gpsIssue = 'missing';
  else if (!isValidLat(lat) || !isValidLon(lon) || (lat === 0 && lon === 0)) gpsIssue = 'invalid';

  const src = p.source == null ? null : String(p.source).trim() || null;
  return {
    id,
    name,
    ward,
    lga,
    state,
    households: num(p.households),
    lat,
    lon,
    source: src,
    polygon,
    gpsIssue,
    sk: placeKey(state),
    lk: placeKey(lga),
    wk: placeKey(ward),
    k: fold(`${name} ${ward} ${lga} ${state} ${id}`),
  };
}

async function fetchPage(filter: string | null, offset: number, signal?: AbortSignal) {
  const params = new URLSearchParams({
    properties: PROPERTIES,
    limit: String(PAGE),
    offset: String(offset),
  });
  if (filter) params.set('filter', filter);
  const res = await fetch(`${SETTLEMENTS_ITEMS_URL}?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Settlement register request failed (${res.status})`);
  const fc = await res.json();
  return (fc.features ?? []) as any[];
}

/** Every row matching `filter`, four pages at a time. */
async function fetchAll(
  filter: string | null,
  signal?: AbortSignal,
  onProgress?: (loaded: number) => void
): Promise<SettlementRecord[]> {
  const out: SettlementRecord[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page += CONCURRENCY) {
    const offsets = Array.from({ length: CONCURRENCY }, (_, i) => (page + i) * PAGE);
    const pages = await Promise.all(offsets.map((o) => fetchPage(filter, o, signal)));
    let done = false;
    for (const feats of pages) {
      for (const f of feats) {
        const r = toRecord(f);
        if (!r || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      if (feats.length < PAGE) done = true;
    }
    onProgress?.(out.length);
    if (done) break;
  }
  return out;
}

const cql = (parts: [string, string | null | undefined][]) =>
  parts
    .filter((p): p is [string, string] => !!p[1])
    .map(([col, pattern]) => `${col} ILIKE ${sqlQuote(pattern)}`)
    .join(' AND ') || null;

/**
 * All settlements under `scope`. The server filter is deliberately loose
 * (ILIKE with wildcards between words); the exact key comparison happens here,
 * so "Brass 1" doesn't also bring "Brass 11". If the finest level matches
 * nothing — a ward spelled differently in DHIS2 and in the register — the
 * filter is widened one level and the row set is narrowed by key instead, and
 * failing that the looser set is returned rather than an empty table.
 */
export async function fetchSettlementRegister(
  scope: PlaceScope,
  opts: { signal?: AbortSignal; onProgress?: (loaded: number) => void } = {}
): Promise<{ rows: SettlementRecord[]; widened: boolean }> {
  const state = scope.state ? ilike(scope.state) : null;
  const lga = scope.lga ? ilike(scope.lga) : null;
  const ward = scope.ward ? ilike(scope.ward) : null;
  const m = matcherOf(scope);

  const attempts: string[] = [];
  const add = (f: string | null) => {
    if (f !== null && !attempts.includes(f)) attempts.push(f);
  };
  add(cql([['state', state], ['lga', lga], ['ward', ward]]));
  if (ward) add(cql([['state', state], ['lga', lga]]));
  if (lga) add(cql([['state', state]]));
  if (!attempts.length) attempts.push('');

  for (let i = 0; i < attempts.length; i++) {
    const rows = await fetchAll(attempts[i] || null, opts.signal, opts.onProgress);
    if (!rows.length) continue;
    const exact = rows.filter((r) => matches(m, r));
    if (exact.length) return { rows: exact, widened: false };
    // nothing matched by key: better a slightly wide list than an empty one
    return { rows, widened: true };
  }
  return { rows: [], widened: false };
}
