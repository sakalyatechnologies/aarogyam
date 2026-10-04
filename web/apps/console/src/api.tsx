import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import { unwrap, type ApiClient, type MetricsEnvironment, type MetricsRange } from "@aarogyam/api-client";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext value={client}>{children}</ApiContext>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (client === null) {
    throw new Error("useApi must be used inside an ApiProvider");
  }
  return client;
}

/** Service health for a range and environment, refreshed every minute without flashing. */
export function useMetrics(range: MetricsRange, environment: MetricsEnvironment) {
  const api = useApi();
  return useQuery({
    queryKey: ["metrics", range, environment],
    queryFn: ({ signal }) => unwrap(api.getMetrics({ range, environment }, { signal })),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
