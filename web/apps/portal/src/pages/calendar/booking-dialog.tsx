import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, patientId as patientIdSchema, practitionerId as practitionerIdSchema, type Patient, type PractitionerPage, type RoomPage } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, Switch, TextArea, TextInput, useToast } from "@sakalya/ui";

import { DatePicker } from "../../components/mk/date-picker.js";
import { TimeSlotPicker } from "../../components/mk/time-slots.js";
import { useClinic } from "../../clinic.js";
import { freeSlots, parseHm, shiftsOn } from "../../lib/slots.js";
import { localInstant, todayIn } from "../../lib/time.js";
import { nowMinutes, placementOf } from "../../lib/time-grid.js";
import { useTimeOff } from "../../lib/time-off-queries.js";
import { isAway } from "./away.js";
import { useAppointments, useBookAppointment, useCreatePatient, usePatient, useWorkingHours } from "../../queries.js";
import { patientErrorOf, toNewPatient } from "../patients/patient-form.js";
import { BookingPatient, usePatientPicker } from "./booking-patient.js";
import { PatientOverlapNotice, clashSentence, clashesFromServer, patientOverlaps } from "./patient-overlap.js";

export const DURATIONS = [15, 20, 30, 45, 60, 90] as const;
export const KINDS = [
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
  /** The date the calendar is showing; the form starts on it. */
  defaultDate: string;
  /** The empty slot someone clicked: its start ("10:30") and the doctor or chair column it was in. */
  defaultTime?: string | undefined;
  defaultPractitionerId?: string | undefined;
  defaultRoomId?: string | undefined;
  /** `?patient=<id>`: book for this patient without searching. */
  patientParam?: string | null;
}

/** The dialog that books a new appointment: patient, doctor and chair, then a day and a free time. */
export function BookingDialog({ open, onOpenChange, timeZone, rooms, practitioners, defaultDate,
  defaultTime,
  defaultPractitionerId,
  defaultRoomId,
  patientParam = null,
}: BookingDialogProps) {
  const { can } = useClinic();
  const canRegister = can("patients.write");
  const picker = usePatientPicker(canRegister);
  const create = useCreatePatient();
  const [picked, setPicked] = useState<Patient | undefined>(undefined);
  const [cleared, setCleared] = useState(false);
  const parsed = patientIdSchema.safeParse(patientParam);
  const prefill = usePatient(parsed.success ? parsed.data : undefined);
  const patient = picked ?? (cleared ? undefined : prefill.data);
  const setPatient = (next: Patient | undefined) => {
    setPicked(next);
    setCleared(next === undefined);
  };
  // Until the person picks, follow the slot they clicked on the calendar.
  const [chosenPractitionerId, setPractitionerId] = useState<string | undefined>(undefined);
  const practitionerId = chosenPractitionerId ?? defaultPractitionerId ?? "";
  const [chosenAssign, setAssignChair] = useState<boolean | undefined>(undefined);
  const assignChair = chosenAssign ?? defaultRoomId !== undefined;
  const [pickedRoomId, setRoomId] = useState<string | undefined>(undefined);
  const chosenRoomId = pickedRoomId ?? defaultRoomId ?? "";
  // A chair counts only while the switch is on.
  const roomId = assignChair ? chosenRoomId : "";
  // Until the person picks a day, follow the calendar's.
  const [chosenDate, setChosenDate] = useState<string | undefined>(undefined);
  const date = chosenDate ?? defaultDate;
  const [chosenTime, setStartTime] = useState<string | undefined>(undefined);
  const startTime = chosenTime ?? defaultTime ?? "09:00";
  const [duration, setDuration] = useState<number>(30);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("follow_up");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const book = useBookAppointment();
  const toast = useToast();
  const today = todayIn(timeZone);

  // Free times: the doctor's hours that weekday, minus what the doctor or the chair already has.
  const doctor = practitionerIdSchema.safeParse(practitionerId);
  const hours = useWorkingHours(doctor.success ? doctor.data : undefined);
  const day = useAppointments({ from: date, to: date });
  const slots = (() => {
    if (!doctor.success || !hours.isSuccess || !day.isSuccess) return [];
    const busy = day.data.items
      .filter((a) => a.status !== "cancelled" && (a.practitioner.id === practitionerId || (roomId !== "" && a.room_id === roomId)))
      .map((a) => placementOf(a.starts_at, a.ends_at, timeZone))
      .filter((p) => p.date === date)
      .map((p) => ({ startMin: p.startMin, endMin: p.endMin }));
    const notBefore = date === today ? nowMinutes(new Date(), timeZone).minutes : 0;
    return freeSlots({ shifts: shiftsOn(hours.data.shifts, date), busy, duration, step: duration % 30 === 0 ? 30 : 15, notBefore });
  })();
  // Who is away for the chosen slot, and who is free then: the form guides, the server stays the authority.
  const timeOff = useTimeOff({ from: date, to: date });
  const startMinute = parseHm(startTime);
  const slotStart = Number.isNaN(startMinute) ? undefined : localInstant(date, startTime, timeZone);
  const slotEnd = slotStart === undefined ? undefined : new Date(Date.parse(slotStart) + duration * 60_000).toISOString();
  const awayAt = (id: string) => slotStart !== undefined && slotEnd !== undefined && isAway(timeOff.data?.items ?? [], practitioners.find((p) => p.id === id), slotStart, slotEnd);
  const busyAt = (id: string) =>
    slotStart !== undefined &&
    slotEnd !== undefined &&
    (day.data?.items ?? []).some((a) => a.practitioner.id === id && a.status !== "cancelled" && a.status !== "no_show" && Date.parse(a.starts_at) < Date.parse(slotEnd) && Date.parse(slotStart) < Date.parse(a.ends_at));
  // While the day's list is loading (or still the previous day's), the patient's clashes are unknown, not absent.
  const checkingOverlaps = patient !== undefined && (day.isPending || day.isPlaceholderData);
  const overlaps = patient === undefined || checkingOverlaps ? [] : patientOverlaps(day.data?.items ?? [], patient.id, slotStart, slotEnd);
  const freeDoctors = practitioners.filter((p) => p.active && p.id !== practitionerId && !awayAt(p.id) && !busyAt(p.id));
  const chosenAway = practitionerId !== "" && awayAt(practitionerId);
  const [refused, setRefused] = useState(false);
  const loadingSlots = doctor.success && (hours.isPending || day.isPending);

  const reset = () => {
    picker.reset();
    setPicked(undefined);
    setCleared(false);
    setPractitionerId(undefined);
    setRoomId(undefined);
    setAssignChair(undefined);
    setChosenDate(undefined);
    setStartTime(undefined);
    setDuration(30);
    setKind("follow_up");
    setReason("");
    setNotes("");
    setError(undefined);
    setRefused(false);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  // A new patient's details are being filled in: Book registers them first.
  const registering = patient === undefined && picker.creating;
  const busy = book.isPending || create.isPending || picker.draft.formState.isSubmitting;
  const canSubmit = (patient !== undefined || registering) && practitionerId !== "" && !Number.isNaN(parseHm(startTime));

  const submit = () => {
    setError(undefined);
    if (patient !== undefined) {
      bookFor(patient);
      return;
    }
    if (!registering) {
      return;
    }
    void picker.draft.handleSubmit(async (values) => {
      let created: Patient;
      try {
        created = await create.mutateAsync(toNewPatient(values));
      } catch (thrown) {
        setError(patientErrorOf(picker.draft, thrown));
        return;
      }
      // Chosen before booking, so if the booking fails a retry books this patient instead of registering a second one.
      picker.reset();
      setPatient(created);
      bookFor(created);
    })();
  };

  const bookFor = (patient: Patient) => {
    setRefused(false);
    const startsAt = localInstant(date, startTime, timeZone);
    const endsAt = new Date(Date.parse(startsAt) + duration * 60_000).toISOString();
    book.mutate(
      {
        patient_id: patient.id,
        practitioner_id: practitionerIdSchema.parse(practitionerId),
        ...(roomId === "" ? {} : { room_id: roomId }),
        starts_at: startsAt,
        ends_at: endsAt,
        kind,
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
        ...(notes.trim() === "" ? {} : { notes: notes.trim() }),
      },
      {
        onSuccess: (saved) => {
          // The server's answer is the authority: it sees what this page couldn't (another desk, a narrower role).
          const notes = [...saved.warnings.map((w) => w.message), ...clashesFromServer(saved.patient_overlaps).map((c) => clashSentence(c, patient.full_name, timeZone))];
          if (notes.length > 0) {
            // Booked all the same: say so first, then what to look at.
            toast.show({ title: "Appointment booked", description: notes.join(" "), tone: "warning" });
          } else {
            toast.show({ title: "Appointment booked", tone: "success" });
          }
          close();
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown);
          if (failure?.code === "practitioner_on_leave") {
            setRefused(true);
            setError("That doctor is away at this time, so the appointment wasn't booked. Pick another time, or one of the doctors who are free.");
            return;
          }
          setError(failure?.message ?? "Couldn't book that appointment. Please try again.");
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
      description="Patient first, then who and when."
      dismissOnOutsidePress={false}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy ? (create.isPending ? "Registering…" : "Booking…") : registering ? "Register and book" : overlaps.length > 0 ? "Book anyway" : "Book appointment"}
          </Button>
        </>
      }
    >
      <div className="mk-bk">
        <BookingPatient patient={patient} onChange={setPatient} canRegister={canRegister} picker={picker} />

        <section className="mk-bk-sec" aria-label="Who">
          <div className="mk-bk-grid2">
            <Field label="Doctor" required>
              <Select options={practitioners.map((p) => ({ value: p.id, label: awayAt(p.id) ? `${p.display_name} (Away)` : p.display_name }))} value={practitionerId} onValueChange={(value) => { setPractitionerId(value); setRefused(false); setError(undefined); }} placeholder="Choose a doctor" />
            </Field>
            <div className="flex flex-col gap-2">
              <Switch label="Assign a chair" checked={assignChair} onCheckedChange={setAssignChair} />
              {assignChair ? (
                <Field label="Chair" hideLabel>
                  <Select options={rooms.map((r) => ({ value: r.id, label: r.name }))} value={chosenRoomId} onValueChange={setRoomId} placeholder="Choose a chair" />
                </Field>
              ) : null}
            </div>
          </div>
        </section>

        {chosenAway || refused ? (
          <div role="status" className="mk-bk-away">
            <p>{chosenAway ? "This doctor is away at the chosen time." : "That doctor is away at this time."}</p>
            {freeDoctors.length === 0 ? (
              <p>No other doctor is free then. Try another time.</p>
            ) : (
              <div className="mk-bk-away-free" role="group" aria-label="Free doctors">
                <span>Free then:</span>
                {freeDoctors.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="mk-chipf"
                    onClick={() => {
                      setPractitionerId(p.id);
                      setRefused(false);
                      setError(undefined);
                    }}
                  >
                    {p.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <section className="mk-bk-sec" aria-label="When">
          <div className="mk-bk-grid3">
            <Field label="Date" required id="bk-date">
              <DatePicker id="bk-date" value={date} onChange={setChosenDate} min={today} today={today} />
            </Field>
            <Field label="Start time" required>
              <TextInput
                inputMode="numeric"
                placeholder="HH:MM"
                value={startTime}
                aria-invalid={Number.isNaN(parseHm(startTime))}
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
          <TimeSlotPicker
            value={startTime}
            onChange={setStartTime}
            slots={slots}
            loading={loadingSlots}
            emptyNote={doctor.success ? "No free times that day. Type a custom time above." : "Choose a doctor to see their free times, or type a time above."}
          />
        </section>

        {patient === undefined ? null : <PatientOverlapNotice overlaps={overlaps} patientName={patient.full_name} timeZone={timeZone} action="Book anyway" />}
        {checkingOverlaps ? (
          <p role="status" className="text-xs text-muted">
            Checking {patient.full_name.split(" ")[0]}'s other appointments…
          </p>
        ) : null}

        <Field label="Kind">
          <Select options={KINDS} value={kind} onValueChange={setKind} />
        </Field>

        <details className="mk-bk-more">
          <summary>
            <ChevronDown aria-hidden="true" className="size-4" /> Add details
          </summary>
          <div className="mk-bk-moreBody">
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
          </div>
        </details>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
