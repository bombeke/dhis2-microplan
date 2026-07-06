import type { TeamPlan } from '../types';
import type { WeekSettlements } from '../hooks/useSelectedOrgUnitLayers';
import type { Settlement } from '../types';

/**
 * Extract settlement names from a team's `visits` map.
 *
 * A visit KEY may be a resolved settlement id, or an unresolved `name:<text>`
 * key. Per the uploaded data, the `name:` text can hold SEVERAL settlement
 * names as space-separated words, e.g.
 *   "name:layin amadi dakuma layi sautal": [4]
 *     → settlements: layin, amadi, dakuma, layi, sautal (week 4)
 *   "name:kurna layin saudat dakuma layin mangor": [1]
 *     → settlements: kurna, layin, saudat, dakuma, layin, mangor (week 1)
 * So for `name:` keys we split the remaining text into individual words, each a
 * settlement name; for resolved ids we fall back to the Settlement's name.
 */

const NAME_PREFIX = 'name:';

/** Split a single visit key into the settlement name(s) it encodes. */
export function settlementNamesFromVisitKey(
  key: string,
  settlementById?: Map<string, Settlement>
): string[] {
  if (key.startsWith(NAME_PREFIX)) {
    const text = key.slice(NAME_PREFIX.length).trim();
    // space-separated words = individual settlement names
    return text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
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
  const weekMap = new Map<number, Map<string, string>>();

  for (const plan of plans) {
    for (const [key, weeks] of Object.entries(plan.visits)) {
      const names = settlementNamesFromVisitKey(key, opts?.settlementById);
      for (const week of weeks) {
        if (!weekMap.has(week)) weekMap.set(week, new Map());
        const bucket = weekMap.get(week)!;
        for (const name of names) bucket.set(name.toLowerCase(), name);
      }
    }
  }

  return [...weekMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([week, names]) => ({
      week,
      settlements: [...names.values()].map(
        (name): Settlement => ({
          id: `team:${week}:${name.toLowerCase()}`,
          name,
          ward: '',
          state: '',
          source: 'upload' as any,
          geometry: { type: 'Polygon', coordinates: [] },
          centroid: [0, 0],
        })
      ),
    }));
}
