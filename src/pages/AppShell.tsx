import React, { useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useStore } from '../store/useStore';
import { useSearchWorker } from '../hooks/useSearchWorker';
import { parseUpload, buildTeamPlans } from '../lib/ingest';
import { makeProvider } from '../lib/geoSources';
import { flagPoints, assignedByTeamFrom } from '../lib/flagging';
import { fetchEnrollmentPoints, fetchEventPoints } from '../lib/dhis2Data';
import { resolvePeriod } from '../lib/periods';
import { UploadPanel } from '../components/UploadPanel';
import { TeamWardList } from '../components/TeamWardList';
import { MapView } from '../components/MapView';
import { PeriodCard } from '../components/PeriodCard';
import { FlagTable } from '../components/FlagTable';
import { GlobalSearch } from '../components/GlobalSearch';

/**
 * Orchestrates the full pipeline:
 *  upload -> team plans -> ward geometry -> dhis2 points -> flagging -> map + tables.
 * Each stage writes to the store; components subscribe to the slice they need.
 */
export const AppShell: React.FC = () => {
  const engine = useDataEngine();
  const searchWorker = useSearchWorker();

  const {
    teamPlans,
    setTeamPlans,
    settlements,
    upsertSettlements,
    setPoints,
    flags,
    setFlags,
    geoSource,
    period,
    setPeriod,
    selectedTeam,
  } = useStore();

  const provider = useMemo(
    () => makeProvider(geoSource, engine),
    [geoSource, engine]
  );

  const onUpload = async (file: File) => {
    const rows = await parseUpload(file);
    const resolveId = (name: string) => {
      for (const s of settlements.values())
        if (s.name.toLowerCase() === name.toLowerCase()) return s.id;
      return undefined;
    };
    const plans = buildTeamPlans(rows, resolveId);
    setTeamPlans(plans);

    // Lazily hydrate geometry for the wards present in the upload.
    const wards = [...new Set(plans.map((p) => p.ward))];
    for (const ward of wards) {
      try {
        const found = await provider.byWard(ward, ward);
        if (found.length) upsertSettlements(found);
      } catch (e) {
        console.warn('geometry fetch failed for ward', ward, e);
      }
    }
  };

  const refreshData = async (program: string, orgUnit: string) => {
    const range = resolvePeriod(period);
    const [enroll, events] = await Promise.all([
      fetchEnrollmentPoints(engine, { program, orgUnit, period: period }),
      fetchEventPoints(engine, { program, orgUnit, period: period }),
    ]);
    const points = [...enroll, ...events];
    setPoints(points);
    const assigned = assignedByTeamFrom(teamPlans);
    setFlags(flagPoints(points, settlements, assigned));
    return range;
  };

  const outOfBounds = flags.filter((f) => !f.inside);

  return (
    <div className="app-shell">
      <header className="app-shell__bar">
        <h1>Outreach Microplan &amp; Coverage</h1>
        <GlobalSearch worker={searchWorker} />
        <PeriodCard value={period} onChange={setPeriod} />
      </header>

      <div className="app-shell__body">
        <aside className="app-shell__side">
          <UploadPanel onUpload={onUpload} />
          <TeamWardList plans={teamPlans} />
        </aside>

        <main className="app-shell__main">
          <MapView
            settlements={settlements}
            flags={flags}
            geoSource={geoSource}
            focusTeam={selectedTeam}
          />
          <FlagTable rows={outOfBounds} settlements={settlements} />
        </main>
      </div>
    </div>
  );
};
