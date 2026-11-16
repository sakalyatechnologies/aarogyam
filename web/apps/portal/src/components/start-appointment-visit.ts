import { useMutation, useQueryClient } from "@tanstack/react-query";

import { unwrap, type AppointmentId, type AppointmentStatus, type PatientId, type QueueToken, type Visit } from "@aarogyam/api-client";

import { useClinic } from "../clinic.js";
import { useSetAppointmentStatus } from "../queries.js";

/** The appointment whose visit is to start. */
export interface StartTarget {
  id: AppointmentId;
  status: AppointmentStatus;
  patient: { id: PatientId };
}

/** Starting was refused for a reason the person can act on (the message says what to do). The patient's page is where to do it. */
export class StartBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartBlocked";
  }
}

const sameDay = (iso: string, now: Date) => new Date(iso).toDateString() === now.toDateString();
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * Starts the visit for an appointment and returns it, so "Start" means the same everywhere.
 *
 * - A visit already open for THIS appointment is returned, never a second. An open visit with no appointment, started today
 *   (on the phone, say), is returned too. One from another day, or for another appointment, is not reused: the person is told to
 *   finish it first, because reusing it would leave today's appointment unseated and unlinked.
 * - Otherwise the appointment's queue token starts the visit (`startVisitFromQueue`), which seats the patient and links the visit
 *   to the token and the appointment, so finishing the visit closes both. After seating, the token is looked up again.
 * - Only when no token can exist is the visit started against the appointment alone.
 * - A failed lookup stops the start with an error: guessing could open a second visit.
 */
export function useStartAppointmentVisit() {
  const { api, access, can } = useClinic();
  const queryClient = useQueryClient();
  const setStatus = useSetAppointmentStatus();
  return useMutation({
    mutationFn: async (target: StartTarget): Promise<Visit> => {
      const visits = await unwrap(api.listVisits(target.patient.id));
      if (visits.items.some((v) => v.appointment_id === target.id && v.status === "closed")) {
        throw new StartBlocked("This visit is already finished. Payment is the next step.");
      }
      const open = visits.items.find((v) => v.status === "open");
      if (open !== undefined) {
        if (open.appointment_id === target.id || (open.appointment_id == null && sameDay(open.started_at, new Date()))) return open;
        throw new StartBlocked(`This patient has an open visit from ${dayOf(open.started_at)}. Finish it first, then start today's.`);
      }
      const findToken = async (): Promise<QueueToken | undefined> => {
        if (!can("appointments.read")) return undefined;
        const queue = await unwrap(api.listQueue(undefined));
        return queue.items.find((t) => t.appointment_id === target.id && t.status !== "done" && t.status !== "left");
      };
      let token = await findToken();
      if (token === undefined) {
        // No token yet: seat the patient, which issues or moves one, and look again.
        if (target.status !== "in_chair") await setStatus.mutateAsync({ id: target.id, change: { status: "in_chair" } });
        token = await findToken();
      }
      if (token !== undefined) return (await unwrap(api.startVisitFromQueue(token.id))).visit;
      return unwrap(api.startVisit(target.patient.id, { appointment_id: target.id }));
    },
    onSettled: (_visit, _error, target) => {
      for (const key of [["queue"], ["today"], ["appointments"], ["visits", target.patient.id], ["timeline", target.patient.id]]) {
        const [head, ...rest] = key;
        void queryClient.invalidateQueries({ queryKey: [head, access.org_id, ...rest] });
      }
    },
  });
}
