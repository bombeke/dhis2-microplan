import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SettlementCellEditor } from './SettlementCellEditor';
import { prefetchWardSettlements, scopeOf } from '../../hooks/useCreatePlan';
import type { CellItem, PlanRow } from '../../lib/createdPlanStore';
import type { PlanColumn } from '../../lib/planSchedule';
import { cn } from '../../lib/ui';

/**
 * The spreadsheet-style plan grid.
 *
 * Layout: one row per facility × assigned user; the org-unit levels between
 * the selected unit and the facility as their own columns; then the facility,
 * who it's assigned to, one column per week (or month), and — once a plan is
 * in review — the reviewer's note.
 *
 * Like a spreadsheet, the arrow keys move between cells and Enter opens one.
 * The facility column is sticky from `md` up so it stays in view while the
 * weeks scroll sideways; the header is sticky inside the grid's own scroll
 * box so it stays in view going down.
 */

export interface LevelColumn {
  level: number;
  name: string;
}

export interface GridMode {
  editCells: boolean;
  editNotes: boolean;
  showNotes: boolean;
}

interface Props {
  rows: PlanRow[];
  /** 0-based index of rows[0] in the full (filtered) list, for numbering */
  offset: number;
  columns: PlanColumn[];
  levels: LevelColumn[];
  mode: GridMode;
  /** keys of rows whose user/facility assignment no longer exists in DHIS2 */
  staleKeys: Set<string>;
  onCellChange: (rowKey: string, colKey: string, items: CellItem[]) => void;
  onNoteChange: (rowKey: string, note: string) => void;
}

interface Editing {
  rowKey: string;
  colKey: string;
  anchor: HTMLElement;
}

const th =
  'sticky top-0 z-10 border-b border-line bg-panel2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap';
const td = 'border-b border-line px-3 py-1.5 align-top text-[13px]';

export const MicroplanGrid: React.FC<Props> = ({
  rows,
  offset,
  columns,
  levels,
  mode,
  staleKeys,
  onCellChange,
  onNoteChange,
}) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);

  // close the editor if its row leaves the page (paging, filtering)
  useEffect(() => {
    if (editing && !rows.some((r) => r.key === editing.rowKey)) setEditing(null);
  }, [rows, editing]);

  const open = useCallback((rowKey: string, colKey: string, anchor: HTMLElement) => {
    setEditing((cur) =>
      cur && cur.rowKey === rowKey && cur.colKey === colKey ? null : { rowKey, colKey, anchor }
    );
  }, []);

  const close = useCallback(() => setEditing(null), []);

  const warm = useCallback(
    (row: PlanRow) => {
      const scope = scopeOf(row.ancestors);
      if (scope && mode.editCells) void prefetchWardSettlements(qc, scope);
    },
    [qc, mode.editCells]
  );

  // Spreadsheet keyboard: arrows move focus between cells in the same grid.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const el = e.target as HTMLElement;
    const pos = el.dataset.cell;
    if (!pos) return;
    const [r, c] = pos.split(':').map(Number);
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[e.key];
    if (!d) return;
    const next = e.currentTarget.querySelector<HTMLElement>(
      `[data-cell="${r + d[0]}:${c + d[1]}"]`
    );
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const editingRow = editing ? rows.find((r) => r.key === editing.rowKey) : undefined;
  const editingCol = editing ? columns.find((c) => c.key === editing.colKey) : undefined;

  const usedElsewhere = useMemo(() => {
    if (!editingRow || !editing) return undefined;
    const m = new Map<string, string[]>();
    for (const c of columns) {
      if (c.key === editing.colKey) continue;
      for (const it of editingRow.cells[c.key] ?? []) {
        m.set(it.id, [...(m.get(it.id) ?? []), c.label.replace('Week ', 'W')]);
      }
    }
    return m;
  }, [editingRow, editing, columns]);

  return (
    <>
      <table className="w-full border-separate border-spacing-0" onKeyDown={onKeyDown}>
        <thead>
          <tr>
            <th className={cn(th, 'w-10 text-right')}>#</th>
            {levels.map((l) => (
              <th key={l.level} className={th}>
                {l.name}
              </th>
            ))}
            <th className={cn(th, 'z-20 md:sticky md:left-0 md:shadow-[1px_0_0_var(--color-line)]')}>
              Facility
            </th>
            <th className={th}>Assigned to</th>
            {columns.map((c) => (
              <th key={c.key} className={cn(th, 'min-w-[12rem]')}>
                <span className="block text-ink">{c.label}</span>
                <span className="block text-[10.5px] font-medium normal-case tracking-normal text-faint">
                  {c.range}
                </span>
              </th>
            ))}
            {mode.showNotes && <th className={cn(th, 'min-w-[14rem]')}>Review note</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <GridRow
              key={row.key}
              row={row}
              index={i}
              number={offset + i + 1}
              repeat={i > 0 && rows[i - 1].facility.id === row.facility.id}
              columns={columns}
              levels={levels}
              mode={mode}
              stale={staleKeys.has(row.key)}
              editingCol={editing?.rowKey === row.key ? editing.colKey : null}
              onOpen={open}
              onWarm={warm}
              onNoteChange={onNoteChange}
            />
          ))}
        </tbody>
      </table>

      {editing && editingRow && editingCol && (
        <SettlementCellEditor
          key={`${editing.rowKey}:${editing.colKey}`}
          anchor={editing.anchor}
          title={`${editingCol.label} · ${editingCol.range}`}
          subtitle={`${editingRow.facility.name}${editingRow.user ? ` — ${editingRow.user.name}` : ''}`}
          scope={scopeOf(editingRow.ancestors)}
          value={editingRow.cells[editing.colKey] ?? []}
          readOnly={!mode.editCells}
          usedElsewhere={usedElsewhere}
          onChange={(items) => onCellChange(editing.rowKey, editing.colKey, items)}
          onClose={close}
        />
      )}
    </>
  );
};

/* ---- one row ------------------------------------------------------------- */

interface RowProps {
  row: PlanRow;
  index: number;
  number: number;
  /** same facility as the row above — de-emphasise the repeated org-unit text */
  repeat: boolean;
  columns: PlanColumn[];
  levels: LevelColumn[];
  mode: GridMode;
  stale: boolean;
  editingCol: string | null;
  onOpen: (rowKey: string, colKey: string, anchor: HTMLElement) => void;
  onWarm: (row: PlanRow) => void;
  onNoteChange: (rowKey: string, note: string) => void;
}

const GridRow = memo<RowProps>(
  ({ row, index, number, repeat, columns, levels, mode, stale, editingCol, onOpen, onWarm, onNoteChange }) => {
    const byLevel = useMemo(() => new Map(row.ancestors.map((a) => [a.level, a.name])), [row.ancestors]);
    const orgText = repeat ? 'text-faint' : 'text-ink';
    // cell column indexes for keyboard nav start after the fixed columns
    return (
      <tr className="group">
        <td className={cn(td, 'text-right text-[11.5px] tabular-nums text-faint group-hover:bg-panel2/60')}>
          {number}
        </td>
        {levels.map((l) => (
          <td key={l.level} className={cn(td, orgText, 'whitespace-nowrap group-hover:bg-panel2/60')}>
            {byLevel.get(l.level) ?? '—'}
          </td>
        ))}
        <td
          className={cn(
            td,
            orgText,
            'bg-panel font-medium group-hover:bg-panel2 md:sticky md:left-0 md:z-[5] md:shadow-[1px_0_0_var(--color-line)]'
          )}
        >
          <span className="block max-w-[16rem] truncate" title={row.facility.name}>
            {row.facility.name}
          </span>
        </td>
        <td className={cn(td, 'whitespace-nowrap group-hover:bg-panel2/60')}>
          {row.user ? (
            <span className="flex flex-col leading-tight">
              <span>{row.user.name}</span>
              <span className="text-[11px] text-faint">{row.user.username}</span>
            </span>
          ) : (
            <span className="text-[12px] italic text-faint">Unassigned</span>
          )}
          {stale && (
            <span
              className="mt-0.5 block text-[10.5px] font-medium text-amber-700"
              title="This user is no longer assigned to the facility in DHIS2. The row is kept because it holds planned settlements."
            >
              no longer assigned
            </span>
          )}
        </td>
        {columns.map((c, ci) => (
          <td key={c.key} className={cn(td, 'p-1 group-hover:bg-panel2/60')}>
            <CellButton
              items={row.cells[c.key] ?? []}
              editable={mode.editCells}
              active={editingCol === c.key}
              pos={`${index}:${ci}`}
              label={`${c.label}, ${row.facility.name}`}
              onOpen={(el) => onOpen(row.key, c.key, el)}
              onWarm={() => onWarm(row)}
            />
          </td>
        ))}
        {mode.showNotes && (
          <td className={cn(td, 'p-1 group-hover:bg-panel2/60')}>
            <NoteCell
              value={row.note ?? ''}
              editable={mode.editNotes}
              pos={`${index}:${columns.length}`}
              onCommit={(v) => onNoteChange(row.key, v)}
            />
          </td>
        )}
      </tr>
    );
  }
);
GridRow.displayName = 'GridRow';

/* ---- cells --------------------------------------------------------------- */

const CellButton: React.FC<{
  items: CellItem[];
  editable: boolean;
  active: boolean;
  pos: string;
  label: string;
  onOpen: (el: HTMLElement) => void;
  onWarm: () => void;
}> = ({ items, editable, active, pos, label, onOpen, onWarm }) => {
  const shown = items.slice(0, 2);
  const more = items.length - shown.length;
  return (
    <button
      type="button"
      data-cell={pos}
      aria-label={`${label}: ${items.length} settlement(s)${editable ? ', press Enter to edit' : ''}`}
      aria-haspopup="dialog"
      aria-expanded={active}
      title={items.map((i) => i.name).join('\n') || undefined}
      onClick={(e) => onOpen(e.currentTarget)}
      onMouseEnter={onWarm}
      onFocus={onWarm}
      className={cn(
        'flex min-h-9 w-full flex-wrap content-start items-center gap-1 rounded-md border px-1.5 py-1 text-left transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        active
          ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
          : editable
            ? 'border-transparent hover:border-accent/50 hover:bg-panel'
            : 'cursor-default border-transparent'
      )}
    >
      {shown.map((it) => (
        <span
          key={it.id}
          className="max-w-[9rem] truncate rounded-full bg-accent/10 px-2 py-0.5 text-[11.5px] text-accent"
        >
          {it.name}
        </span>
      ))}
      {more > 0 && (
        <span className="rounded-full bg-panel2 px-1.5 py-0.5 text-[11px] font-medium text-muted">
          +{more}
        </span>
      )}
      {items.length === 0 && (
        <span className="px-1 text-[12px] text-faint">{editable ? '+ Add settlements' : '—'}</span>
      )}
    </button>
  );
};

const NoteCell: React.FC<{
  value: string;
  editable: boolean;
  pos: string;
  onCommit: (v: string) => void;
}> = ({ value, editable, pos, onCommit }) => {
  // local draft, committed on blur — typing a note doesn't re-render the grid
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (!editable) {
    return (
      <div data-cell={pos} tabIndex={-1} className="min-h-9 whitespace-pre-wrap px-1.5 py-1.5 text-[12.5px] text-ink">
        {value || <span className="text-faint">—</span>}
      </div>
    );
  }
  return (
    <textarea
      data-cell={pos}
      rows={1}
      value={draft}
      placeholder="Add a note for this row…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        // arrows inside a multi-line note move the caret, not the cell
        if (e.key.startsWith('Arrow') && draft) e.stopPropagation();
      }}
      className="block min-h-9 w-full resize-y rounded-md border border-line bg-amber-50/60 px-2 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
    />
  );
};
