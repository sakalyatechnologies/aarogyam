import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { apiErrorOf } from "@aarogyam/api-client";

export interface QueryClientOptions {
  /** Called when any request comes back 401, to send the user back to sign-in. */
  onUnauthenticated?: () => void;
}

/**
 * The shared query policy: client errors (4xx) and cancellations are final, other failures are
 * retried twice. Cached data lives in memory only, never in storage.
 */
export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const onError = (error: unknown) => {
    if (apiErrorOf(error)?.status === 401) {
      options.onUnauthenticated?.();
    }
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          const apiError = apiErrorOf(error);
          if (apiError !== undefined && ((apiError.status >= 400 && apiError.status < 500) || apiError.code === "aborted")) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
