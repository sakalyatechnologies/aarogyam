/** Queries for the missed visits, the bills still to collect and the follow-ups the front desk chases. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorOf, unwrap, type PatientId } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";

/** `GET /appointments/missed`: the no-shows of a clinic day (today when left out). */
export function useMissed(date: string | undefined, enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["today", access.org_id, "missed", date ?? "now"],
    queryFn: ({ signal }) => unwrap(api.listMissedAppointments(date, { signal })),
    enabled,
  });
}

/** `GET /queue/to-collect`: earlier days' tokens whose bill still has a balance. */
export function useToCollect(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["queue", access.org_id, "to-collect"],
    queryFn: ({ signal }) => unwrap(api.listQueueToCollect({ signal })),
    enabled,
  });
}

/** `GET /recalls`: the open follow-ups, soonest first. */
export function useRecallsDue(enabled: boolean) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["recalls", access.org_id],
    queryFn: ({ signal }) => unwrap(api.listRecallsDue({ signal })),
    enabled,
  });
}

/** `POST /recalls/{id}/done`. */
export function useMarkRecallDone() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.markRecallDone(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recalls", access.org_id] }),
  });
}

/** Sends the "we missed you" email to one patient; the server enforces consent and its refusal is shown as it is. */
export function useSendMissedReminder() {
  const { api } = useClinic();
  const toast = useToast();
  return useMutation({
    mutationFn: (patientId: PatientId) => unwrap(api.sendMessages({ patient_ids: [patientId], channel: "email", template_key: "reminder.missed_visit" })),
    onSuccess: (sent) => {
      toast.show(
        sent.queued > 0
          ? { title: "Reminder on its way", tone: "success" }
          : { title: sent.already_queued > 0 ? "A reminder was already sent" : "Couldn't send: no email on file", tone: "warning" },
      );
    },
    onError: (thrown) => {
      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't send that reminder.", tone: "danger" });
    },
  });
}
