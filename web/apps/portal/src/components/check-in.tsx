import { useState, type ReactNode } from "react";

import { apiErrorOf, type AppointmentId, type CheckInRequest, type PatientBrief, type Sex } from "@aarogyam/api-client";
import { Button, Dialog, useToast } from "@sakalya/ui";

import { useClinic } from "../clinic.js";
import { EMPTY_INTAKE, IntakeFields, type Intake } from "../pages/queue/intake-fields.js";
import { AgeField, SexField } from "../pages/queue/new-walk-in-fields.js";
import { useCheckInAppointment, useSetAppointmentStatus } from "../queries.js";
import "./quick-picks.css";

/** The booking being checked in; `patient` says whether the desk still has details to collect. */
export interface CheckInTarget {
  id: AppointmentId;
  patient?: Pick<PatientBrief, "full_name" | "sex" | "age_years" | "registration_incomplete"> | undefined;
}

interface Form {
  sex: Sex | null;
  age: string;
  /** The age the patient already had on record; it is sent only when the desk changes it, so an exact birth date isn't replaced by an estimate. */
  recordedAge: string;
  intake: Intake;
}

/** The check-in request from what the desk entered, or what is wrong with it. */
export function checkInRequest(form: Form): CheckInRequest | string {
  if (form.age !== "" && (!/^\d{1,3}$/.test(form.age) || Number(form.age) > 120)) return "Age is a number of years.";
  const consents: CheckInRequest["consents"] = [{ purpose: "care", method: "verbal" }];
  if (form.intake.reminders) consents.push({ purpose: "reminders", method: "verbal" });
  return {
    ...(form.sex === null ? {} : { sex: form.sex }),
    ...(form.age === "" || form.age === form.recordedAge ? {} : { age_years: Number(form.age) }),
    allergies: [...form.intake.allergies],
    no_known_allergies: form.intake.noKnownAllergies,
    consents,
  };
}

const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

function initialForm(patient: CheckInTarget["patient"]): Form {
  const sex = patient === undefined || patient.sex === "unknown" ? null : patient.sex;
  const age = patient?.age_years == null ? "" : String(patient.age_years);
  // Reminders start unticked: consent has to be given, not pre-ticked.
  return { sex, age, recordedAge: age, intake: { ...EMPTY_INTAKE, reminders: false } };
}

interface Pending {
  target: CheckInTarget;
  done: string;
  onDone?: (() => void) | undefined;
}

/**
 * Check in from the desk: one click when the patient's registration is complete, else a small form for what is
 * missing (sex, age, allergies, reminder consent). Render `dialog` once next to the buttons.
 */
export function useCheckIn(): { checkIn: (target: CheckInTarget, options: { done: string; onDone?: () => void }) => void; busy: boolean; dialog: ReactNode } {
  const { can } = useClinic();
  const toast = useToast();
  const setStatus = useSetAppointmentStatus();
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const mayRecord = can("appointments.write") && can("patients.write") && can("intake.write");
  const checkIn = (target: CheckInTarget, { done, onDone }: { done: string; onDone?: () => void }) => {
    if (mayRecord && target.patient?.registration_incomplete === true) {
      setPending({ target, done, onDone });
      return;
    }
    setStatus.mutate(
      { id: target.id, change: { status: "arrived" } },
      {
        onSuccess: () => {
          toast.show({ title: done, tone: "success" });
          onDone?.();
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't check in. Please try again.", tone: "danger" });
        },
      },
    );
  };
  const dialog = pending === undefined ? null : <CheckInDialog key={pending.target.id} pending={pending} onClose={() => { setPending(undefined); }} />;
  return { checkIn, busy: setStatus.isPending, dialog };
}

function CheckInDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { target, done, onDone } = pending;
  const [form, setForm] = useState<Form>(() => initialForm(target.patient));
  const [error, setError] = useState<string | undefined>(undefined);
  const checkIn = useCheckInAppointment();
  const toast = useToast();
  const name = target.patient === undefined ? "patient" : firstName(target.patient.full_name);

  const submit = () => {
    const input = checkInRequest(form);
    if (typeof input === "string") {
      setError(input);
      return;
    }
    setError(undefined);
    checkIn.mutate(
      { id: target.id, input },
      {
        onSuccess: () => {
          toast.show({ title: done, tone: "success" });
          onClose();
          onDone?.();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't check in. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Check in ${name}`}
      description="They booked online, so a few details are still missing. Takes a moment."
      dismissOnOutsidePress={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={checkIn.isPending}>
            {checkIn.isPending ? "Checking in…" : "Check in"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="wi-section">
          <div className="wi-grid">
            <AgeField value={form} onChange={setForm} />
          </div>
          <SexField value={form} onChange={setForm} />
        </div>
        <IntakeFields value={form.intake} onChange={(intake) => { setForm({ ...form, intake }); }} />
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
