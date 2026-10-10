import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type DashboardLayout, type DashboardLayoutView } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { REFERENCE, SCHEDULE } from "../../../lib/cache-policy.js";

/** A clinic day's board data. `date` is `YYYY-MM-DD`; left out it is the current day, and refreshes by itself. */
export function useDayToday(date: string | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    // Under ["today", org], so booking or checking in refreshes every day shown.
    queryKey: ["today", access.org_id, "day", date ?? "now"],
    queryFn: ({ signal }) => unwrap(api.getToday(date === undefined ? { signal } : { signal, date })),
    ...SCHEDULE,
    refetchInterval: date === undefined ? 60_000 : false,
    placeholderData: keepPreviousData,
  });
}

/** Appointments per day for the calendar's busy days. `month` is `YYYY-MM`. */
export function useMonthSummary(month: string, enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["month-summary", access.org_id, month],
    queryFn: ({ signal }) => unwrap(api.getMonthSummary(month, { signal })),
    enabled,
    ...SCHEDULE,
  });
}

export function useOpenLabs(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["open-labs", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listOpenLabOrders({ signal })),
    enabled,
    ...SCHEDULE,
  });
}

export function useWeeklyCollections(weeks: number, enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["collections-weeks", access.org_id, weeks],
    queryFn: ({ signal }) => unwrap(api.getCollections({ weeks }, { signal })),
    enabled,
    ...SCHEDULE,
  });
}

const layoutKey = (orgId: string, scope: "me" | "clinic") => ["dashboard-layout", orgId, scope] as const;

/** The signed-in member's layout: their own, else the clinic's default, else MedSync; with the catalogue. */
export function useMyLayout() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: layoutKey(access.org_id, "me"),
    queryFn: ({ signal }) => unwrap(api.getMyDashboardLayout({ signal })),
    ...REFERENCE,
  });
}

/** The clinic's default layout (or MedSync when none is saved), with the catalogue: what setup edits. */
export function useClinicLayout() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: layoutKey(access.org_id, "clinic"),
    queryFn: ({ signal }) => unwrap(api.getDashboardLayout({ signal })),
    ...REFERENCE,
  });
}

/** Saves the member's own layout, or (`clinic`) the clinic default; the board follows at once. */
export function useSaveLayout(scope: "me" | "clinic") {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: DashboardLayout) => unwrap(scope === "me" ? api.saveMyDashboardLayout(layout) : api.saveDashboardLayout(layout)),
    onSuccess: (view) => {
      if (scope === "me") queryClient.setQueryData<DashboardLayoutView>(layoutKey(access.org_id, "me"), view);
      else void queryClient.invalidateQueries({ queryKey: ["dashboard-layout", access.org_id] });
    },
  });
}

/** Removes the member's own layout; the clinic's default or MedSync applies again. */
export function useResetLayout() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.resetMyDashboardLayout()),
    onSuccess: (view) => {
      queryClient.setQueryData<DashboardLayoutView>(layoutKey(access.org_id, "me"), view);
    },
  });
}
