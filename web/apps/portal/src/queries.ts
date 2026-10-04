import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  unwrap,
  type ClinicSettingsChanges,
  type MemberChanges,
  type MembershipId,
  type NewInvitation,
  type NewPatient,
  type PatientChanges,
  type PatientId,
  type SessionId,
} from "@aarogyam/api-client";

import { useClinic } from "./clinic.js";

/**
 * Recent patients while the box is empty, otherwise a search. The term travels in a POST body,
 * never a URL. Results live only in memory, keyed by clinic host so clinics never mix.
 */
export function usePatients(q: string) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patients", access.org_id, q],
    queryFn: ({ signal }) => unwrap(q === "" ? api.listPatients({ signal }) : api.searchPatients({ q, limit: 50 }, { signal })),
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: PatientId | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["patient", access.org_id, id],
    queryFn: ({ signal }) => (id === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getPatient(id, { signal }))),
    enabled: id !== undefined,
  });
}

export function useCreatePatient() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewPatient) => unwrap(api.createPatient(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] }),
  });
}

export function useToday() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["today", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getToday({ signal })),
    refetchInterval: 60_000,
  });
}

export function useUpdatePatient(id: PatientId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: PatientChanges) => unwrap(api.updatePatient(id, changes)),
    onSuccess: (patient) => {
      queryClient.setQueryData(["patient", access.org_id, id], patient);
      void queryClient.invalidateQueries({ queryKey: ["patients", access.org_id] });
    },
  });
}

export function useClinicSettings() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["clinic-settings", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getClinicSettings({ signal })),
  });
}

export function useUpdateClinicSettings() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: ClinicSettingsChanges) => unwrap(api.updateClinicSettings(changes)),
    onSuccess: (settings) => {
      queryClient.setQueryData(["clinic-settings", access.org_id], settings);
    },
  });
}

export function useStaff() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["staff", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listStaff({ signal })),
  });
}

export function useRoles() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["roles", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listRoles({ signal })),
    staleTime: Infinity,
  });
}

export function useInviteStaff() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewInvitation) => unwrap(api.inviteStaff(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff", access.org_id] }),
  });
}

export function useChangeStaffMember() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: MembershipId; changes: MemberChanges }) => unwrap(api.changeStaffMember(id, changes)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["staff", access.org_id] }),
  });
}

export function useMySessions() {
  const { api } = useClinic();
  return useQuery({
    queryKey: ["my-sessions"],
    queryFn: ({ signal }) => unwrap(api.listMySessions({ signal })),
  });
}

export function useRevokeSession() {
  const { api } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: SessionId) => unwrap(api.revokeMySession(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-sessions"] }),
  });
}
