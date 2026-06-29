import React, { useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import type { TeamPlan } from '../types';

/**
 * Teams grouped by ward. Each team row reveals (hover/click) the settlements
 * it visits; selecting a team drives the map to its assigned polygons.
 */
export const TeamWardList: React.FC<{ plans: TeamPlan[] }> = ({ plans }) => {
  const { selectedTeam, selectTeam, settlements } = useStore();
  const [filter, setFilter] = useState('');

  const byWard = useMemo(() => {
    const m = new Map<string, TeamPlan[]>();
    for (const p of plans) {
      if (filter && !p.ward.toLowerCase().includes(filter.toLowerCase()) &&
          !p.teamCode.toLowerCase().includes(filter.toLowerCase())) continue;
      const arr = m.get(p.ward) ?? [];
      arr.push(p);
      m.set(p.ward, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [plans, filter]);

  return (
    <div className="teamlist">
      <input
        className="teamlist__filter"
        placeholder="Filter by ward or team…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {byWard.map(([ward, teams]) => (
        <section key={ward} className="teamlist__ward">
          <h3>{ward}<span>{teams.length} teams</span></h3>
          <ul>
            {teams.map((t) => (
              <li
                key={t.teamCode}
                className={selectedTeam === t.teamCode ? 'is-active' : ''}
                onMouseEnter={() => selectTeam(t.teamCode)}
                onClick={() => selectTeam(t.teamCode)}
              >
                <span className="teamlist__code">{t.teamCode}</span>
                <span className="teamlist__meta">
                  {Object.keys(t.visits).length} settlements · {t.facilityName}
                </span>
                {selectedTeam === t.teamCode && (
                  <ul className="teamlist__settlements">
                    {Object.entries(t.visits).map(([sid, weeks]) => {
                      const s = settlements.get(sid);
                      return (
                        <li key={sid}>
                          {s?.name ?? sid.replace(/^name:/, '')}
                          {s?.population != null && <em> · pop {s.population.toLocaleString()}</em>}
                          <span className="weeks">wk {weeks.join(', ')}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
