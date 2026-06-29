import { useDataEngine, useDataQuery } from '@dhis2/app-runtime';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  readIndex,
  loadMicroplan,
  saveMicroplan,
  deleteMicroplan,
  type MicroplanIndexEntry,
  type StoredMicroplan,
} from '../lib/microplanStore';

const ME_QUERY = {
  me: { resource: 'me', params: { fields: 'id,username,name' } },
};

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
}

export function useCurrentUser(): CurrentUser | undefined {
  const { data } = useDataQuery(ME_QUERY);
  return (data as any)?.me;
}

/** The uploaded-microplan catalogue (lightweight, for lists + filters). */
export function useMicroplanIndex() {
  const engine = useDataEngine();
  return useQuery<MicroplanIndexEntry[]>({
    queryKey: ['microplan-index'],
    queryFn: () => readIndex(engine as any),
    staleTime: 30_000,
  });
}

/** One full microplan, loaded on demand. */
export function useMicroplan(id: string | null) {
  const engine = useDataEngine();
  return useQuery<StoredMicroplan | null>({
    queryKey: ['microplan', id],
    enabled: !!id,
    queryFn: () => loadMicroplan(engine as any, id as string),
  });
}

export function useSaveMicroplan() {
  const engine = useDataEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (plan: StoredMicroplan) => saveMicroplan(engine as any, plan),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['microplan-index'] });
    },
  });
}

export function useDeleteMicroplan() {
  const engine = useDataEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMicroplan(engine as any, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['microplan-index'] });
    },
  });
}
