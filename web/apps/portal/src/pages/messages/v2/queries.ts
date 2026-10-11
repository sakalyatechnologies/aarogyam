import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { apiErrorOf, unwrap, type AudienceFilter } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { REFERENCE, SCHEDULE } from "../../../lib/cache-policy.js";

/** How often the open Staff chat tab asks for news: new messages in the open chat, unread counts in the list. */
export const POLL_MS = 15_000;

export function useTemplates(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["messages", access.org_id, "templates"],
    queryFn: ({ signal }) => unwrap(api.listMessageTemplates({ signal })),
    enabled,
    ...REFERENCE,
  });
}

export function useCampaigns(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["messages", access.org_id, "campaigns"],
    queryFn: ({ signal }) => unwrap(api.listCampaigns({ signal })),
    enabled,
    ...SCHEDULE,
    refetchInterval: 10_000,
  });
}

/** The patients a picker shows: the first 50, or those matching a search. Needs `patients.read`. */
export function usePatientPicker(search: string, enabled: boolean) {
  const { api, access } = useClinic();
  const q = search.trim();
  return useQuery({
    queryKey: ["messages", access.org_id, "patients", q],
    queryFn: ({ signal }) => unwrap(q === "" ? api.listPatients({ signal }) : api.searchPatients({ q, limit: 50 }, { signal })),
    enabled,
    ...REFERENCE,
  });
}

export function usePatientMessages(patientId: string | null) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["messages", access.org_id, "patient", patientId],
    queryFn: ({ signal }) => unwrap(api.listPatientMessages(patientId ?? "", { signal })),
    enabled: patientId !== null,
    ...SCHEDULE,
    refetchInterval: 8_000,
  });
}

/** The live count for an audience filter, with the token that lets a campaign be scheduled. Every change asks again. */
export function useAudiencePreview(filter: AudienceFilter | null) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["messages", access.org_id, "preview", JSON.stringify(filter)],
    queryFn: ({ signal }) => unwrap(api.previewAudience(filter ?? { kind: "all_active" }, { signal })),
    enabled: filter !== null,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    // A count lasts 15 minutes at the server: ask again well before it lapses so the token in hand is always fresh.
    refetchInterval: 10 * 60_000,
  });
}

export function useConversations(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["messages", access.org_id, "conversations"],
    queryFn: ({ signal }) => unwrap(api.listConversations(undefined, { signal })),
    enabled,
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchInterval: POLL_MS,
  });
}

/** Colleagues to chat with: the staff list for those who may manage staff, else the doctors, who are linked to a member. */
export function useColleagues(enabled: boolean) {
  const { api, access, can, session } = useClinic();
  const staff = can("staff.manage");
  return useQuery({
    queryKey: ["messages", access.org_id, "colleagues", staff],
    queryFn: async ({ signal }) => {
      const people = staff
        ? (await unwrap(api.listStaff({ signal }))).members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.display_name }))
        : (await unwrap(api.listPractitioners({ signal }))).items.flatMap((p) => (p.active && p.membership_id != null ? [{ id: p.membership_id, name: p.display_name }] : []));
      return people.filter((p) => p.id !== session.membership.id);
    },
    enabled,
    ...REFERENCE,
  });
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

/** What went wrong, in the API's words when it sent some. */
export function why(thrown: unknown): string {
  return apiErrorOf(thrown)?.message ?? "Something went wrong. Please try again.";
}
