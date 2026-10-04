import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import { unwrap, type ApiClient, type MetricsRange, type NewClinic } from "@aarogyam/api-client";

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

/** Service health for a range, refreshed every minute without flashing. */
export function useMetrics(range: MetricsRange) {
  const api = useApi();
  return useQuery({
    queryKey: ["metrics", range],
    queryFn: ({ signal }) => unwrap(api.getMetrics(range, { signal })),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useClinics() {
  const api = useApi();
  return useQuery({ queryKey: ["clinics"], queryFn: ({ signal }) => unwrap(api.listClinics({ signal })) });
}

/** Creates a clinic and refreshes the list. Failures reject with an ApiFailure for field mapping. */
export function useCreateClinic() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewClinic) => unwrap(api.createClinic(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clinics"] }),
  });
}
