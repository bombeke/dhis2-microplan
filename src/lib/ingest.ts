import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { MicroplanRow, TeamPlan } from '../types';

/**
 * Header aliasing — real microplan spreadsheets are messy. We map a wide set
 * of likely header spellings onto our canonical field names so ingestion
 * survives the spreadsheets people actually upload.
 */
const HEADER_ALIASES: Record<keyof MicroplanRow, string[]> = {
  settlement: ['nigeria settlements', 'settlement', 'settlement name', 'community'],
  teamCode: ['team code', 'teamcode', 'team', 'team id'],
  ward: ['ward', 'ward name'],
  state: ['state', 'state name'],
  facilityName: ['facility name', 'facility', 'health facility', 'hf'],
  week1: ['outreach week 1', 'week 1', 'wk1', 'w1'],
  week2: ['outreach week 2', 'week 2', 'wk2', 'w2'],
  week3: ['outreach week 3', 'week 3', 'wk3', 'w3'],
  week4: ['outreach week 4', 'week 4', 'wk4', 'w4'],
  week5: ['outreach week 5', 'week 5', 'wk5', 'w5'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function buildHeaderMap(headers: string[]): Partial<Record<keyof MicroplanRow, number>> {
  const map: Partial<Record<keyof MicroplanRow, number>> = {};
  const normalized = headers.map(norm);
  (Object.keys(HEADER_ALIASES) as (keyof MicroplanRow)[]).forEach((field) => {
    const idx = normalized.findIndex((h) => HEADER_ALIASES[field].includes(h));
    if (idx >= 0) map[field] = idx;
  });
  return map;
}

function rowsToMicroplan(matrix: string[][]): MicroplanRow[] {
  if (matrix.length < 2) return [];
  const headerMap = buildHeaderMap(matrix[0]);
  const get = (row: string[], f: keyof MicroplanRow) => {
    const i = headerMap[f];
    return i === undefined ? '' : (row[i] ?? '').toString().trim();
  };
  return matrix
    .slice(1)
    .filter((r) => r.some((c) => c && c.toString().trim()))
    .map((r) => ({
      settlement: get(r, 'settlement'),
      teamCode: get(r, 'teamCode'),
      ward: get(r, 'ward'),
      state: get(r, 'state'),
      facilityName: get(r, 'facilityName'),
      week1: get(r, 'week1'),
      week2: get(r, 'week2'),
      week3: get(r, 'week3'),
      week4: get(r, 'week4'),
      week5: get(r, 'week5'),
    }));
}

export async function parseUpload(file: File): Promise<MicroplanRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || ext === 'tsv') {
    return new Promise((resolve, reject) => {
      Papa.parse<string[]>(file, {
        complete: (res) => resolve(rowsToMicroplan(res.data as string[][])),
        error: reject,
      });
    });
  }
  // xlsx / xls
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
  return rowsToMicroplan(matrix);
}

/** Split a week cell into the settlement names it lists (newline/comma/semicolon). */
export function splitSettlementCell(cell: string): string[] {
  if (!cell) return [];
  return cell
    .split(/[\n;,/]+/)
    .map((s) => s.trim())
    .filter((s) => s && !['0', 'no', 'n', 'false', '-', 'na', 'n/a'].includes(norm(s)));
}

/**
 * Collapse microplan rows into per-team plans keyed by team code.
 *
 * Week-column semantics (per the source spreadsheets): each of the five week
 * columns *contains the settlement name(s) to visit that week* — not a boolean.
 * A single cell may list several settlements (separated by newline / comma /
 * semicolon), and several rows for the same ward accumulate. We therefore parse
 * each week cell into settlement names, resolve each name to a settlement id
 * within the ward, and record which week(s) each settlement is visited in. The
 * row-level `settlement` column (when present) is also included as a visited
 * settlement so single-settlement-per-row sheets still work.
 */
export function buildTeamPlans(
  rows: MicroplanRow[],
  resolveSettlementId: (name: string, ward: string) => string | undefined
): TeamPlan[] {
  const byTeam = new Map<string, TeamPlan>();

  const addVisit = (plan: TeamPlan, name: string, ward: string, week: number | null) => {
    const settlementId = resolveSettlementId(name, ward) ?? `name:${norm(name)}`;
    const existing = plan.visits[settlementId] ?? [];
    const next = week ? [...existing, week] : existing;
    plan.visits[settlementId] = Array.from(new Set(next)).sort((a, b) => a - b);
  };

  for (const row of rows) {
    if (!row.teamCode) continue;
    let plan = byTeam.get(row.teamCode);
    if (!plan) {
      plan = {
        teamCode: row.teamCode,
        ward: row.ward,
        state: row.state,
        facilityName: row.facilityName,
        visits: {},
      };
      byTeam.set(row.teamCode, plan);
    }

    const weekCells: [number, string][] = [
      [1, row.week1],
      [2, row.week2],
      [3, row.week3],
      [4, row.week4],
      [5, row.week5],
    ];

    let anyWeekSettlement = false;
    for (const [week, cell] of weekCells) {
      for (const name of splitSettlementCell(cell)) {
        addVisit(plan, name, row.ward, week);
        anyWeekSettlement = true;
      }
    }

    // Fall back to the row-level settlement column when week cells carry no
    // settlement names (e.g. a sheet that lists one settlement per row with
    // boolean-ish week markers). Record it with no specific week.
    if (!anyWeekSettlement && row.settlement) {
      addVisit(plan, row.settlement, row.ward, null);
    }
  }

  return Array.from(byTeam.values()).sort((a, b) => a.teamCode.localeCompare(b.teamCode));
}
