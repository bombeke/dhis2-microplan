import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Fetches a program's tracked-entity attributes and its program-stage data
 * elements, grouped for the FilterMap multiselect:
 *   - attributes as one group ("Attributes")
 *   - data elements grouped by their program stage
 *
 * Each option id matches the analytics dimension id convention used elsewhere:
 *   - attribute        → "<attributeId>"
 *   - stage dataElement → "<stageId>.<dataElementId>"
 */

const TEN_MIN = 10 * 60_000;

export interface DimensionOption {
  id: string; // analytics dimension id
  name: string;
  valueType?: string;
  kind: 'attribute' | 'stageDataElement';
  stageId?: string;
  stageName?: string;
}

export interface DimensionGroup {
  key: string; // 'attributes' or a stage id
  label: string;
  options: DimensionOption[];
}

export function useProgramDimensions(programId: string | null | undefined) {
  const engine = useDataEngine();
  return useQuery<DimensionGroup[]>({
    queryKey: ['program-dimensions', programId],
    enabled: !!programId,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        p: {
          resource: `programs/${programId}`,
          params: {
            fields:
              'programTrackedEntityAttributes[trackedEntityAttribute[id,displayName~rename(name),valueType]],' +
              'programStages[id,displayName~rename(name),programStageDataElements[dataElement[id,displayName~rename(name),valueType]]]',
            paging: 'false',
          },
        },
      });

      const groups: DimensionGroup[] = [];

      const attrs: DimensionOption[] = (data.p.programTrackedEntityAttributes ?? [])
        .map((x: any) => x.trackedEntityAttribute)
        .filter(Boolean)
        .map((a: any) => ({
          id: a.id,
          name: a.name ?? a.id,
          valueType: a.valueType,
          kind: 'attribute' as const,
        }));
      if (attrs.length) groups.push({ key: 'attributes', label: 'Attributes', options: attrs });

      for (const stage of data.p.programStages ?? []) {
        const opts: DimensionOption[] = (stage.programStageDataElements ?? [])
          .map((x: any) => x.dataElement)
          .filter(Boolean)
          .map((de: any) => ({
            id: `${stage.id}.${de.id}`,
            name: de.name ?? de.id,
            valueType: de.valueType,
            kind: 'stageDataElement' as const,
            stageId: stage.id,
            stageName: stage.name,
          }));
        if (opts.length)
          groups.push({ key: stage.id, label: stage.name ?? stage.id, options: opts });
      }

      return groups;
    },
  });
}
