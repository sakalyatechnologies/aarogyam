import { Play, Stethoscope, UserCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf, type Appointment, type AppointmentStatus, type PatientBrief, type PatientId } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { useOpenPatient } from "../layout/peek.js";
import { useSetAppointmentStatus, useToday, useVisits } from "../queries.js";
import { useCheckIn } from "./check-in.js";
import { StartBlocked, useStartAppointmentVisit } from "./start-appointment-visit.js";

interface NextAction {
  label: string;
  /** What the step does: check in, start the visit, or go on to the visit already in the chair. */
  step: "check-in" | "start" | "continue";
  icon: ReactNode;
}

/**
 * The one step an appointment takes next at the desk or in the chair, or undefined once it is over. Finishing is not here:
 * it belongs to the visit (ending the visit completes the appointment), so there is never a second "complete" button.
 */
export function nextAction(status: AppointmentStatus): NextAction | undefined {
  switch (status) {
    case "booked":
    case "confirmed":
      return { label: "Check in", step: "check-in", icon: <UserCheck aria-hidden="true" /> };
    case "arrived":
      return { label: "Start visit", step: "start", icon: <Play aria-hidden="true" /> };
    case "in_chair":
      return { label: "Continue visit", step: "continue", icon: <Stethoscope aria-hidden="true" /> };
    default:
      return undefined;
  }
}

/** Whether the appointment can still be moved along (not requested, cancelled, no-show or completed). */
export function isOpenAppointment(status: AppointmentStatus): boolean {
  return nextAction(status) !== undefined;
}

/** Today's appointment for a patient that is still open (booked up to in the chair), if any. */
export function useOpenAppointment(patientId: PatientId) {
  const { can } = useClinic();
  const today = useToday(can("appointments.read"));
  return today.data?.appointments.find((a) => a.patient.id === patientId && isOpenAppointment(a.status));
}

/**
 * The button for an appointment's next step. Needs `appointments.write`; nothing shows without it. "Start" opens the visit
 * (linked to the appointment) and goes to the patient's page, where it shows as in progress; "Continue" goes there too.
 */
export function AppointmentActionButton({
  appointment,
  className = "mk-btn mk-btn-primary",
  label,
}: {
  appointment: Pick<Appointment, "id" | "status"> & { patient: Pick<PatientBrief, "id" | "number" | "full_name" | "sex" | "age_years" | "registration_incomplete"> };
  className?: string;
  /** Words for the button in place of the step's own (for a place that has its own way of saying it). */
  label?: (step: string) => string;
}) {
  const { can } = useClinic();
  const toast = useToast();
  const navigate = useNavigate();
  const openPatient = useOpenPatient();
  const setStatus = useSetAppointmentStatus();
  const startVisit = useStartAppointmentVisit();
  const { checkIn, busy, dialog } = useCheckIn();
  const next = nextAction(appointment.status);
  const canClinical = can("clinical.read") || can("clinical.write");
  // A patient in the chair whose visit is already finished is waiting on payment, not on the doctor.
  const visits = useVisits(next?.step === "continue" && canClinical ? appointment.patient.id : undefined);
  const items = visits.data?.items ?? [];
  const finished = items.some((v) => v.appointment_id === appointment.id && v.status === "closed") && !items.some((v) => v.status === "open");
  if (next === undefined || !can("appointments.write")) {
    return null;
  }
  const failed = (thrown: unknown) => {
    toast.show({
      title: thrown instanceof StartBlocked ? thrown.message : (apiErrorOf(thrown)?.message ?? `Couldn't update the appointment. Please try again.`),
      tone: "danger",
    });
  };
  const open = () => {
    openPatient({ id: appointment.patient.id, name: appointment.patient.full_name, number: appointment.patient.number });
  };
  const hasClinical = can("clinical.write");
  if (next.step === "continue" && finished) {
    return can("billing.write") || can("payments.collect") ? (
      <button
        type="button"
        className={className}
        onClick={() => {
          void navigate("/queue");
        }}
      >
        <Wallet aria-hidden="true" /> {label === undefined ? "Collect payment" : label("Collect payment")}
      </button>
    ) : null;
  }
  // Only the doctor can continue a visit; the desk is told where the patient is.
  if (next.step === "continue" && !hasClinical) {
    return <span className="mk-hint">With the doctor</span>;
  }
  // The front desk cannot open a visit (clinical.write), so for them the step only seats the patient.
  const seatOnly = next.step === "start" && !hasClinical;
  const advance = () => {
    if (next.step === "check-in") {
      checkIn(appointment, { done: "Checked in" });
    } else if (next.step === "continue") {
      open();
    } else if (seatOnly) {
      setStatus.mutate(
        { id: appointment.id, change: { status: "in_chair" } },
        {
          onSuccess: () => {
            toast.show({ title: "Patient is in the chair", tone: "success" });
          },
          onError: failed,
        },
      );
    } else {
      void startVisit.mutateAsync(appointment).then(
        () => {
          toast.show({ title: "Visit started", tone: "success" });
          open();
        },
        (thrown: unknown) => {
          failed(thrown);
          // An older open visit blocks today's: the patient's page is where it is finished.
          if (thrown instanceof StartBlocked) open();
        },
      );
    }
  };
  const words = seatOnly ? "Seat in chair" : next.label;
  const pending = setStatus.isPending || startVisit.isPending || busy;
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={advance}>
        {next.icon} {startVisit.isPending ? "Opening…" : label === undefined ? words : label(words)}
      </button>
      {dialog}
    </>
  );
}
