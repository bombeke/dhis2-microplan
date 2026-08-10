import React, { useState } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { parseUpload, buildTeamPlans, splitSettlementCell } from '../lib/ingest';
import { makeProvider } from '../lib/geoSources';
import {
  useCurrentUser,
  useSaveMicroplan,
} from '../hooks/useMicroplans';
import { useStore } from '../store/useStore';
import { formatDate, RELATIVE_PERIODS } from '../lib/periods';
import { OrgUnitPicker } from '../components/OrgUnitPicker';
import { ProgramSelect } from '../components/ProgramSelect';
import { usePrograms } from '../hooks/usePrograms';
import type { StoredMicroplan } from '../lib/microplanStore';
import type { MicroplanRow, Settlement } from '../types';

/**
 * Dedicated upload page. Flow:
 *   pick file → parse (CSV/Excel) → choose period + org unit + level →
 *   resolve geometry for the wards in the file → save to dataStore.
 * The map page then reads these back via the catalogue.
 */
export const UploadPage: React.FC = () => {
  const engine = useDataEngine();
  const user = useCurrentUser();
  const save = useSaveMicroplan();
  const { geoSource } = useStore();

  const [rows, setRows] = useState<MicroplanRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [period, setPeriod] = useState('THIS_MONTH');
  const [programId, setProgramId] = useState<string | null>(null);
  const [orgUnit, setOrgUnit] = useState<{ id: string; name: string; level: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const { data: programs = [] } = usePrograms();

  const onFile = async (file?: File) => {
    if (!file) return;
    setFileName(`${file.name}_${formatDate(new Date())}`);
    setStatus('Parsing…');
    try {
      const parsed = await parseUpload(file);
      setRows(parsed);
      setStatus(`${parsed.length} rows parsed.`);
    } catch (e: any) {
      setStatus(`Parse failed: ${e.message}`);
    }
  };

  const onSave = async () => {
    if (!rows || !user || !orgUnit || !programId) return;
    setBusy(true);
    setStatus('Resolving settlement geometry…');
    try {
      // resolve settlement geometry for the wards present in the file
      const provider = makeProvider(geoSource, engine as any);
      const wards = [...new Set(rows.map((r) => r.ward).filter(Boolean))];
      const settlements: Settlement[] = [];
      for (const ward of wards) {
        try {
          const found = await provider.byWard(ward, ward);
          settlements.push(...found);
        } catch {
          /* geometry optional; continue */
        }
      }

      //const byName = new Map(settlements.map((s) => [s.name.toLowerCase(), s.id]));
      const byName = new Map(settlements.map((s) => [s.name, s.id]));
      const teamPlans = buildTeamPlans(rows, (name) => byName.get(name));

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const payload: StoredMicroplan = {
        id,
        fileName,
        uploadedBy: user.username,
        uploadedById: user.id,
        uploadedAt: new Date().toISOString(),
        programId,
        programName: programs.find((p) => p.id === programId)?.name ?? '',
        period,
        orgUnitId: orgUnit.id,
        orgUnitName: orgUnit.name,
        level: orgUnit.level,
        state: rows.find((r) => r.state)?.state ?? '',
        lga: rows.find((r) => r.lga)?.lga ?? '',
        rowCount: rows.length,
        teamCount: teamPlans.length,
        settlementCount: settlements.length,
        teamPlans,
        settlements,
      };

      setStatus('Saving to DHIS2 dataStore…');
      await save.mutateAsync(payload);
      setStatus(`Saved "${fileName}" (${teamPlans.length} teams, ${settlements.length} settlements).`);
      setRows(null);
      setFileName('');
    } catch (e: any) {
      setStatus(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const canSave = !!rows && !!user && !!orgUnit && !!programId && !busy;

  return (
    <div className="page page--upload">
      <h2>Upload microplan</h2>
      <p className="page__lead">
        Upload a CSV/Excel microplan, tag it with a reporting period and
        organisation unit, and save it to the DHIS2.
      </p>

      <div
        className="upload upload--lg"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          id="file"
          type="file"
          accept=".csv,.tsv,.xlsx,.xls"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <label htmlFor="file" className="upload__hit">
          <strong>{fileName || 'Choose or drop a file'}</strong>
          <span>CSV / Excel — settlement, team code, ward, state, facility, weeks 1–5</span>
        </label>
      </div>

      {rows && (
        <div className="upload__meta">
          <div className="field">
            <label>Activity / program <span className="req">*</span></label>
            <ProgramSelect
              value={programId}
              onChange={setProgramId}
              allLabel="Select a program…"
            />
            <small className="field__hint">
              Every upload must be linked to a DHIS2 program (activity).
            </small>
          </div>

          <div className="field">
            <label>Reporting period</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {RELATIVE_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Organisation unit</label>
            <OrgUnitPicker value={orgUnit} onChange={setOrgUnit} />
          </div>

          <PreviewTable rows={rows} />
        </div>
      )}

      <div className="upload__actions">
        <button className="btn btn--primary" disabled={!canSave} onClick={onSave}>
          {busy ? 'Saving…' : 'Save to dataStore'}
        </button>
        {status && <span className="upload__status">{status}</span>}
        {rows && !programId && !status && (
          <span className="upload__status upload__status--warn">
            Select a program to enable saving.
          </span>
        )}
      </div>
    </div>
  );
};

const PreviewTable: React.FC<{ rows: MicroplanRow[] }> = ({ rows }) => (
  <div className="preview">
    <div className="preview__head">Preview · first {Math.min(rows.length, 8)} of {rows.length}</div>
    <table>
      <thead>
        <tr>
          <th>Team</th><th>State</th><th>LGA</th><th>Ward</th><th>Health Facility</th><th>Week 1</th><th>Week 2</th><th>Week 3</th><th>Week 4</th><th>Week 5</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 8).map((r, i) => {
          const cells: [number, string][] = [
            [1, r.week1], [2, r.week2], [3, r.week3], [4, r.week4], [5, r.week5],
          ];
          const wks = cells
            .map(([n, cell]) => {
              const count = splitSettlementCell(cell).length;
              return count ? `W${n}:${count}` : null;
            })
            .filter(Boolean)
            .join(' · ');
          return (
            <tr key={i}>
              <td>{r.teamCode}</td><td>{r.state}</td><td>{r.lga}</td><td>{r.ward}</td>
              <td>{r.facilityName}</td><td>{r.week1 || ''}</td><td>{r.week2 || ''}</td><td>{r.week3 || ''}</td><td>{r.week4 || ''}</td><td>{r.week5 || ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
