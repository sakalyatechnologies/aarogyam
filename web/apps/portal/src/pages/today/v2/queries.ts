import { useCallback } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type ApiClient, type NewSterilisationCycle, type SterilisationCycleList, type DashboardLayout, type DashboardLayoutView, type TaskOccurrenceId } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { REFERENCE, SCHEDULE } from "../../../lib/cache-policy.js";
import { QUEUE_POLL_MS } from "../../../queries.js";
import { adoptTemplates, tasksByDefault } from "./layout-model.js";

/** A clinic day's board data. `date` is `YYYY-MM-DD`; left out it is the current day, and refreshes by itself. */
export function useDayToday(date: string | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    // Under ["today", org], so booking or checking in refreshes every day shown.
    queryKey: ["today", access.org_id, "day", date ?? "now"],
    queryFn: ({ signal }) => unwrap(api.getToday(date === undefined ? { signal } : { signal, date })),
    ...SCHEDULE,
    // As often as the queue board, so the doctor sees a check-in at the desk without reloading.
    refetchInterval: date === undefined ? QUEUE_POLL_MS : false,
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

export function useWeeklyCollections(weeks: number, enabled: boolean, compare?: "prev") {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["collections-weeks", access.org_id, weeks, compare ?? null],
    queryFn: ({ signal }) => unwrap(api.getCollections(compare === undefined ? { weeks } : { weeks, compare }, { signal })),
    enabled,
    ...SCHEDULE,
  });
}

const layoutKey = (orgId: string, scope: "me" | "clinic") => ["dashboard-layout", orgId, scope] as const;

/** The signed-in member's layout: their own, else the clinic's default, else MedSync; with the catalogue. */
export function useMyLayout() {
  const { api, access, session } = useClinic();
  const tasks = tasksByDefault(session.membership.role_key);
  const select = useCallback((view: DashboardLayoutView) => adoptTemplates(view, tasks), [tasks]);
  return useQuery({
    queryKey: layoutKey(access.org_id, "me"),
    queryFn: ({ signal }) => unwrap(api.getMyDashboardLayout({ signal })),
    select,
    ...REFERENCE,
  });
}

/** The clinic's default layout (or MedSync when none is saved), with the catalogue: what setup edits. */
export function useClinicLayout() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: layoutKey(access.org_id, "clinic"),
    queryFn: ({ signal }) => unwrap(api.getDashboardLayout({ signal })),
    select: adoptTemplates,
    ...REFERENCE,
  });
}

/** Saves the member's own layout, or (`clinic`) the clinic default; the board follows at once. */
export function useSaveLayout(scope: "me" | "clinic") {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (layout: DashboardLayout) =>
      unwrap(scope === "me" ? api.saveMyDashboardLayout(layout) : api.saveDashboardLayout(layout)),
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

/** What finishing a task sends: an optional note and the materials used. */
export type CompleteTaskInput = Parameters<ApiClient["completeTask"]>[1];

/** How often "My tasks" is asked for again, the same as the bell's number. */
export const TASKS_POLL_MS = 60_000;

/** The caller's tasks for today (their own and their role's), plus any still open from earlier. */
export function useMyTasks(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["my-tasks", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listMyTasks(undefined, { signal })),
    enabled,
    ...SCHEDULE,
    refetchInterval: TASKS_POLL_MS,
  });
}

/** Finishes a task; the list, the bell's number, the notifications and (when materials were used) the stock follow at once. */
export function useCompleteTask() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: TaskOccurrenceId; input: CompleteTaskInput }) => unwrap(api.completeTask(id, input)),
    onSettled: () => {
      for (const key of ["my-tasks", "badges", "notifications", "stock"]) {
        void queryClient.invalidateQueries({ queryKey: [key, access.org_id] });
      }
    },
  });
}

/** Today's sterilisation cycles; the count on "My tasks" is how many there are. */
export function useSterilisationCycles(enabled = true) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["sterilisation-cycles", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listSterilisationCycles(undefined, { signal })),
    enabled,
    ...SCHEDULE,
  });
}

/** Logs a cycle that ran now; the count goes up at once and settles when the server answers. */
export function useRecordSterilisationCycle() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  const key = ["sterilisation-cycles", access.org_id];
  return useMutation({
    mutationFn: (input: NewSterilisationCycle) => unwrap(api.recordSterilisationCycle(input)),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<SterilisationCycleList>(key);
      if (before !== undefined) {
        const guess = { id: "pending", run_at: new Date().toISOString(), ...(input.load_note == null ? {} : { load_note: input.load_note }) };
        queryClient.setQueryData<SterilisationCycleList>(key, { ...before, items: [guess, ...before.items] });
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before !== undefined) queryClient.setQueryData(key, context.before);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["today", access.org_id] });
    },
  });
}
