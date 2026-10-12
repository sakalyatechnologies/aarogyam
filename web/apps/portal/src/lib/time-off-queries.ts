import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type DateRange, type NewTimeOff, type StaffOpsSettingsChanges, type TimeOff, type TimeOffDecision, type TimeOffId } from "@aarogyam/api-client";

import { useClinic } from "../clinic.js";
import { REFERENCE, SCHEDULE } from "./cache-policy.js";
import { splitRange } from "./date-range.js";

/** `GET /time-off` takes at most 42 days at once. */
const MAX_SPAN_DAYS = 41;

/** Time off in a range, fetched in pieces the API accepts and joined (a long request can sit in two pieces). */
export function useTimeOff(range: DateRange, enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["time-off", access.org_id, range.from, range.to] as const,
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(splitRange(range, MAX_SPAN_DAYS).map((piece) => unwrap(api.listTimeOff(piece, { signal }))));
      const seen = new Set<string>();
      const items: TimeOff[] = [];
      for (const item of pages.flatMap((page) => page.items)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
      return { items };
    },
    enabled,
    ...SCHEDULE,
  });
}

/** What a change to time off touches: the lists, the leave blocks it makes and the schedule. */
function useRefreshTimeOff() {
  const queryClient = useQueryClient();
  const { access } = useClinic();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["time-off", access.org_id] }),
      queryClient.invalidateQueries({ queryKey: ["leave", access.org_id] }),
      queryClient.invalidateQueries({ queryKey: ["appointments", access.org_id] }),
    ]);
}

export function useRequestTimeOff() {
  const { api } = useClinic();
  const refresh = useRefreshTimeOff();
  return useMutation({ mutationFn: (input: NewTimeOff) => unwrap(api.requestTimeOff(input)), onSuccess: refresh });
}

export function useDecideTimeOff() {
  const { api } = useClinic();
  const refresh = useRefreshTimeOff();
  return useMutation({
    mutationFn: ({ id, approve, decision }: { id: TimeOffId; approve: boolean; decision?: TimeOffDecision }) =>
      unwrap(approve ? api.approveTimeOff(id, decision) : api.declineTimeOff(id, decision)),
    onSuccess: refresh,
  });
}

export function useCancelTimeOff() {
  const { api } = useClinic();
  const refresh = useRefreshTimeOff();
  return useMutation({ mutationFn: (id: TimeOffId) => unwrap(api.cancelTimeOff(id)), onSuccess: refresh });
}

/** Looks up the unfinished appointments a period of time off covers, each with free-doctor suggestions. */
export function useAffectedLookup() {
  const { api } = useClinic();
  return (id: TimeOffId) => unwrap(api.listAffectedAppointments(id));
}

export function useStaffOps(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["staff-ops", access.org_id] as const,
    queryFn: ({ signal }) => unwrap(api.getStaffOpsSettings({ signal })),
    enabled,
    ...REFERENCE,
  });
}

export function useUpdateStaffOps() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: StaffOpsSettingsChanges) => unwrap(api.updateStaffOpsSettings(changes)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff-ops", access.org_id] }),
  });
}
