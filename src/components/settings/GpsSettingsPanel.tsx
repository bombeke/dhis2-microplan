import React from 'react';
import type { GpsSettings } from '../../lib/microplanSettings';
import { useOrgUnitLevels } from '../../hooks/useOrgUnitLevels';
import { cn } from '../../lib/ui';

/**
 * Settings → GPS places: the Manage Settlements switches.
 *
 * Each "Allow to … all GPS places" switch is the second half of a two-key
 * lock — the matching F_*_GPS_ALL_MICROPLAN authority lifts the data-capture
 * org-unit restriction only while the switch is on — so the copy names the
 * authority next to the switch it pairs with.
 */

const SWITCHES: {
  key: 'allowViewAll' | 'allowCreateAll' | 'allowApproveAll';
  title: string;
  authority: string;
  body: string;
}[] = [
  {
    key: 'allowViewAll',
    title: 'Allow to view all GPS places',
    authority: 'F_VIEW_GPS_ALL_MICROPLAN',
    body: 'Holders can see settlements outside their data capture org units.',
  },
  {
    key: 'allowCreateAll',
    title: 'Allow to create all GPS places',
    authority: 'F_CREATE_GPS_ALL_MICROPLAN',
    body: 'Holders can add and correct GPS for settlements outside their data capture org units (and see them).',
  },
  {
    key: 'allowApproveAll',
    title: 'Allow to approve all GPS places',
    authority: 'F_APPROVE_GPS_ALL_MICROPLAN',
    body: 'Holders can review, approve and sync settlements outside their data capture org units (and see them).',
  },
];

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }> = ({
  on,
  onChange,
  disabled,
  label,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60',
      on ? 'bg-accent' : 'bg-line'
    )}
  >
    <span className={cn('inline-block size-5 rounded-full bg-white shadow-card transition', on ? 'translate-x-5.5' : 'translate-x-0.5')} />
  </button>
);

export const GpsSettingsPanel: React.FC<{
  value: GpsSettings;
  onChange: (v: GpsSettings) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const { data: levels = [] } = useOrgUnitLevels();
  const set = <K extends keyof GpsSettings>(k: K, v: GpsSettings[K]) => onChange({ ...value, [k]: v });

  const levelSelect = (k: 'stateLevel' | 'lgaLevel' | 'wardLevel', label: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">{label}</span>
      <select
        value={value[k]}
        disabled={disabled}
        onChange={(e) => set(k, Number(e.target.value))}
        className="rounded-lg border border-line bg-panel px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      >
        {(levels.length ? levels : Array.from({ length: 6 }, (_, i) => ({ level: i + 1, name: `Level ${i + 1}` }))).map((l) => (
          <option key={l.level} value={l.level}>
            {l.name} (level {l.level})
          </option>
        ))}
      </select>
    </label>
  );

  const endpointOk = !value.syncEndpoint || /^(https?:\/\/|\/)/i.test(value.syncEndpoint);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="m-0 text-[14px] font-semibold text-ink">Access beyond data capture org units</h4>
          <p className="m-0 text-[13px] text-muted">
            On Manage Settlements everyone is limited to the settlements in their data capture org units. A user holding one
            of the authorities below goes beyond that limit only while its switch is on — both are needed.
          </p>
        </div>
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
          {SWITCHES.map((s) => (
            <div key={s.key} className="flex items-start gap-4 bg-panel p-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold text-ink">{s.title}</span>
                <span className="text-[12.5px] text-muted">{s.body}</span>
                <code className="mt-0.5 self-start rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-muted">{s.authority}</code>
              </div>
              <Toggle on={value[s.key]} onChange={(v) => set(s.key, v)} disabled={disabled} label={s.title} />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="m-0 text-[14px] font-semibold text-ink">Hierarchy levels</h4>
          <p className="m-0 text-[13px] text-muted">
            The settlement register knows places by state, LGA and ward name. Tell the app which DHIS2 levels those are, so it
            can turn an org unit — and each user’s data capture org units — into the register’s names.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {levelSelect('stateLevel', 'State level')}
          {levelSelect('lgaLevel', 'LGA level')}
          {levelSelect('wardLevel', 'Ward level')}
        </div>
        {!(value.stateLevel < value.lgaLevel && value.lgaLevel < value.wardLevel) && (
          <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200">
            State should be above LGA, and LGA above ward.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="m-0 text-[14px] font-semibold text-ink">Sync endpoint</h4>
          <p className="m-0 text-[13px] text-muted">
            Where approved updates are sent — the settlement register’s create/update/merge endpoint. Leave it empty until that
            endpoint exists: updates stay queued in DHIS2 and reviewers can download the queue as JSON.
          </p>
        </div>
        <input
          type="url"
          value={value.syncEndpoint}
          disabled={disabled}
          placeholder="https://maps.example.org/settlements/updates"
          onChange={(e) => set('syncEndpoint', e.target.value)}
          className={cn(
            'w-full rounded-lg border bg-panel px-3 py-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:ring-2',
            endpointOk ? 'border-line focus:border-accent focus:ring-accent/30' : 'border-flag focus:ring-flag/30'
          )}
        />
        <p className="m-0 text-[11.5px] text-faint">
          Updates are POSTed as <code>{'{ "updates": [...] }'}</code> in batches of 500, each with its audit fields (
          <code>createdBy</code>, <code>updatedAt</code>, <code>approvedBy</code>, <code>syncedAt</code>, <code>syncedBy</code>…).
        </p>
      </section>
    </div>
  );
};
