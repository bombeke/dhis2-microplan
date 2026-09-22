import { sqlQuote } from './settlementsGeoservice';

/**
 * The settlement list behind each week cell of the Create Microplan grid.
 *
 * Every cell offers the settlements of the facility's *parent* org unit (the
 * level directly above the facility — a ward on the Nigerian hierarchy). The
 * source is the same pg_featureserv collection the map already reads
 * (`public.ng_settlements`), queried with a CQL `filter` on its `ward` column.
 * That service only knows names, so the parent is matched by name.
 *
 * Why this is cheap even with thousands of rows:
 *
 *  - Facilities under one ward share a single list. The list is cached by the
 *    parent's org-unit id (React Query, see useWardSettlements), so a ward with
 *    twenty facilities × five weeks = a hundred cells costs one request.
 *  - Nothing is fetched until a cell is opened or hovered, except a small,
 *    concurrency-limited prefetch of the wards on the page being viewed.
 *  - Each record carries a pre-lowercased search key, so filtering is a single
 *    linear scan — ~5 ms over 150 000 records — with no index to build, and the
 *    results are rendered through a virtual list, so the DOM holds only the
 *    ~15 rows on screen however many match.
 */

const ITEMS_URL = 'https://maps.jsinigeria.org/collections/public.ng_settlements/items.json';
const PAGE = 10_000;
const MAX_PAGES = 30; // 300k — far beyond any real ward, guards a runaway loop

export interface SettlementOption {
  id: string;
  name: string;
  /** ward · LGA · state, for telling duplicate names apart */
  sub: string;
  /** lowercased, accent-free name + sub, precomputed for search */
  k: string;
}

/** Lowercase and strip diacritics, so "Ọ̀yọ́" is found by typing "oyo". */
export const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * DHIS2 names often wear decorations the settlement service doesn't have:
 * a two-letter state prefix ("kn Dala"), and a "Ward" suffix ("Dala Ward").
 * We try the name as-is first, then the cleaned-up form.
 */
export function wardNameCandidates(name: string): string[] {
  const raw = name.trim();
  const cleaned = raw
    .replace(/^[a-z]{2}\s+/, '') // "kn Dala" → "Dala"
    .replace(/\s+ward$/i, '') // "Dala Ward" → "Dala"
    .trim();
  return Array.from(new Set([raw, cleaned].filter(Boolean)));
}

/** "Kano State" / "kn Kano State" → "kano", for loose state matching. */
const stateKey = (s: string) =>
  fold(s).replace(/^[a-z]{2}\s+/, '').replace(/\s+state$/, '').trim();

async function fetchByWardName(ward: string, signal?: AbortSignal): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      filter: `ward ILIKE ${sqlQuote(ward)}`,
      properties: 'id,settlement,ward,lga,state',
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    const res = await fetch(`${ITEMS_URL}?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`Settlement lookup failed (${res.status})`);
    const fc = await res.json();
    const feats: any[] = fc.features ?? [];
    out.push(...feats);
    if (feats.length < PAGE) break;
  }
  return out;
}

/**
 * All settlements in the ward called `wardName`. `ancestorNames` (the ward's
 * own ancestors — LGA, state …) are used only to drop same-named wards in
 * other states; if none of them match we keep everything rather than show an
 * empty list.
 */
export async function fetchWardSettlements(
  wardName: string,
  ancestorNames: string[],
  signal?: AbortSignal
): Promise<SettlementOption[]> {
  let feats: any[] = [];
  for (const candidate of wardNameCandidates(wardName)) {
    feats = await fetchByWardName(candidate, signal);
    if (feats.length) break;
  }

  const states = new Set(feats.map((f) => stateKey(f.properties?.state ?? '')));
  if (states.size > 1 && ancestorNames.length) {
    const hints = ancestorNames.map(stateKey);
    const scoped = feats.filter((f) => {
      const s = stateKey(f.properties?.state ?? '');
      return s && hints.some((h) => h === s || h.includes(s));
    });
    if (scoped.length) feats = scoped;
  }

  const seen = new Set<string>();
  const out: SettlementOption[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const id = String(p.id ?? f.id ?? '');
    const name = String(p.settlement ?? '').trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const sub = [p.ward, p.lga, p.state].filter(Boolean).join(' · ');
    out.push({ id, name, sub, k: fold(`${name} ${sub}`) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Filter `list` by `query`: every whitespace-separated term must appear.
 * Name-prefix hits come first, then the rest, each in list (alphabetical)
 * order — two pushes, no sort, so it stays linear.
 */
export function searchSettlements(list: SettlementOption[], query: string): SettlementOption[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return list;
  const first = terms[0];
  const prefix: SettlementOption[] = [];
  const rest: SettlementOption[] = [];
  for (const o of list) {
    let ok = true;
    for (const t of terms) {
      if (!o.k.includes(t)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    (o.k.startsWith(first) ? prefix : rest).push(o);
  }
  return prefix.length ? prefix.concat(rest) : rest;
}

/** Id for a settlement typed in by hand — same `name:` convention as uploads. */
export const customSettlementId = (name: string) => `name:${fold(name)}`;
