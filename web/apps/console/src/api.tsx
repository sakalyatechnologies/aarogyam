import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";

import {
  unwrap,
  type ApplicationId,
  type ApplicationStatus,
  type ApproveApplication,
  type ClinicId,
  type MetricsRange,
  type NewClinic,
  type NewClinicInvitation,
  type RejectApplication,
  type SlugQuery,
  type ApiClient,
} from "@aarogyam/api-client";

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
  return useQuery({
    queryKey: ["clinics"],
    queryFn: ({ signal }) => unwrap(api.listClinics({ signal })),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((c) => c.address_status === "pending") ? 10_000 : false;
    },
  });
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

export function useClinicDetail(id: ClinicId | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["clinic", id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no clinic")) : unwrap(api.getClinicDetail(id, { signal }))),
    enabled: id !== undefined,
    refetchInterval: (query) => (query.state.data?.address_status === "pending" ? 10_000 : false),
  });
}

/** Invites a doctor or other staff member to a clinic and refreshes its detail. */
export function useInviteToClinic(id: ClinicId | undefined) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewClinicInvitation) => (id === undefined ? Promise.reject(new Error("no clinic")) : unwrap(api.inviteToClinic(id, input))),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["clinic", id] }),
  });
}

export function useApplications(status?: ApplicationStatus) {
  const api = useApi();
  return useQuery({
    queryKey: ["applications", status ?? "all"],
    queryFn: ({ signal }) => unwrap(api.listApplications(status, { signal })),
  });
}

/** Approves an application, creating the clinic and the owner's invitation. Refreshes applications and clinics. */
/** Checks a clinic address as it is typed; idle until there is something to check. */
export function useSlugCheck(query: SlugQuery | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ["slug-check", query],
    queryFn: ({ signal }) => unwrap(api.checkSlug(query ?? { name: "" }, { signal })),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useApproveApplication() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: ApplicationId; input: ApproveApplication }) => unwrap(api.approveApplication(id, input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["applications"] });
      void queryClient.invalidateQueries({ queryKey: ["clinics"] });
    },
  });
}

export function useRejectApplication() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: ApplicationId; input: RejectApplication }) => unwrap(api.rejectApplication(id, input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["applications"] }),
  });
}

/** The 30 most recent quality runs, refreshed every minute: a run completes every so often, not
 * on every keystroke. */
export function useQuality() {
  const api = useApi();
  return useQuery({
    queryKey: ["quality"],
    queryFn: ({ signal }) => unwrap(api.getQuality(30, { signal })),
    refetchInterval: 60_000,
  });
}
