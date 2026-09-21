import { useDataEngine } from '@dhis2/app-runtime';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  readSettings,
  writeSettings,
  type MicroplanSettings,
} from '../lib/microplanSettings';

export const SETTINGS_QUERY_KEY = ['microplan-settings'] as const;

/**
 * The app's access settings from dataStore/microplan/settings.
 *
 * Deliberately no `placeholderData`: every permission check consults this, and
 * a placeholder would report success while holding empty settings, so a user
 * whose only grant is a settings grant would see the "no permission" screen
 * flash before the real key landed. A missing key already resolves to empty
 * settings inside `readSettings`, so the only thing left to wait for is a
 * genuine round-trip.
 */
export function useMicroplanSettings() {
  const engine = useDataEngine();
  return useQuery<MicroplanSettings>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => readSettings(engine as any),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * Save the settings key. The whole object is written at once rather than
 * patched: the page edits a single in-memory draft, and a full replace is the
 * only write that can't interleave two admins' partial updates into a state
 * neither of them chose.
 */
export function useSaveMicroplanSettings() {
  const engine = useDataEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ settings, updatedBy }: { settings: MicroplanSettings; updatedBy: string }) =>
      writeSettings(engine as any, settings, updatedBy),
    onSuccess: (saved) => {
      qc.setQueryData(SETTINGS_QUERY_KEY, saved);
      // Authorities are derived from the settings, so the permission cache has
      // to drop too or the admin keeps seeing the pre-save answer.
      qc.invalidateQueries({ queryKey: ['me', 'permissions'] });
    },
  });
}
