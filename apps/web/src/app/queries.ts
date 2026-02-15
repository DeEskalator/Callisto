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
  openInquiries: ['inquiries', 'open'] as const,
  inquiriesOfDay: (date: string) => ['inquiries', 'day', date] as const,
  allInquiries: ['inquiries'] as const,
  callsOfDay: (date: string) => ['calls', 'day', date] as const,
  call: (id: string) => ['calls', 'one', id] as const,
  allCalls: ['calls'] as const,
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

// The daily view shows what is happening on the phone right now. It asks again every few
// seconds; that is frequent enough for a practice and needs no connection of its own.
const LIVE_INTERVAL_MS = 4000;

/** Everything the practice still has to act on, oldest first. */
export function useOpenInquiries() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.openInquiries,
    queryFn: () => data(api.calls.inquiries.$get({ query: { open: 'true' } })),
    refetchInterval: LIVE_INTERVAL_MS,
  });
}

/** The inquiries created on a day. */
export function useInquiriesOfDay(date: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.inquiriesOfDay(date),
    queryFn: () => data(api.calls.inquiries.$get({ query: { date } })),
    refetchInterval: LIVE_INTERVAL_MS,
  });
}

/** The calls that started on a day. */
export function useCallsOfDay(date: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.callsOfDay(date),
    queryFn: () => data(api.calls.calls.$get({ query: { date } })),
    refetchInterval: LIVE_INTERVAL_MS,
  });
}

/** One call with its transcript and inquiries; refreshed quickly while the call is running. */
export function useCall(callId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.call(callId ?? ''),
    queryFn: () => data(api.calls.calls[':id'].$get({ param: { id: callId ?? '' } })),
    enabled: Boolean(callId),
    refetchInterval: (query) => (query.state.data?.call.status === 'in_progress' ? 1500 : false),
  });
}
