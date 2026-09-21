import React, { useMemo, useState } from 'react';
import { Checkbox, CircularLoader, IconCross16, NoticeBox, Tag } from '@dhis2/ui';
import type { EntityProfile, ProfileField } from '../lib/analyticsEnrollments';
import {
  formatDhis2Date,
  useTrackedEntityProfile,
  type ProfileEvent,
} from '../hooks/useTrackedEntityProfile';
import { cn } from '../lib/ui';

/**
 * The profile of a single tracked entity, as shown beside a map point.
 *
 * It is painted in two passes so the card never feels like it is waiting:
 *
 *  1. **Instantly** from the analytics row that produced the point — bio data
 *     (every tracked-entity attribute) plus the data elements the user picked
 *     in the filter bar. This costs nothing: the row is already in memory.
 *  2. **On open**, the full tracker profile is fetched and the stage sections
 *     are replaced with real events — one block per visit, in date order, so a
 *     repeated stage shows each of its events rather than analytics' single
 *     flattened column.
 *
 * Sections follow the program's own shape: "Bio data" first (the attributes),
 * then one section per program stage, named after the stage.
 */

/** Value types that carry no useful text in a card this size. */
const HIDDEN_VALUE_TYPES = new Set(['COORDINATE', 'FILE_RESOURCE', 'IMAGE']);

const isFilled = (f: ProfileField) => f.value !== '' && f.value != null;

/**
 * The attribute labels that name the tracked entity *itself*, in the order the
 * parts are joined in.
 *
 * Matched exactly (after normalising case and whitespace), and that exactness
 * is the whole point. A programme almost always carries a caregiver's name
 * beside the child's — "Caregiver First Name", "Mother's Surname" — and a
 * substring test for "name" picks those up just as happily as the child's own.
 * Titling a child's profile with their caregiver's name is worse than showing
 * no name at all, so a label with a word attached on either side is not a
 * candidate.
 *
 * "Surname" and "Last name" are the same slot under two spellings; only one of
 * them is populated in any given programme, and the dedupe below covers the
 * case where a programme somehow carries both with the same value.
 */
const OWN_NAME_LABELS = ['first name', 'middle name', 'surname', 'last name'] as const;

const normaliseLabel = (label: string) => label.trim().toLowerCase().replace(/\s+/g, ' ');

const isOwnNameLabel = (label: string) =>
  (OWN_NAME_LABELS as readonly string[]).includes(normaliseLabel(label));

/** The person's own name, assembled from their name attributes. */
export function displayNameFrom(bio: ProfileField[]): string | null {
  const parts = new Map<string, string>();
  for (const f of bio) {
    if (!isFilled(f) || !isOwnNameLabel(f.label)) continue;
    const key = normaliseLabel(f.label);
    // first value wins, so a duplicated attribute can't reorder the name
    if (!parts.has(key)) parts.set(key, f.value.trim());
  }

  const ordered = OWN_NAME_LABELS.map((k) => parts.get(k)).filter(Boolean) as string[];
  const name = [...new Set(ordered)].join(' ').trim();
  if (name) return name;

  // No own name on this programme. Fall back to something that identifies the
  // entity WITHOUT being somebody else's name: an ID or a code titles the card
  // usefully, whereas "Caregiver first name" would title it with the wrong
  // person — the exact failure the exact-match rule above exists to prevent.
  const fallback = bio.find(
    (f) => isFilled(f) && f.valueType !== 'COORDINATE' && !/name/i.test(f.label)
  );
  return fallback ? fallback.value : null;
}

function formatValue(f: ProfileField): string {
  if (!isFilled(f)) return '—';
  if (f.valueType === 'DATE' || f.valueType === 'DATETIME') return formatDhis2Date(f.value);
  if (f.valueType === 'BOOLEAN' || f.valueType === 'TRUE_ONLY') {
    return f.value === 'true' || f.value === '1' ? 'Yes' : 'No';
  }
  return f.value;
}

const FieldRows: React.FC<{ fields: ProfileField[]; showEmpty: boolean; className?: string }> = ({
  fields,
  showEmpty,
  className,
}) => {
  const visible = fields.filter(
    (f) => !HIDDEN_VALUE_TYPES.has(f.valueType ?? '') && (showEmpty || isFilled(f))
  );
  if (visible.length === 0) {
    return <p className={cn('m-0 py-2 text-xs text-muted', className)}>No values recorded.</p>;
  }
  return (
    <dl className={cn('m-0 flex flex-col gap-1.5', className)}>
      {visible.map((f) => (
        <div key={f.id} className="grid grid-cols-[45%_1fr] items-baseline gap-2.5">
          <dt className="m-0 truncate text-[11.5px] text-muted" title={f.label}>
            {f.label}
          </dt>
          <dd className={cn('m-0 break-words text-[12.5px]', !isFilled(f) && 'text-faint')}>
            {formatValue(f)}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const Section: React.FC<{
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, badge, defaultOpen, children }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="border-t border-line first:border-t-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-panel2"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          aria-hidden
          className={cn('text-[10px] text-faint transition-transform', open && 'rotate-90')}
        >
          ▸
        </span>
        <span className="flex-1 text-[12.5px] font-semibold">{title}</span>
        {badge != null && (
          <span className="rounded-full bg-panel2 px-2 py-px text-[10.5px] font-semibold tabular-nums text-muted">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-3.5 pb-3 pt-0.5">{children}</div>}
    </section>
  );
};

const EventBlock: React.FC<{ event: ProfileEvent; index: number; showEmpty: boolean }> = ({
  event,
  index,
  showEmpty,
}) => (
  <div className="border-line [&+&]:mt-2.5 [&+&]:border-t [&+&]:border-dashed [&+&]:pt-2.5">
    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11.5px] font-semibold">
      <span>{event.occurredAt ? formatDhis2Date(event.occurredAt) : `Visit ${index + 1}`}</span>
      {event.status && event.status !== 'COMPLETED' && (
        <em className="font-medium capitalize not-italic text-muted">
          {event.status.toLowerCase()}
        </em>
      )}
    </div>
    <FieldRows fields={event.fields} showEmpty={showEmpty} />
  </div>
);

export const TrackedEntityProfileCard: React.FC<{
  /** the profile pivoted from the analytics row — available immediately */
  profile?: EntityProfile;
  programId?: string | null;
  /** point context */
  flagged?: boolean;
  pointLabel?: string;
  stageName?: string;
  teamCode?: string | null;
  coordinate?: [number, number];
  distanceMeters?: number;
  /** compact = the hover preview; full = the pinned card */
  compact?: boolean;
  onClose?: () => void;
}> = ({
  profile,
  programId,
  flagged,
  pointLabel,
  stageName,
  teamCode,
  coordinate,
  distanceMeters,
  compact,
  onClose,
}) => {
  const [showEmpty, setShowEmpty] = useState(false);

  // Only the pinned card pays for the full tracker fetch; the hover preview
  // lives entirely off the analytics row.
  const { data: full, isLoading, isError } = useTrackedEntityProfile(
    profile?.trackedEntity,
    programId,
    { enabled: !compact && !!profile?.trackedEntity }
  );

  const bio = full?.bio ?? profile?.bio ?? [];
  const name = useMemo(() => displayNameFrom(bio), [bio]);
  const filledBio = bio.filter(isFilled).length;

  const shell =
    'flex flex-col overflow-hidden rounded-xl border border-line bg-panel text-ink shadow-float ' +
    'max-sm:rounded-b-none max-sm:rounded-t-2xl';

  const header = (
    <header className="shrink-0 border-b border-line bg-gradient-to-b from-[#fbfcfd] to-panel2 px-3.5 pb-2.5 pt-3">
      <div className="flex items-start gap-2">
        <h3 className="m-0 flex-1 break-words text-sm font-semibold leading-tight">
          {name ?? pointLabel ?? 'Tracked entity'}
        </h3>
        <Tag negative={!!flagged} positive={!flagged}>
          {flagged ? 'Outside area' : 'In area'}
        </Tag>
        {onClose && (
          <button
            type="button"
            aria-label="Close profile"
            className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-muted hover:bg-panel2 hover:text-ink"
            onClick={onClose}
          >
            <IconCross16 />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
        {[
          stageName,
          profile?.orgUnitName ?? full?.orgUnitName,
          teamCode ? `Team ${teamCode}` : null,
          flagged && distanceMeters != null && Number.isFinite(distanceMeters)
            ? `${Math.round(distanceMeters).toLocaleString()} m from nearest settlement`
            : null,
        ]
          .filter(Boolean)
          .map((bit, i) => (
            <span key={i} className="after:ml-2 after:text-line after:content-['·'] last:after:content-['']">
              {bit}
            </span>
          ))}
      </div>
    </header>
  );

  if (!profile) {
    return (
      <div className={shell}>
        {header}
        <p className="m-0 px-3.5 py-2.5 text-xs text-muted">No profile data for this point.</p>
      </div>
    );
  }

  if (compact) {
    const preview = bio.filter(isFilled).slice(0, 4);
    return (
      <div className={cn(shell, 'w-[min(18rem,calc(100vw-1.5rem))]')}>
        {header}
        <FieldRows fields={preview} showEmpty={false} className="px-3.5 pb-1 pt-2.5" />
        <p className="m-0 border-t border-line bg-panel2 px-3.5 py-2 text-[11px] text-muted">
          Click the point for the full profile
        </p>
      </div>
    );
  }

  const stageSections = full?.stages;

  return (
    <div className={cn(shell, 'max-h-[min(34rem,75vh)] max-sm:max-h-[75vh]')}>
      {header}

      {/* Header and footer are fixed; only this middle column scrolls, so the
          "show empty fields" switch stays reachable on a long record. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Section title="Bio data" badge={filledBio} defaultOpen>
          <FieldRows fields={bio} showEmpty={showEmpty} />
        </Section>

        {/* Before the tracker profile lands, the analytics row's stage columns
            already give a usable picture — show those rather than a blank pane. */}
        {!stageSections &&
          (profile.stages ?? [])
            .filter((s) => showEmpty || s.filled > 0)
            .map((s) => (
              <Section key={s.id} title={s.name} badge={s.filled}>
                <FieldRows fields={s.fields} showEmpty={showEmpty} />
              </Section>
            ))}

        {stageSections?.map((s) => (
          <Section
            key={s.id}
            title={s.name}
            badge={s.events.length > 1 ? `${s.events.length} visits` : s.events[0]?.filled}
          >
            {s.events.map((ev, i) => (
              <EventBlock key={ev.id} event={ev} index={i} showEmpty={showEmpty} />
            ))}
          </Section>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-xs text-muted">
            <CircularLoader small />
            <span>Loading stages…</span>
          </div>
        )}
        {isError && (
          <div className="px-3.5 py-2.5">
            <NoticeBox warning>
              Couldn't load the full record. The values above come from analytics.
            </NoticeBox>
          </div>
        )}
        {!isLoading && stageSections?.length === 0 && (profile.stages ?? []).length === 0 && (
          <p className="m-0 px-3.5 py-2.5 text-xs text-muted">
            No stage data recorded for this entity.
          </p>
        )}

        {/* Last, and collapsed: who entered this and when. It is what you need
            to chase a flagged point back to a person, and nothing else. */}
        {profile.identification.length > 0 && (
          <Section title="Record details">
            <FieldRows fields={profile.identification} showEmpty={showEmpty} />
          </Section>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2.5 border-t border-line bg-panel2 px-3.5 py-1.5 text-[11.5px] text-muted">
        <Checkbox
          dense
          checked={showEmpty}
          label={<span className="text-[11.5px]">Show empty fields</span>}
          onChange={() => setShowEmpty((v) => !v)}
        />
        {coordinate && (
          <span className="shrink-0 font-mono text-[11px]">
            {coordinate[1].toFixed(5)}, {coordinate[0].toFixed(5)}
          </span>
        )}
      </footer>
    </div>
  );
};
