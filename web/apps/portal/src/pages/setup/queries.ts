import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiFailure, unwrap, type Practitioner, type PractitionerFields, type SetupUpdate, type WorkingHours } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/** The clinic's setup. Only asked of people who can change settings. */
export function useClinicSetup() {
  const { api, access, can } = useClinic();
  return useQuery({
    queryKey: ["setup", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getSetup({ signal })),
    enabled: can("settings.manage"),
  });
}

export function useUpdateClinicSetup() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: SetupUpdate) => unwrap(api.updateSetup(update)),
    onSuccess: (setup) => {
      queryClient.setQueryData(["setup", access.org_id], setup);
    },
  });
}

/** The signed-in member's own setup. */
export function useMySetup() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["my-setup", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getMySetup({ signal })),
  });
}

export function useUpdateMySetup() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: SetupUpdate) => unwrap(api.updateMySetup(update)),
    onSuccess: (setup) => {
      queryClient.setQueryData(["my-setup", access.org_id], setup);
    },
  });
}

/** The signed-in member's own doctor record; `null` when they are not a doctor here. */
export function useMyPractitioner() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["my-practitioner", access.org_id],
    queryFn: async ({ signal }): Promise<Practitioner | null> => {
      const result = await api.getMyPractitioner({ signal });
      if (result.ok) {
        return result.value;
      }
      if (result.error.status === 404) {
        return null;
      }
      throw new ApiFailure(result.error);
    },
  });
}

export function useChangeMyPractitioner() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: PractitionerFields) => unwrap(api.changeMyPractitioner(changes)),
    onSuccess: (doctor) => {
      queryClient.setQueryData(["my-practitioner", access.org_id], doctor);
      void queryClient.invalidateQueries({ queryKey: ["practitioners", access.org_id] });
    },
  });
}

export function useMyWorkingHours(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["my-working-hours", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getMyWorkingHours({ signal })),
    enabled,
  });
}

export function useSetMyWorkingHours() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (hours: WorkingHours) => unwrap(api.setMyWorkingHours(hours)),
    onSuccess: (hours) => {
      queryClient.setQueryData(["my-working-hours", access.org_id], hours);
      void queryClient.invalidateQueries({ queryKey: ["working-hours", access.org_id] });
    },
  });
}
