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

/** Collections for exactly `from` to `to` (at most 366 days), optionally with the period before for comparison. */
export function useRangeCollections(range: { from: string; to: string }, enabled: boolean, compare?: "prev") {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["collections-range", access.org_id, range.from, range.to, compare ?? null],
    queryFn: ({ signal }) => unwrap(api.getCollections({ from: range.from, to: range.to, ...(compare === undefined ? {} : { compare }) }, { signal })),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
