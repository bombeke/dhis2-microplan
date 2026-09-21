import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  dimensionIndex,
  type DimensionGroup,
  type DimensionOption,
} from '../lib/programDimensions';
import type { ProfileField } from '../lib/analyticsEnrollments';
import { useProgramDimensions } from './useProgramDimensions';

/**
 * The **complete** profile of one tracked entity: its bio data (all
 * tracked-entity attributes) plus every event it has, grouped by program stage.
 *
 * The analytics row behind a map point already carries the bio data and the
 * data elements the user picked, which is what the popup paints immediately.
 * This hook is the second, on-demand half: it is only fired when a popup is
 * actually opened, and it fills in the stages the analytics query deliberately
 * doesn't request (see `fetchProgramCoordinatePoints`) — including repeated
 * stages, which analytics flattens into a single column and this doesn't.
 *
 * React Query caches by tracked entity, so hovering across a cluster of points
 * and coming back costs one request per entity, not one per hover.
 */

const FIVE_MIN = 5 * 60_000;

const FIELDS = [
  'trackedEntity',
  'trackedEntityType',
  'orgUnit',
  'createdAt',
  'updatedAt',
  'attributes[attribute,displayName,valueType,value]',
  'enrollments[enrollment,program,enrolledAt,occurredAt,status,orgUnit,orgUnitName,' +
    'attributes[attribute,displayName,valueType,value],' +
    'events[event,programStage,occurredAt,status,dataValues[dataElement,value]]]',
].join(',');

export interface ProfileEvent {
  id: string;
  stageId: string;
  stageName: string;
  occurredAt?: string;
  status?: string;
  fields: ProfileField[];
  /** how many fields carry a value */
  filled: number;
}

export interface ProfileStageEvents {
  id: string;
  name: string;
  events: ProfileEvent[];
}

export interface TrackedEntityProfile {
  trackedEntity: string;
  orgUnitName?: string;
  enrolledAt?: string;
  status?: string;
  bio: ProfileField[];
  stages: ProfileStageEvents[];
}

/** Format a DHIS2 date-ish string for display, leaving anything odd alone. */
export function formatDhis2Date(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  // date-only values shouldn't grow a misleading local time
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return dateOnly
    ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function buildProfile(
  te: any,
  programId: string | null | undefined,
  lookup: Map<string, DimensionOption>,
  groups: DimensionGroup[]
): TrackedEntityProfile {
  const enrollments: any[] = te?.enrollments ?? [];
  const enrollment =
    enrollments.find((e) => !programId || e.program === programId) ?? enrollments[0];

  // Attributes live on the entity, and (for program-scoped ones) on the
  // enrollment — merge, with the entity's own value winning.
  const attrValues = new Map<string, any>();
  for (const a of enrollment?.attributes ?? []) attrValues.set(a.attribute, a);
  for (const a of te?.attributes ?? []) attrValues.set(a.attribute, a);

  // Order bio data the way the program's form orders it, then append anything
  // the entity carries that the program doesn't list.
  const bio: ProfileField[] = [];
  const used = new Set<string>();
  const attributeGroup = groups.find((g) => g.kind === 'attribute');
  for (const option of attributeGroup?.options ?? []) {
    const a = attrValues.get(option.elementId);
    used.add(option.elementId);
    bio.push({
      id: option.id,
      label: option.name,
      value: a?.value == null ? '' : String(a.value),
      kind: 'attribute',
      valueType: option.valueType ?? a?.valueType,
    });
  }
  for (const [id, a] of attrValues) {
    if (used.has(id)) continue;
    bio.push({
      id,
      label: a.displayName ?? lookup.get(id)?.name ?? id,
      value: a.value == null ? '' : String(a.value),
      kind: 'attribute',
      valueType: a.valueType,
    });
  }

  // Events, grouped by stage in the program's own stage order.
  const stageOrder = groups.filter((g) => g.kind === 'stageDataElement');
  const byStage = new Map<string, ProfileStageEvents>();
  for (const g of stageOrder) byStage.set(g.key, { id: g.key, name: g.label, events: [] });

  for (const ev of enrollment?.events ?? []) {
    const stageId: string = ev.programStage;
    if (!byStage.has(stageId)) {
      byStage.set(stageId, {
        id: stageId,
        name: lookup.get(stageId)?.stageName ?? 'Stage',
        events: [],
      });
    }
    const section = byStage.get(stageId)!;
    const values = new Map<string, any>();
    for (const dv of ev.dataValues ?? []) values.set(dv.dataElement, dv.value);

    const stageGroup = groups.find((g) => g.key === stageId);
    const fields: ProfileField[] = [];
    const seen = new Set<string>();
    for (const option of stageGroup?.options ?? []) {
      seen.add(option.elementId);
      const v = values.get(option.elementId);
      fields.push({
        id: option.id,
        label: option.name,
        value: v == null ? '' : String(v),
        kind: 'stageDataElement',
        valueType: option.valueType,
        stageId,
      });
    }
    for (const [de, v] of values) {
      if (seen.has(de)) continue;
      fields.push({
        id: `${stageId}.${de}`,
        label: lookup.get(de)?.name ?? de,
        value: v == null ? '' : String(v),
        kind: 'stageDataElement',
        stageId,
      });
    }

    section.events.push({
      id: ev.event,
      stageId,
      stageName: section.name,
      occurredAt: ev.occurredAt,
      status: ev.status,
      fields,
      filled: fields.filter((f) => f.value !== '').length,
    });
  }

  for (const section of byStage.values()) {
    section.events.sort((a, b) => (a.occurredAt ?? '').localeCompare(b.occurredAt ?? ''));
  }

  return {
    trackedEntity: te?.trackedEntity ?? '',
    orgUnitName: enrollment?.orgUnitName ?? te?.orgUnitName,
    enrolledAt: enrollment?.enrolledAt,
    status: enrollment?.status,
    bio,
    // keep only stages that actually have events, so the popup isn't padded
    // with empty sections for stages this entity never reached
    stages: [...byStage.values()].filter((s) => s.events.length > 0),
  };
}

export function useTrackedEntityProfile(
  trackedEntityId: string | null | undefined,
  programId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  const engine = useDataEngine();
  const { data: groups = [] } = useProgramDimensions(programId);
  const lookup = useMemo(() => dimensionIndex(groups), [groups]);

  return useQuery<TrackedEntityProfile>({
    queryKey: ['tracked-entity-profile', trackedEntityId, programId, groups.length],
    enabled: !!trackedEntityId && (options?.enabled ?? true),
    staleTime: FIVE_MIN,
    gcTime: FIVE_MIN * 2,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        te: {
          resource: `tracker/trackedEntities/${trackedEntityId}`,
          params: {
            fields: FIELDS,
            ...(programId ? { program: programId } : {}),
          },
        },
      });
      return buildProfile(data.te, programId, lookup, groups);
    },
  });
}
