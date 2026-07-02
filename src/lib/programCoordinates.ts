/**
 * Discovers the analytics dimensions that carry COORDINATE values for a DHIS2
 * program, so we can map enrollment/event coordinates.
 *
 * Two dimension families (per the DHIS2 metadata):
 *   1. Tracked-entity ATTRIBUTES with valueType == COORDINATE
 *      → analytics dimension id is just the attribute id, e.g. "jJ82mWtkUW5".
 *   2. Program-stage DATA ELEMENTS with valueType == COORDINATE
 *      → analytics dimension id is "programStageId.dataElementId",
 *        e.g. "fqpWUfWREMt.qFXvyGSHNEt".
 *
 * Metadata endpoints used:
 *   /api/programs/{id}?fields=programTrackedEntityAttributes[trackedEntityAttribute[id,displayName~rename(name),optionSet,valueType]]
 *   /api/programStages/{id}?fields=programStageDataElements[displayInReports,dataElement[id,code,displayName~rename(name),optionSet,valueType]]
 */

type Engine = { query: (q: unknown) => Promise<any> };

export type CoordinateDimensionKind = 'attribute' | 'stageDataElement';

export interface CoordinateDimension {
  /** analytics dimension id: "<attrId>" or "<stageId>.<deId>" */
  dimensionId: string;
  kind: CoordinateDimensionKind;
  name: string;
  attributeId?: string;
  programStageId?: string;
  programStageName?: string;
  dataElementId?: string;
}

/** Step 1 — COORDINATE tracked-entity attributes for the program. */
export async function fetchAttributeCoordinateDimensions(
  engine: Engine,
  programId: string
): Promise<CoordinateDimension[]> {
  const data: any = await engine.query({
    p: {
      resource: `programs/${programId}`,
      params: {
        fields:
          'programTrackedEntityAttributes[trackedEntityAttribute[id,displayName~rename(name),optionSet,valueType]]',
        paging: 'false',
      },
    },
  });
  const ptea = data.p.programTrackedEntityAttributes ?? [];
  return ptea
    .map((x: any) => x.trackedEntityAttribute)
    .filter((a: any) => a && a.valueType === 'COORDINATE')
    .map(
      (a: any): CoordinateDimension => ({
        dimensionId: a.id, // attribute dimension is just the attribute id
        kind: 'attribute',
        name: a.name ?? a.id,
        attributeId: a.id,
      })
    );
}

/** Step 2 — COORDINATE data elements for a single program stage. */
export async function fetchStageCoordinateDimensions(
  engine: Engine,
  stage: { id: string; name?: string }
): Promise<CoordinateDimension[]> {
  const data: any = await engine.query({
    s: {
      resource: `programStages/${stage.id}`,
      params: {
        fields:
          'programStageDataElements[displayInReports,dataElement[id,code,displayName~rename(name),optionSet,valueType]]',
        paging: 'false',
      },
    },
  });
  const psde = data.s.programStageDataElements ?? [];
  return psde
    .map((x: any) => x.dataElement)
    .filter((de: any) => de && de.valueType === 'COORDINATE')
    .map(
      (de: any): CoordinateDimension => ({
        dimensionId: `${stage.id}.${de.id}`, // stage.dataElement format
        kind: 'stageDataElement',
        name: de.name ?? de.id,
        programStageId: stage.id,
        programStageName: stage.name,
        dataElementId: de.id,
      })
    );
}

/**
 * All COORDINATE dimensions for a program: attributes + every stage's data
 * elements. Needs the program's stage list (id,name), which the caller already
 * has from usePrograms.
 */
export async function fetchProgramCoordinateDimensions(
  engine: Engine,
  programId: string,
  stages: { id: string; name?: string }[]
): Promise<CoordinateDimension[]> {
  const [attrDims, ...stageDimLists] = await Promise.all([
    fetchAttributeCoordinateDimensions(engine, programId),
    ...stages.map((s) => fetchStageCoordinateDimensions(engine, s)),
  ]);
  return [attrDims, ...stageDimLists].flat();
}
