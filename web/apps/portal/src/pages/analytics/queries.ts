import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { unwrap, type AnalyticsQuery } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/**
 * The one Analytics request. Fresh for five minutes; switching the range keeps the last report on
 * screen until the next arrives, so the charts never blank out.
 */
export function useAnalytics(query: AnalyticsQuery) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["analytics", access.org_id, query.from, query.to, query.bucket],
    queryFn: ({ signal }) => unwrap(api.getAnalytics(query, { signal })),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}
