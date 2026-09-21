/**
 * A program's *dimensions* — its tracked-entity attributes and its program-stage
 * data elements — resolved once and reused by everything that needs to name,
 * group or request them:
 *
 *   - the map filter bar's grouped multiselect (pick extra columns),
 *   - the enrollment-analytics query (extra `dimension=` / `headers=` entries),
 *   - the analytics table's grouped header,
 *   - the per-tracked-entity profile shown in the map popup.
 *
 * Analytics dimension-id convention, which is what every caller keys off:
 *   - attribute          → "<attributeId>"
 *   - stage data element → "<stageId>.<dataElementId>"
 *
 * Grouping convention: attributes are the entity's **bio data** (one group);
 * data elements are grouped by the program stage they belong to, in the stage's
 * own sortOrder, so the popup and the table read in the order the form does.
 */

type Engine = { query: (q: unknown) => Promise<any> };

export type DimensionKind = 'attribute' | 'stageDataElement';

export interface DimensionOption {
  /** analytics dimension id */
  id: string;
  name: string;
  valueType?: string;
  kind: DimensionKind;
  /** attribute id or data element id, without the stage prefix */
  elementId: string;
  stageId?: string;
  stageName?: string;
  /** position within its own group, from DHIS2 metadata */
  sortOrder: number;
  /** attributes flagged `displayInList` are the ones worth showing first */
  displayInList?: boolean;
}

export interface DimensionGroup {
  /** BIO_GROUP_KEY for attributes, otherwise the program-stage id */
  key: string;
  label: string;
  kind: DimensionKind;
  options: DimensionOption[];
}

/** Group key used for the tracked-entity attributes ("bio data"). */
export const BIO_GROUP_KEY = 'attributes';
export const BIO_GROUP_LABEL = 'Bio data';
/** Group key for the enrollment's own columns (org unit, dates, who recorded). */
export const ENROLLMENT_GROUP_KEY = 'enrollment';
export const ENROLLMENT_GROUP_LABEL = 'Enrollment';

const PROGRAM_FIELDS = [
  'id',
  'displayName~rename(name)',
  'programTrackedEntityAttributes[sortOrder,displayInList,trackedEntityAttribute[id,displayName~rename(name),valueType]]',
  'programStages[id,sortOrder,displayName~rename(name),programStageDataElements[sortOrder,displayInReports,dataElement[id,displayName~rename(name),valueType]]]',
].join(',');

/**
 * Fetch a program's attribute + stage-data-element dimensions, grouped.
 * Plain function (not a hook) so the analytics query can call it too.
 */
export async function fetchProgramDimensionGroups(
  engine: Engine,
  programId: string
): Promise<DimensionGroup[]> {
  const data: any = await engine.query({
    p: {
      resource: `programs/${programId}`,
      params: { fields: PROGRAM_FIELDS, paging: 'false' },
    },
  });

  const groups: DimensionGroup[] = [];

  const attrs: DimensionOption[] = (data.p?.programTrackedEntityAttributes ?? [])
    .map((ptea: any, i: number) => ({ ptea, i }))
    .filter(({ ptea }: any) => ptea?.trackedEntityAttribute)
    .map(({ ptea, i }: any): DimensionOption => {
      const a = ptea.trackedEntityAttribute;
      return {
        id: a.id,
        name: a.name ?? a.id,
        valueType: a.valueType,
        kind: 'attribute',
        elementId: a.id,
        sortOrder: ptea.sortOrder ?? i,
        displayInList: ptea.displayInList ?? false,
      };
    })
    .sort((a: DimensionOption, b: DimensionOption) => a.sortOrder - b.sortOrder);

  if (attrs.length) {
    groups.push({
      key: BIO_GROUP_KEY,
      label: BIO_GROUP_LABEL,
      kind: 'attribute',
      options: attrs,
    });
  }

  const stages = [...(data.p?.programStages ?? [])].sort(
    (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  for (const stage of stages) {
    const opts: DimensionOption[] = (stage.programStageDataElements ?? [])
      .map((psde: any, i: number) => ({ psde, i }))
      .filter(({ psde }: any) => psde?.dataElement)
      .map(({ psde, i }: any): DimensionOption => {
        const de = psde.dataElement;
        return {
          id: `${stage.id}.${de.id}`,
          name: de.name ?? de.id,
          valueType: de.valueType,
          kind: 'stageDataElement',
          elementId: de.id,
          stageId: stage.id,
          stageName: stage.name ?? stage.id,
          sortOrder: psde.sortOrder ?? i,
        };
      })
      .sort((a: DimensionOption, b: DimensionOption) => a.sortOrder - b.sortOrder);

    if (opts.length) {
      groups.push({
        key: stage.id,
        label: stage.name ?? stage.id,
        kind: 'stageDataElement',
        options: opts,
      });
    }
  }

  return groups;
}

/** Every option across every group, in group order. */
export function flattenDimensionGroups(groups: DimensionGroup[]): DimensionOption[] {
  return groups.flatMap((g) => g.options);
}

/** dimension id → option, for labelling analytics columns and profile fields. */
export function dimensionIndex(groups: DimensionGroup[]): Map<string, DimensionOption> {
  const m = new Map<string, DimensionOption>();
  for (const o of flattenDimensionGroups(groups)) {
    m.set(o.id, o);
    // Analytics sometimes reports a stage data element under its bare element
    // id (no stage prefix) — index both so column labelling never falls back
    // to showing a raw UID.
    if (!m.has(o.elementId)) m.set(o.elementId, o);
  }
  return m;
}

/** Resolve the picked ids to their full option records, preserving group order. */
export function resolveDimensionIds(
  groups: DimensionGroup[],
  ids: readonly string[]
): DimensionOption[] {
  if (!ids.length) return [];
  const wanted = new Set(ids);
  return flattenDimensionGroups(groups).filter((o) => wanted.has(o.id));
}

/** The group a dimension belongs to: "Bio data" or the stage's name. */
export function groupOf(option: DimensionOption): { key: string; label: string } {
  return option.kind === 'attribute'
    ? { key: BIO_GROUP_KEY, label: BIO_GROUP_LABEL }
    : { key: option.stageId ?? BIO_GROUP_KEY, label: option.stageName ?? 'Stage' };
}
