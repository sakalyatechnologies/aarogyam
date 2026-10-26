import { useQuery } from "@tanstack/react-query";

import { unwrap } from "@aarogyam/api-client";

import { useClinic } from "../clinic.js";

/** The caller's notifications, newest first; asked for only while `enabled` (the drawer is open, or a Collect is finding its bill). */
export function useNotifications(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["notifications", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listNotifications({ limit: 50 }, { signal })),
    enabled,
    staleTime: 0,
    retry: false,
  });
}
