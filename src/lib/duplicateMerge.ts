import { USER_FIELDS, type Resolved, type TrackerPayload } from './duplicateStore';

/**
 * The manual merge of a group of duplicate tracked entities.
 *
 * Every member of the group that isn't retained takes part; one of them is
 * *kept* and every other one is folded into it and deleted on acceptance:
 *
 *  - **Attributes** (bio data) are matched by attribute across all records.
 *    Where only one record has a value it is taken; where records disagree the
 *    reviewer picks the value of any one of them — the oldest is "first", the
 *    newest "last" — or types a **custom** correction.
 *  - **Events** are clustered into *visits* per programme stage: a
 *    non-repeatable stage has one visit, a repeatable stage one visit per day.
 *    A visit several records share is merged data element by data element,
 *    like the attributes, into the kept record's event (or a new one when the
 *    kept record doesn't have that visit). A visit only one removed record has
 *    is copied across (with a new id) — each can be left out.
 *  - The **enrollment** dates are merged the same way; if the kept record isn't
 *    enrolled, a new enrollment is created on it.
 *
 * Choices name the tracked entity a value comes from, never a column
 * position, so changing which record is kept — or retaining one — never
 * changes what a choice means.
 *
 * The result is a flat tracker payload for
 * `POST /api/tracker?async=false&importStrategy=CREATE_AND_UPDATE`, written
 * with the kept record's ids so accepting it updates that record in place.
 */

type Engine = { query: (q: unknown) => Promise<any> };

/* ---- metadata ------------------------------------------------------------------ */

export interface MetaAttribute {
  id: string;
  name: string;
  valueType?: string;
  unique?: boolean;
}

export interface MetaStage {
  id: string;
  name: string;
  repeatable: boolean;
  dataElements: { id: string; name: string; valueType?: string }[];
}

export interface ProgramMeta {
  id: string;
  name: string;
  trackedEntityType: string;
  /** attributes of the tracked entity type — written on the tracked entity */
  tetAttributes: Set<string>;
  /** every attribute either the type or the programme knows, in form order */
  attributes: MetaAttribute[];
  stages: MetaStage[];
}

export async function fetchProgramMeta(engine: Engine, programId: string): Promise<ProgramMeta> {
  const data: any = await engine.query({
    p: {
      resource: `programs/${programId}`,
      params: {
        fields: [
          'id',
          'displayName',
          'trackedEntityType[id,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType,unique]]]',
          'programTrackedEntityAttributes[sortOrder,trackedEntityAttribute[id,displayName,valueType,unique]]',
          'programStages[id,displayName,repeatable,sortOrder,programStageDataElements[sortOrder,dataElement[id,displayName,valueType]]]',
        ].join(','),
      },
    },
  });
  const p = data.p ?? {};
  const attrs = new Map<string, MetaAttribute>();
  const add = (a: any) =>
    a?.id && !attrs.has(a.id) && attrs.set(a.id, { id: a.id, name: a.displayName ?? a.id, valueType: a.valueType, unique: !!a.unique });
  [...(p.programTrackedEntityAttributes ?? [])]
    .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .forEach((x: any) => add(x.trackedEntityAttribute));
  const tet = new Set<string>();
  for (const x of p.trackedEntityType?.trackedEntityTypeAttributes ?? []) {
    add(x.trackedEntityAttribute);
    if (x.trackedEntityAttribute?.id) tet.add(x.trackedEntityAttribute.id);
  }
  return {
    id: p.id,
    name: p.displayName ?? p.id,
    trackedEntityType: p.trackedEntityType?.id ?? '',
    tetAttributes: tet,
    attributes: [...attrs.values()],
    stages: [...(p.programStages ?? [])]
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((s: any) => ({
        id: s.id,
        name: s.displayName ?? s.id,
        repeatable: !!s.repeatable,
        dataElements: [...(s.programStageDataElements ?? [])]
          .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((d: any) => ({ id: d.dataElement?.id, name: d.dataElement?.displayName ?? d.dataElement?.id, valueType: d.dataElement?.valueType })),
      })),
  };
}

const TE_FIELDS = [
  'trackedEntity',
  'trackedEntityType',
  'orgUnit',
  'createdAt',
  'updatedAt',
  `createdBy[${USER_FIELDS}]`,
  `updatedBy[${USER_FIELDS}]`,
  'attributes[attribute,displayName,valueType,value]',
  'enrollments[enrollment,program,orgUnit,orgUnitName,enrolledAt,occurredAt,status,createdAt,' +
    'attributes[attribute,displayName,valueType,value],' +
    'events[event,programStage,orgUnit,orgUnitName,occurredAt,scheduledAt,status,createdAt,dataValues[dataElement,value]]]',
].join(',');

/** The whole tracked entity (every enrollment and event), or null when it no longer exists. */
export async function fetchTrackedEntity(engine: Engine, id: string): Promise<any | null> {
  try {
    const data: any = await engine.query({ te: { resource: `tracker/trackedEntities/${id}`, params: { fields: TE_FIELDS } } });
    return data.te ?? null;
  } catch (e: any) {
    if (e?.details?.httpStatusCode === 404 || /not found|404/i.test(e?.message ?? '')) return null;
    throw e;
  }
}


/* ---- model ------------------------------------------------------------------------ */

export type FieldKind = 'attribute' | 'enrollment' | 'dataValue';

export interface MergeField {
  /** unique within the merge: `a:<attr>`, `n:<prop>`, `d:<visitKey>:<de>` */
  key: string;
  kind: FieldKind;
  id: string;
  label: string;
  valueType?: string;
  unique?: boolean;
  /** one value per record, in MergeModel.ids order ('' when it has none) */
  values: string[];
  /** two or more different non-empty values */
  conflict: boolean;
}

/** One visit of one stage, across the records: a non-repeatable stage, or one day of a repeatable one. */
export interface Visit {
  key: string;
  stageId: string;
  stageName: string;
  date: string;
  /** one event (or null) per record, in MergeModel.ids order */
  events: (any | null)[];
  /** data values to resolve — only for visits two or more records share */
  fields: MergeField[];
}

export interface MergeModel {
  programId: string;
  /** tracked entity ids taking part, oldest first */
  ids: string[];
  records: any[];
  /** each record's enrollment in the programme */
  enrollments: (any | undefined)[];
  attributes: MergeField[];
  enrollmentFields: MergeField[];
  visits: Visit[];
  /** per record: enrollments in *other* programmes — lost if that record is removed */
  otherPrograms: number[];
}

const str = (v: unknown) => (v == null ? '' : String(v));
const day = (iso?: string) => (iso ?? '').slice(0, 10);
const same = (a: string, b: string) => a.trim() === b.trim();
const distinct = (values: string[]) => new Set(values.map((v) => v.trim()).filter(Boolean)).size;
export const sharedBy = (v: Visit) => v.events.filter(Boolean).length;

function attrValues(te: any, programId: string): Map<string, string> {
  const m = new Map<string, string>();
  const enr = (te?.enrollments ?? []).find((e: any) => e.program === programId);
  for (const a of enr?.attributes ?? []) m.set(a.attribute, str(a.value));
  for (const a of te?.attributes ?? []) m.set(a.attribute, str(a.value));
  return m;
}

const field = (key: string, kind: FieldKind, id: string, label: string, values: string[], extra?: Partial<MergeField>): MergeField => ({
  key,
  kind,
  id,
  label,
  values,
  conflict: distinct(values) > 1,
  ...extra,
});

/** Build the merge over `records` (oldest first — retained records already left out). */
export function buildMergeModel(records: any[], meta: ProgramMeta): MergeModel {
  const programId = meta.id;
  const ids = records.map((r) => r.trackedEntity as string);
  const attrMaps = records.map((r) => attrValues(r, programId));

  const known = new Map(meta.attributes.map((a) => [a.id, a]));
  const attrIds = meta.attributes.map((a) => a.id);
  for (const m of attrMaps) for (const id of m.keys()) if (!attrIds.includes(id)) attrIds.push(id);
  const nameOf = (id: string) =>
    known.get(id)?.name ??
    records.flatMap((r) => r?.attributes ?? []).find((a: any) => a.attribute === id)?.displayName ??
    id;
  const attributes = attrIds
    .map((id) =>
      field(`a:${id}`, 'attribute', id, nameOf(id), attrMaps.map((m) => m.get(id) ?? ''), {
        valueType: known.get(id)?.valueType,
        unique: known.get(id)?.unique,
      })
    )
    .filter((f) => f.values.some(Boolean));

  const enrollments = records.map((r) => (r?.enrollments ?? []).find((e: any) => e.program === programId));
  const enrolled = enrollments.filter(Boolean).length;
  const enrollmentFields =
    enrolled >= 2
      ? [
          field('n:enrolledAt', 'enrollment', 'enrolledAt', 'Enrollment date', enrollments.map((e) => day(e?.enrolledAt)), { valueType: 'DATE' }),
          field('n:occurredAt', 'enrollment', 'occurredAt', 'Incident date', enrollments.map((e) => day(e?.occurredAt)), { valueType: 'DATE' }),
        ].filter((f) => f.values.some(Boolean))
      : [];

  // cluster every event into a visit
  const stageOf = new Map(meta.stages.map((s) => [s.id, s]));
  const visits: Visit[] = [];
  const open = new Map<string, Visit[]>();
  const stageIds = [...meta.stages.map((s) => s.id)];
  for (const enr of enrollments) for (const ev of enr?.events ?? []) if (!stageIds.includes(ev.programStage)) stageIds.push(ev.programStage);
  const stageRank = new Map(stageIds.map((id, i) => [id, i]));

  enrollments.forEach((enr, i) => {
    const evs = [...(enr?.events ?? [])].sort((a, b) => str(a.occurredAt ?? a.scheduledAt).localeCompare(str(b.occurredAt ?? b.scheduledAt)));
    for (const ev of evs) {
      const stage = stageOf.get(ev.programStage);
      const date = day(ev.occurredAt ?? ev.scheduledAt);
      const base = stage && !stage.repeatable ? ev.programStage : `${ev.programStage}:${date}`;
      const candidates = open.get(base) ?? [];
      let v = candidates.find((c) => !c.events[i]);
      if (!v) {
        v = {
          key: candidates.length ? `${base}#${candidates.length}` : base,
          stageId: ev.programStage,
          stageName: stage?.name ?? 'Stage',
          date,
          events: records.map(() => null),
          fields: [],
        };
        candidates.push(v);
        open.set(base, candidates);
        visits.push(v);
      }
      v.events[i] = ev;
    }
  });

  for (const v of visits) {
    if (sharedBy(v) < 2) continue;
    const stage = stageOf.get(v.stageId);
    const maps = v.events.map((ev) => new Map<string, string>((ev?.dataValues ?? []).map((d: any) => [d.dataElement, str(d.value)])));
    const des = [...(stage?.dataElements ?? []).map((d) => d.id)];
    for (const m of maps) for (const id of m.keys()) if (!des.includes(id)) des.push(id);
    const deOf = new Map((stage?.dataElements ?? []).map((d) => [d.id, d]));
    v.fields = des
      .map((id) =>
        field(`d:${v.key}:${id}`, 'dataValue', id, deOf.get(id)?.name ?? id, maps.map((m) => m.get(id) ?? ''), {
          valueType: deOf.get(id)?.valueType,
        })
      )
      .filter((f) => f.values.some(Boolean));
  }
  visits.sort((a, b) => (stageRank.get(a.stageId) ?? 0) - (stageRank.get(b.stageId) ?? 0) || a.date.localeCompare(b.date));

  return {
    programId,
    ids,
    records,
    enrollments,
    attributes,
    enrollmentFields,
    visits,
    otherPrograms: records.map((r) => (r?.enrollments ?? []).filter((e: any) => e.program !== programId).length),
  };
}

export const allFields = (m: MergeModel): MergeField[] => [
  ...m.attributes,
  ...m.enrollmentFields,
  ...m.visits.flatMap((v) => v.fields),
];

/* ---- resolution ---------------------------------------------------------------------- */

/** The tracked entity a value is taken from, or a typed correction. */
export type Choice = { pick: string; custom?: undefined } | { pick: 'CUSTOM'; custom: string };

/** The choice a field starts with: the kept record's value on a conflict, otherwise the only value there is. */
export function defaultChoice(f: MergeField, ids: string[], keptId: string): Choice {
  const k = ids.indexOf(keptId);
  if (f.conflict && k >= 0 && f.values[k].trim()) return { pick: keptId };
  const i = f.values.findIndex((v) => v.trim());
  return { pick: ids[i >= 0 ? i : Math.max(k, 0)] };
}

/** A stored choice that still makes sense (its record may have been retained since), or the default. */
export const choiceFor = (f: MergeField, c: Choice | undefined, ids: string[], keptId: string): Choice =>
  c && (c.pick === 'CUSTOM' || ids.includes(c.pick)) ? c : defaultChoice(f, ids, keptId);

export const resolvedValue = (f: MergeField, c: Choice, ids: string[]): string =>
  c.pick === 'CUSTOM' ? (c.custom ?? '').trim() : f.values[ids.indexOf(c.pick)] ?? '';

/* ---- payload ---------------------------------------------------------------------------- */

/** A DHIS2 uid: 11 characters, a letter first. */
export function generateUid(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const chars = letters + '0123456789';
  const r = new Uint8Array(11);
  crypto.getRandomValues(r);
  let s = letters[r[0] % letters.length];
  for (let i = 1; i < 11; i++) s += chars[r[i] % chars.length];
  return s;
}

export interface BuiltMerge {
  payload: TrackerPayload;
  resolutions: Record<string, Resolved>;
  summary: { attributes: number; conflicts: number; eventsCopied: number; eventsMerged: number; otherPrograms: number };
  keptId: string;
  removedIds: string[];
}

const dateTime = (d: string) => (d ? (d.length === 10 ? `${d}T00:00:00.000` : d) : undefined);

const eventBody = (ev: any, programId: string, enrollment: string | undefined, id: string, dataValues: any[]) => ({
  event: id,
  programStage: ev.programStage,
  enrollment,
  program: programId,
  orgUnit: ev.orgUnit,
  occurredAt: ev.occurredAt,
  scheduledAt: ev.scheduledAt,
  status: ev.status,
  dataValues,
});

export function buildMergePayload(
  m: MergeModel,
  meta: ProgramMeta,
  keptId: string,
  choices: Record<string, Choice>,
  /** keys of single visits (one removed record only) to copy onto the kept record */
  include: Set<string>,
  /** stable ids for created events / a created enrollment, so a rebuilt payload keeps them */
  idFor: (key: string) => string = () => generateUid()
): BuiltMerge {
  const k = Math.max(0, m.ids.indexOf(keptId));
  const keep = m.records[k];
  const keepEnr = m.enrollments[k];
  const otherEnr = m.enrollments.find((e, i) => e && i !== k);

  const resolutions: Record<string, Resolved> = {};
  const val = (f: MergeField) => {
    const c = choiceFor(f, choices[f.key], m.ids, keptId);
    const v = resolvedValue(f, c, m.ids);
    resolutions[f.key] = { from: c.pick, value: v };
    return v;
  };
  const keptVal = (f: MergeField) => f.values[k] ?? '';

  // attributes: only what changes on the kept record is sent; '' → null clears it
  const teAttrs: any[] = [];
  const enrAttrs: any[] = [];
  for (const f of m.attributes) {
    const v = val(f);
    if (same(v, keptVal(f))) continue;
    const entry = { attribute: f.id, value: v === '' ? null : v };
    if (meta.tetAttributes.has(f.id) || !(keepEnr || otherEnr)) teAttrs.push(entry);
    else enrAttrs.push(entry);
  }

  // enrollment
  let enrollmentId: string | undefined = keepEnr?.enrollment;
  const enrollments: any[] = [];
  const dates: Record<string, string> = {};
  for (const f of m.enrollmentFields) dates[f.id] = val(f);
  if (keepEnr) {
    const changed = m.enrollmentFields.some((f) => !same(dates[f.id], keptVal(f)));
    if (changed || enrAttrs.length) {
      enrollments.push({
        enrollment: keepEnr.enrollment,
        trackedEntity: keep.trackedEntity,
        program: m.programId,
        orgUnit: keepEnr.orgUnit,
        status: keepEnr.status,
        enrolledAt: dateTime(dates.enrolledAt) ?? keepEnr.enrolledAt,
        occurredAt: dateTime(dates.occurredAt) ?? keepEnr.occurredAt,
        attributes: enrAttrs,
      });
    }
  } else if (otherEnr) {
    enrollmentId = idFor(`enrollment:${otherEnr.enrollment}`);
    enrollments.push({
      enrollment: enrollmentId,
      trackedEntity: keep.trackedEntity,
      program: m.programId,
      orgUnit: otherEnr.orgUnit,
      status: otherEnr.status === 'CANCELLED' ? 'ACTIVE' : otherEnr.status,
      enrolledAt: dateTime(dates.enrolledAt) ?? otherEnr.enrolledAt,
      occurredAt: dateTime(dates.occurredAt) ?? otherEnr.occurredAt,
      attributes: enrAttrs,
    });
  }

  // events
  const events: any[] = [];
  let eventsMerged = 0;
  let eventsCopied = 0;
  for (const v of m.visits) {
    if (sharedBy(v) >= 2) {
      const target = v.events[k];
      if (target) {
        const dvs: any[] = [];
        for (const f of v.fields) {
          const x = val(f);
          if (!same(x, keptVal(f))) dvs.push({ dataElement: f.id, value: x === '' ? null : x });
        }
        if (!dvs.length) continue;
        eventsMerged++;
        events.push(eventBody(target, m.programId, enrollmentId, target.event, dvs));
      } else {
        // the kept record never had this visit: create it from the merged values
        const dvs = v.fields.map((f) => ({ dataElement: f.id, value: val(f) })).filter((d) => d.value !== '');
        if (!enrollmentId) continue;
        eventsMerged++;
        const template = v.events.find(Boolean);
        events.push(eventBody(template, m.programId, enrollmentId, idFor(`visit:${v.key}`), dvs));
      }
      continue;
    }
    const owner = v.events.findIndex(Boolean);
    if (owner === k || owner < 0 || !include.has(v.key) || !enrollmentId) continue;
    eventsCopied++;
    const ev = v.events[owner];
    events.push(
      eventBody(
        ev,
        m.programId,
        enrollmentId,
        idFor(`event:${ev.event}`),
        (ev.dataValues ?? []).filter((d: any) => d.value !== '' && d.value != null).map((d: any) => ({ dataElement: d.dataElement, value: d.value }))
      )
    );
  }

  const removedIds = m.ids.filter((id) => id !== keep.trackedEntity);
  return {
    payload: {
      trackedEntities: [
        {
          trackedEntity: keep.trackedEntity,
          trackedEntityType: keep.trackedEntityType ?? meta.trackedEntityType,
          orgUnit: keep.orgUnit,
          attributes: teAttrs,
        },
      ],
      enrollments,
      events,
    },
    resolutions,
    summary: {
      attributes: m.attributes.length,
      conflicts: allFields(m).filter((f) => f.conflict).length,
      eventsCopied,
      eventsMerged,
      otherPrograms: m.otherPrograms.reduce((s, n, i) => (i === k ? s : s + n), 0),
    },
    keptId: keep.trackedEntity,
    removedIds,
  };
}

/** Rebuild the reviewer's choices from a stored record so "Edit merge" reopens where it was left. */
export function choicesFromResolutions(res: Record<string, Resolved>): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const [key, r] of Object.entries(res ?? {})) out[key] = r.from === 'CUSTOM' ? { pick: 'CUSTOM', custom: r.value } : { pick: r.from };
  return out;
}
