import type { Permission } from '@callisto/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { data, useApi } from './api';

/** Cache keys of the server data, in one place so that reads and invalidations cannot drift. */
export const queryKeys = {
  me: ['me'] as const,
  config: ['config'] as const,
  status: ['status'] as const,
  slots: (from: string, to: string) => ['slots', from, to] as const,
  allSlots: ['slots'] as const,
  conflicts: ['slots', 'conflicts'] as const,
  users: ['users'] as const,
  roles: ['roles'] as const,
  audit: (month: string) => ['audit', month] as const,
};

export function useMe() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => data(api.users.me.$get()),
    staleTime: 5 * 60_000,
  });
}

/** Whether the signed-in user may do something. The API enforces this; here it shapes the UI. */
export function useHasPermission(permission: Permission): boolean {
  return useMe().data?.role.permissions.includes(permission) ?? false;
}

/** The whole configuration of the practice; nearly every view reads from it. */
export function useConfig() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => data(api.admin.config.$get()),
  });
}

/** Whether the practice is open right now; refreshed every minute. */
export function useStatus() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => data(api.admin.status.$get()),
    refetchInterval: 60_000,
  });
}

/** Booked appointments that lie in a closure or on a public holiday. */
export function useConflicts() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.conflicts,
    queryFn: () => data(api.admin.slots.conflicts.$get()),
  });
}

/**
 * Call after a change to the configuration: slots, the opening status and the conflicts are all
 * derived from it, so they are refetched along with it.
 */
export function useInvalidatePlanning() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.config }),
      queryClient.invalidateQueries({ queryKey: queryKeys.status }),
      queryClient.invalidateQueries({ queryKey: queryKeys.allSlots }),
    ]);
}
