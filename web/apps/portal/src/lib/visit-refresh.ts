import { useQueryClient } from "@tanstack/react-query";

import { useClinic } from "../clinic.js";

/** After calling a patient in or taking a payment: what the bell, the queue and Today show has changed. */
export function useRefreshVisitData(): () => Promise<unknown> {
  const { access } = useClinic();
  const queryClient = useQueryClient();
  return () =>
    Promise.all(["notifications", "badges", "queue", "today"].map((key) => queryClient.invalidateQueries({ queryKey: [key, access.org_id] })));
}
