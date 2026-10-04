import { X } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Patient, type PractitionerPage, type RoomPage } from "@aarogyam/api-client";
import { Avatar, Button, DateInput, Dialog, Field, Select, TextArea, TextInput, useToast } from "@sakalya/ui";

import { PatientPicker } from "../../components/patient-picker.js";
import { ageSex } from "../../lib/patients.js";
import { localInstant } from "../../lib/time.js";
import { useBookAppointment } from "../../queries.js";

const DURATIONS = [15, 20, 30, 45, 60, 90] as const;
const KINDS = [
  { value: "new", label: "New patient" },
  { value: "follow_up", label: "Follow-up" },
  { value: "procedure", label: "Procedure" },
  { value: "emergency", label: "Emergency" },
] as const;

export interface BookingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeZone: string;
  rooms: RoomPage["items"];
  practitioners: PractitionerPage["items"];
  defaultDate: string;
}

/** The dialog that books a new appointment: find the patient, pick a doctor, chair and time. */
export function BookingDialog({ open, onOpenChange, timeZone, rooms, practitioners, defaultDate }: BookingDialogProps) {
  const [patient, setPatient] = useState<Patient | undefined>(undefined);
  const [practitionerId, setPractitionerId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState<number>(30);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("follow_up");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const book = useBookAppointment();
  const toast = useToast();

  const reset = () => {
    setPatient(undefined);
    setPractitionerId("");
    setRoomId("");
    setDate(defaultDate);
    setStartTime("09:00");
    setDuration(30);
    setKind("follow_up");
    setReason("");
    setNotes("");
    setError(undefined);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const canSubmit = patient !== undefined && practitionerId !== "" && timePattern.test(startTime);

  const submit = () => {
    if (patient === undefined) {
      return;
    }
    setError(undefined);
    const startsAt = localInstant(date, startTime, timeZone);
    const endsAt = new Date(Date.parse(startsAt) + duration * 60_000).toISOString();
    book.mutate(
      {
        patient_id: patient.id,
        practitioner_id: practitionerId,
        ...(roomId === "" ? {} : { room_id: roomId }),
        starts_at: startsAt,
        ends_at: endsAt,
        kind,
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
      },
      {
        onSuccess: (saved) => {
          if (saved.warnings.length > 0) {
            toast.show({ title: saved.warnings.map((w) => w.message).join(" "), tone: "warning" });
          } else {
            toast.show({ title: "Appointment booked", tone: "success" });
          }
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't book that appointment. Please try again.");
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="New appointment"
      description="Find the patient, then choose a doctor, chair and time."
      dismissOnOutsidePress={false}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || book.isPending}>
            {book.isPending ? "Booking…" : "Book appointment"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {patient === undefined ? (
          <PatientPicker onChoose={setPatient} />
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3">
            <span className="flex items-center gap-3">
              <Avatar name={patient.full_name} size="sm" />
              <span>
                <span className="block text-sm font-bold text-text">{patient.full_name}</span>
                <span className="block text-xs text-muted">
                  {patient.number} · {ageSex(patient.age_years, patient.sex)}
                </span>
              </span>
            </span>
            <Button
              variant="ghost"
              icon={<X aria-hidden="true" className="size-4" />}
              onClick={() => {
                setPatient(undefined);
              }}
            >
              Change
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Doctor" required>
            <Select
              options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))}
              value={practitionerId}
              onValueChange={setPractitionerId}
              placeholder="Choose a doctor"
            />
          </Field>
          <Field label="Chair" hint="Optional">
            <Select
              options={rooms.map((r) => ({ value: r.id, label: r.name }))}
              value={roomId}
              onValueChange={setRoomId}
              placeholder="No chair assigned"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" required>
            <DateInput value={date} onValueChange={setDate} />
          </Field>
          <Field label="Start time" hint="24-hour, HH:MM" required>
            <TextInput
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value);
              }}
            />
          </Field>
          <Field label="Duration" required>
            <Select
              options={DURATIONS.map((d) => ({ value: String(d), label: `${String(d)} min` }))}
              value={String(duration)}
              onValueChange={(value) => {
                setDuration(DURATIONS.find((d) => String(d) === value) ?? 30);
              }}
            />
          </Field>
        </div>

        <Field label="Kind">
          <Select options={KINDS} value={kind} onValueChange={setKind} />
        </Field>
        <Field label="Reason" hint="Shown on the schedule">
          <TextInput
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <Field label="Front-desk note">
          <TextArea
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
