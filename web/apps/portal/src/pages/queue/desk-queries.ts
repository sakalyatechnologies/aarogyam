/** Queries for the missed visits, the bills still to collect and the follow-ups the front desk chases. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorOf, unwrap, type MessagesQueued, type PatientId } from "@aarogyam/api-client";
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

/** What the server did with a one-patient reminder; it says up front who it could not queue. */
function reminderToast(sent: MessagesQueued): { title: string; tone: "success" | "warning" } {
  if (sent.queued > 0) return { title: "Reminder on its way", tone: "success" };
  if ((sent.no_address ?? 0) > 0) return { title: "Not sent: no email on file", tone: "warning" };
  if ((sent.no_consent ?? 0) > 0) return { title: "Not sent: this patient hasn't agreed to reminders", tone: "warning" };
  return { title: "A reminder was already sent", tone: "warning" };
}

/** Sends the "we missed you" email to one patient; the server reports a patient it can't reach, and the toast says so. */
export function useSendMissedReminder() {
  const { api } = useClinic();
  const toast = useToast();
  return useMutation({
    mutationFn: (patientId: PatientId) => unwrap(api.sendMessages({ patient_ids: [patientId], channel: "email", template_key: "reminder.missed_visit" })),
    onSuccess: (sent) => {
      toast.show(reminderToast(sent));
    },
    onError: (thrown) => {
      toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't send that reminder.", tone: "danger" });
    },
  });
}
