import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, patientId as patientIdSchema, practitionerId as practitionerIdSchema, type Patient, type PractitionerPage, type RoomPage } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, TextArea, TextInput, useToast } from "@sakalya/ui";

import { DatePicker } from "../../components/mk/date-picker.js";
import { TimeSlotPicker } from "../../components/mk/time-slots.js";
import { useClinic } from "../../clinic.js";
import { freeSlots, parseHm, shiftsOn } from "../../lib/slots.js";
import { localInstant, todayIn } from "../../lib/time.js";
import { nowMinutes, placementOf } from "../../lib/time-grid.js";
import { useTimeOff } from "../../lib/time-off-queries.js";
import { isAway } from "./away.js";
import { useAppointments, useBookAppointment, usePatient, useWorkingHours } from "../../queries.js";
import { BookingPatient } from "./booking-patient.js";

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
  /** The date the calendar is showing; the form starts on it. */
  defaultDate: string;
  /** `?patient=<id>`: book for this patient without searching. */
  patientParam?: string | null;
}

/** The dialog that books a new appointment: patient, doctor and chair, then a day and a free time. */
export function BookingDialog({ open, onOpenChange, timeZone, rooms, practitioners, defaultDate, patientParam = null }: BookingDialogProps) {
  const { can } = useClinic();
  const [picked, setPicked] = useState<Patient | undefined>(undefined);
  const [cleared, setCleared] = useState(false);
  const parsed = patientIdSchema.safeParse(patientParam);
  const prefill = usePatient(parsed.success ? parsed.data : undefined);
  const patient = picked ?? (cleared ? undefined : prefill.data);
  const setPatient = (next: Patient | undefined) => {
    setPicked(next);
    setCleared(next === undefined);
  };
  const [practitionerId, setPractitionerId] = useState("");
  const [roomId, setRoomId] = useState("");
  // Until the person picks a day, follow the calendar's.
  const [chosenDate, setChosenDate] = useState<string | undefined>(undefined);
  const date = chosenDate ?? defaultDate;
  const [startTime, setStartTime] = useState("09:00");
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
  const freeDoctors = practitioners.filter((p) => p.active && p.id !== practitionerId && !awayAt(p.id) && !busyAt(p.id));
  const chosenAway = practitionerId !== "" && awayAt(practitionerId);
  const [refused, setRefused] = useState(false);
  const loadingSlots = doctor.success && (hours.isPending || day.isPending);

  const reset = () => {
    setPicked(undefined);
    setCleared(false);
    setPractitionerId("");
    setRoomId("");
    setChosenDate(undefined);
    setStartTime("09:00");
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

  const canSubmit = patient !== undefined && practitionerId !== "" && !Number.isNaN(parseHm(startTime));

  const submit = () => {
    if (patient === undefined) {
      return;
    }
    setError(undefined);
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
          if (saved.warnings.length > 0) {
            toast.show({ title: saved.warnings.map((w) => w.message).join(" "), tone: "warning" });
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
          <Button onClick={submit} disabled={!canSubmit || book.isPending}>
            {book.isPending ? "Booking…" : "Book appointment"}
          </Button>
        </>
      }
    >
      <div className="mk-bk">
        <BookingPatient patient={patient} onChange={setPatient} canRegister={can("patients.write")} />

        <section className="mk-bk-sec" aria-label="Who">
          <div className="mk-bk-grid2">
            <Field label="Doctor" required>
              <Select options={practitioners.map((p) => ({ value: p.id, label: awayAt(p.id) ? `${p.display_name} (Away)` : p.display_name }))} value={practitionerId} onValueChange={(value) => { setPractitionerId(value); setRefused(false); setError(undefined); }} placeholder="Choose a doctor" />
            </Field>
            <Field label="Chair">
              <Select options={rooms.map((r) => ({ value: r.id, label: r.name }))} value={roomId} onValueChange={setRoomId} placeholder="Any chair" />
            </Field>
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
