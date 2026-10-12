import { CircleCheck, Play, UserCheck } from "lucide-react";
import type { ReactNode } from "react";

import { apiErrorOf, type Appointment, type AppointmentStatus, type StatusChange } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { useSetAppointmentStatus } from "../queries.js";

interface NextAction {
  label: string;
  change: StatusChange["status"];
  done: string;
  icon: ReactNode;
}

/** The one step an appointment takes next at the desk or in the chair, or undefined once it is over. */
export function nextAction(status: AppointmentStatus): NextAction | undefined {
  switch (status) {
    case "booked":
    case "confirmed":
      return { label: "Check in", change: "arrived", done: "Checked in", icon: <UserCheck aria-hidden="true" /> };
    case "arrived":
      return { label: "Start consultation", change: "in_chair", done: "Consultation started", icon: <Play aria-hidden="true" /> };
    case "in_chair":
      return { label: "Complete visit", change: "completed", done: "Visit completed", icon: <CircleCheck aria-hidden="true" /> };
    default:
      return undefined;
  }
}

/** Whether the appointment can still be moved along (not requested, cancelled, no-show or completed). */
export function isOpenAppointment(status: AppointmentStatus): boolean {
  return nextAction(status) !== undefined;
}

/** The button for an appointment's next step. Needs `appointments.write`; nothing shows without it. */
export function AppointmentActionButton({
  appointment,
  className = "mk-btn mk-btn-primary",
  label,
}: {
  appointment: Pick<Appointment, "id" | "status">;
  className?: string;
  /** Words for the button in place of the step's own (for a place that has its own way of saying it). */
  label?: (step: string) => string;
}) {
  const { can } = useClinic();
  const toast = useToast();
  const setStatus = useSetAppointmentStatus();
  const next = nextAction(appointment.status);
  if (next === undefined || !can("appointments.write")) {
    return null;
  }
  return (
    <button
      type="button"
      className={className}
      disabled={setStatus.isPending}
      onClick={() => {
        setStatus.mutate(
          { id: appointment.id, change: { status: next.change } },
          {
            onSuccess: () => {
              toast.show({ title: next.done, tone: "success" });
            },
            onError: (thrown) => {
              toast.show({ title: apiErrorOf(thrown)?.message ?? `Couldn't update the appointment. Please try again.`, tone: "danger" });
            },
          },
        );
      }}
    >
      {next.icon} {label === undefined ? next.label : label(next.label)}
    </button>
  );
}
