import type { TeamPlan } from '../types';
import type { WeekSettlements } from '../hooks/useSelectedOrgUnitLayers';
import type { Settlement } from '../types';

/**
 * Extract the settlement name from a team's `visits` map key.
 *
 * A visit KEY is either a resolved settlement id, or an unresolved
 * `name:<settlement name>` key produced at ingest time (see ingest.ts:
 * `name:${norm(name)}`). Per the issue, the encoded form is
 *   name:ward1 ward2:[weekNo]
 * i.e. the whole text after `name:` is a SINGLE settlement name (it may contain
 * spaces — it came from one spreadsheet cell), optionally followed by a
 * `:weekNo` suffix. So we take the full remaining text as one name and strip a
 * trailing `:<digits>` week marker if present. We do NOT split on spaces, which
 * would wrongly fragment multi-word names like "layin amadi dakuma" into
 * unrelated tokens the geoservice can't match.
 *
 * Returns an array (0 or 1 name) to keep the caller's flat-map ergonomic.
 */

const NAME_PREFIX = 'name:';

/** Extract the settlement name encoded by a single visit key. */
export function settlementNamesFromVisitKey(
  key: string,
  settlementById?: Map<string, Settlement>
): string[] {
  if (key.startsWith(NAME_PREFIX)) {
    let text = key.slice(NAME_PREFIX.length).trim();
    // strip a trailing week marker: "...:[4]", "...:4", "...:[1,2]"
    text = text.replace(/:\s*\[?\d+(?:\s*,\s*\d+)*\]?\s*$/, '').trim();
    // strip a dangling trailing colon left by malformed keys ("name:layin:")
    text = text.replace(/:\s*$/, '').trim();
    return text ? [text] : [];
  }
  // resolved id → use the settlement's display name if we have it
  const s = settlementById?.get(key);
  return s ? [s.name] : [];
}

/**
 * Build week-grouped settlement names for the given team plans (optionally
 * restricted to a single team code). Returns the same WeekSettlements shape the
 * geoservice hook consumes, but with lightweight name-only Settlement stubs.
 */
export function weekSettlementsFromTeamPlans(
  teamPlans: TeamPlan[],
  opts?: { teamCode?: string | null; settlementById?: Map<string, Settlement> }
): WeekSettlements[] {
  const wantCode = opts?.teamCode?.toLowerCase();
  const plans = wantCode
    ? teamPlans.filter((p) => p.teamCode?.toLowerCase() === wantCode)
    : teamPlans;

  // week -> set of settlement names (dedup, case-insensitive)
  const weekMap = new Map<number,Map<string, { name: string; ward: string; state: string, lga?: string }>>();

  for (const plan of plans) {
    for (const [key, weeks] of Object.entries(plan.visits)) {
      const names = settlementNamesFromVisitKey(key, opts?.settlementById);
      for (const week of weeks) {
        if (!weekMap.has(week)) weekMap.set(week, new Map());
        const bucket = weekMap.get(week)!;
        for (const name of names) bucket.set(name.toLowerCase(), {
          name,
          ward: plan.ward ?? '',
          state: plan.state ?? '',
          lga: plan.lga ?? '',
        });
      }
    }
  }

  return [...weekMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, bucket]) => ({
      week,
      settlements: [...bucket.values()].map(
        ({name, ward, state, lga}): Settlement => ({
          id: `team:${week}:${name.toLowerCase()}`,
          name,
          ward,
          state,
          lga,
          source: 'upload' as any,
          geometry: { type: 'Polygon', coordinates: [] },
          centroid: [0, 0],
        })
      ),
    }));
}
