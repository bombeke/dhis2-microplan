import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Fetches the DHIS2 programs (activities) and their stages via
 *   api/programs.json?fields=id,name,code,programStage[id,name,code]
 * A "program" in DHIS2 corresponds to the activity a microplan/outreach belongs
 * to. Cached for 10 minutes since the program list rarely changes within a
 * session; used by both the map's program filter and the upload page.
 */

export interface ProgramStage {
  id: string;
  name: string;
  code?: string;
}

export interface Program {
  id: string;
  name: string;
  code?: string;
  programStages: ProgramStage[];
}

const TEN_MIN = 10 * 60_000;

export function usePrograms() {
  const engine = useDataEngine();
  return useQuery<Program[]>({
    queryKey: ['programs-list'],
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        programs: {
          resource: 'programs',
          params: {
            fields: 'id,name,code,programStages[id,name,code]',
            paging: 'false',
            order: 'name:asc',
          },
        },
      });
      return (data.programs.programs ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        programStages: (p.programStages ?? []).map((s: any) => ({
          id: s.id,
          name: s.name,
          code: s.code,
        })),
      }));
    },
  });
}
