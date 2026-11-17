import { useState } from "react";

import { apiErrorOf, type Appointment, type AppointmentStatus, type PractitionerPage, type RoomPage } from "@aarogyam/api-client";
import { formatDateTime } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Pill, Select, Switch, TextArea, TextInput, useToast, type Tone } from "@sakalya/ui";

import { ageSex, formatPhone, maskPhone, patientPath } from "../../lib/patients.js";
import { useClinic } from "../../clinic.js";
import { localDateHour, localInstant, todayIn } from "../../lib/time.js";
import { DatePicker } from "../../components/mk/date-picker.js";
import { useAppointments, useChangeAppointment, useMoveAppointment, usePatient, useSetAppointmentStatus } from "../../queries.js";
import { PatientOverlapNotice, clashSentence, clashesFromServer, patientOverlaps } from "./patient-overlap.js";
import { VisitKindTag } from "./visit-kind-tag.js";
import { DURATIONS, KINDS } from "./booking-dialog.js";

const STATUS_TONE: Readonly<Record<AppointmentStatus, Tone>> = {
  requested: "warning",
  booked: "neutral",
  confirmed: "info",
  arrived: "warning",
  in_chair: "primary",
  completed: "success",
  cancelled: "neutral",
  no_show: "danger",
};

const STATUS_LABEL: Readonly<Record<AppointmentStatus, string>> = {
  requested: "Requested",
  booked: "Booked",
  confirmed: "Confirmed",
  arrived: "Arrived",
  in_chair: "In the chair",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

const TERMINAL: readonly AppointmentStatus[] = ["completed", "cancelled", "no_show"];

export interface AppointmentDialogProps {
  appointment: Appointment | undefined;
  onOpenChange: (open: boolean) => void;
  timeZone: string;
  rooms: RoomPage["items"];
  practitioners: PractitionerPage["items"];
  canWrite: boolean;
}

/** An appointment's details: reschedule it, or move its status along (confirm, arrive, cancel…). */
/** The patient's phone, to call about the booking: masked until asked (screens at a front desk are seen by others). */
function PatientPhone({ patientId }: { patientId: Appointment["patient"]["id"] }) {
  const { can } = useClinic();
  const patient = usePatient(can("patients.read") ? patientId : undefined);
  const [shown, setShown] = useState(false);
  const phone = patient.data?.phone;
  if (phone == null) return null;
  const revealable = can("patients.contact");
  return (
    <div>
      <dt className="text-xs text-muted">Phone</dt>
      <dd className="flex flex-wrap items-center gap-2 font-semibold text-text">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{revealable && shown ? formatPhone(phone) : maskPhone(phone)}</span>
        {revealable ? (
          <button
            type="button"
            className="mk-link text-xs"
            aria-pressed={shown}
            onClick={() => {
              setShown(!shown);
            }}
          >
            {shown ? "Hide phone" : "Show phone"}
          </button>
        ) : null}
      </dd>
    </div>
  );
}

export function AppointmentDialog({ appointment, onOpenChange, timeZone, rooms, practitioners, canWrite }: AppointmentDialogProps) {
  return (
    <Dialog open={appointment !== undefined} onOpenChange={onOpenChange} title="Appointment" size="lg">
      {appointment === undefined ? null : (
        <AppointmentDetail appointment={appointment} onClose={() => { onOpenChange(false); }} timeZone={timeZone} rooms={rooms} practitioners={practitioners} canWrite={canWrite} />
      )}
    </Dialog>
  );
}

function AppointmentDetail({
  appointment,
  onClose,
  timeZone,
  rooms,
  practitioners,
  canWrite,
}: {
  appointment: Appointment;
  onClose: () => void;
  timeZone: string;
  rooms: RoomPage["items"];
  practitioners: PractitionerPage["items"];
  canWrite: boolean;
}) {
  const toast = useToast();
  const setStatus = useSetAppointmentStatus();
  const change = useChangeAppointment();
  const move = useMoveAppointment();
  const requested = appointment.status === "requested";
  const [moving, setMoving] = useState(false);
  const [taken, setTaken] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const start = localDateHour(appointment.starts_at, timeZone);
  const [editDate, setEditDate] = useState(start.date);
  const [editTime, setEditTime] = useState(formatHHMM(start.hour));
  const [assignChair, setAssignChair] = useState(appointment.room_id != null);
  const [chosenRoomId, setEditRoomId] = useState(appointment.room_id ?? "");
  const editRoomId = assignChair ? chosenRoomId : "";
  const [editPractitionerId, setEditPractitionerId] = useState(appointment.practitioner.id);
  const bookedMinutes = Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60_000);
  // Length, visit kind and reason change here too, not only the time, doctor and chair.
  const [durationMinutes, setDurationMinutes] = useState(bookedMinutes);
  const [editKind, setEditKind] = useState<string>(appointment.kind);
  const [editReason, setEditReason] = useState(appointment.reason ?? "");
  const lengths = DURATIONS.some((d) => d === bookedMinutes) ? DURATIONS : [...DURATIONS, bookedMinutes].sort((a, b) => a - b);

  // The same patient's other appointments that day, so a move into one of them is flagged before saving.
  const dayList = useAppointments({ from: editDate, to: editDate });
  const editStart = /^\d{1,2}:\d{2}$/.test(editTime) ? localInstant(editDate, editTime, timeZone) : undefined;
  const editEnd = editStart === undefined ? undefined : new Date(Date.parse(editStart) + durationMinutes * 60_000).toISOString();
  // Only once the time or doctor was changed, and only from fresh data for the chosen day.
  const timeOrDoctorChanged = editDate !== start.date || editTime !== formatHHMM(start.hour) || editPractitionerId !== appointment.practitioner.id;
  const overlaps = !timeOrDoctorChanged || dayList.isPending || dayList.isPlaceholderData ? [] : patientOverlaps(dayList.data?.items ?? [], appointment.patient.id, editStart, editEnd, appointment.id);
  const detailsChanged = durationMinutes !== bookedMinutes || editKind !== appointment.kind || editReason.trim() !== (appointment.reason ?? "");
  const chairChanged = editRoomId !== (appointment.room_id ?? "");
  const moveLabel = requested ? "Move and confirm" : timeOrDoctorChanged || chairChanged || !detailsChanged ? "Move appointment" : "Save changes";

  const moveTo = (status: AppointmentStatus, reason?: string, doubleBook = false) => {
    setError(undefined);
    setTaken(false);
    setStatus.mutate(
      { id: appointment.id, change: { status, ...(reason === undefined ? {} : { reason }), ...(doubleBook ? { double_book: true } : {}) } },
      {
        onSuccess: () => {
          toast.show({
            title: appointment.status === "requested" && status === "cancelled" ? "Request declined" : doubleBook ? "Confirmed, double-booked" : `Marked ${STATUS_LABEL[status].toLowerCase()}`,
            tone: "success",
          });
          onClose();
        },
        onError: (thrown) => {
          if (apiErrorOf(thrown)?.code === "slot_occupied") {
            setTaken(true);
            return;
          }
          setError(apiErrorOf(thrown)?.message ?? "Couldn't update that appointment. Please try again.");
        },
      },
    );
  };

  /** A request: reschedule and confirm in one call. */
  const moveRequest = () => {
    setError(undefined);
    setTaken(false);
    move.mutate(
      {
        id: appointment.id,
        to: { starts_at: localInstant(editDate, editTime, timeZone), ...(editPractitionerId === appointment.practitioner.id ? {} : { practitioner_id: editPractitionerId }) },
      },
      {
        onSuccess: (moved) => {
          const clashes = clashesFromServer(moved.patient_overlaps).map((c) => clashSentence(c, appointment.patient.full_name, timeZone));
          toast.show({ title: clashes.length > 0 ? `Moved and confirmed. ${clashes.join(" ")}` : "Moved and confirmed", tone: clashes.length > 0 ? "warning" : "success" });
          onClose();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.code === "slot_occupied" ? "That time is taken too. Pick another time." : (apiErrorOf(thrown)?.message ?? "Couldn't move that request. Please try again."));
        },
      },
    );
  };

  const saveReschedule = () => {
    setError(undefined);
    const startsAt = localInstant(editDate, editTime, timeZone);
    const endsAt = new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
    change.mutate(
      {
        id: appointment.id,
        changes: {
          starts_at: startsAt,
          ends_at: endsAt,
          practitioner_id: editPractitionerId,
          room_id: editRoomId,
          ...(editKind === appointment.kind ? {} : { kind: editKind }),
          ...(editReason.trim() === (appointment.reason ?? "") ? {} : { reason: editReason.trim() }),
        },
      },
      {
        onSuccess: (saved) => {
          const notes = [...saved.warnings.map((w) => w.message), ...clashesFromServer(saved.patient_overlaps).map((c) => clashSentence(c, appointment.patient.full_name, timeZone))];
          const done = timeOrDoctorChanged || chairChanged ? "Appointment moved" : "Appointment updated";
          toast.show(notes.length > 0 ? { title: done, description: notes.join(" "), tone: "warning" } : { title: done, tone: "success" });
          onClose();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't move that appointment. Please try again.");
        },
      },
    );
  };

  const editable = canWrite && !TERMINAL.includes(appointment.status);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <PatientLink patient={appointment.patient} />
          <p className="text-xs text-muted">
            {appointment.patient.number} · {ageSex(appointment.patient.age_years, appointment.patient.sex)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill tone={STATUS_TONE[appointment.status]}>{STATUS_LABEL[appointment.status]}</Pill>
          <VisitKindTag kind={appointment.patient_type} timeZone={timeZone} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Doctor</dt>
          <dd className="font-semibold text-text">{appointment.practitioner.display_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Chair</dt>
          <dd className="font-semibold text-text">{appointment.room ?? "Not assigned"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">When</dt>
          <dd className="font-semibold text-text">{formatDateTime(appointment.starts_at, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Reason</dt>
          <dd className="font-semibold text-text">{appointment.reason ?? "Consultation"}</dd>
        </div>
        <PatientPhone patientId={appointment.patient.id} />
      </dl>
      {appointment.status === "requested" ? (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
          The patient asked for this time online. Confirm it, or decline with a reason; they are emailed either way.
        </p>
      ) : null}
      {appointment.cancel_reason == null ? null : (
        <p className="text-sm text-muted">Cancelled: {appointment.cancel_reason}</p>
      )}

      {taken ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
          <span>That time is taken.</span>
          <span className="flex gap-2">
            <Button variant="secondary" disabled={setStatus.isPending} onClick={() => { moveTo("confirmed", undefined, true); }}>
              Double-book
            </Button>
            <Button variant="secondary" onClick={() => { setTaken(false); setMoving(true); }}>
              Move
            </Button>
          </span>
        </div>
      ) : null}

      {editable && (!requested || moving) ? (
        <div className="rounded-2xl border border-border p-4">
          <p className="mb-3 text-sm font-bold text-text">{requested ? "Move and confirm" : "Change"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Doctor">
              <Select options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))} value={editPractitionerId} onValueChange={setEditPractitionerId} />
            </Field>
            <div className="flex flex-col gap-2">
              <Switch label="Assign a chair" checked={assignChair} onCheckedChange={setAssignChair} />
              {assignChair ? (
                <Field label="Chair" hideLabel>
                  <Select options={rooms.map((r) => ({ value: r.id, label: r.name }))} value={chosenRoomId} onValueChange={setEditRoomId} placeholder="Choose a chair" />
                </Field>
              ) : null}
            </div>
            {/* The same calendar picker as booking (day-first, today marked), not the browser's own date box. */}
            <Field label="Date" id="apt-date">
              <DatePicker id="apt-date" value={editDate} onChange={setEditDate} today={todayIn(timeZone)} />
            </Field>
            {/* No hint above this box: it put the time out of line with the date beside it. */}
            <Field label="Start time">
              <TextInput
                value={editTime}
                placeholder="HH:MM, 24-hour"
                inputMode="numeric"
                onChange={(event) => {
                  setEditTime(event.target.value);
                }}
              />
            </Field>
            {requested ? null : (
              <>
                <Field label="Length">
                  <Select
                    options={lengths.map((d) => ({ value: String(d), label: `${String(d)} min` }))}
                    value={String(durationMinutes)}
                    onValueChange={(value) => {
                      setDurationMinutes(Number(value));
                    }}
                  />
                </Field>
                <Field label="Visit kind">
                  <Select options={KINDS.map((k) => ({ value: k.value, label: k.label }))} value={editKind} onValueChange={setEditKind} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Reason">
                    <TextInput
                      value={editReason}
                      placeholder="Consultation"
                      onChange={(event) => {
                        setEditReason(event.target.value);
                      }}
                    />
                  </Field>
                </div>
              </>
            )}
          </div>
          <div className="mt-3">
            <PatientOverlapNotice overlaps={overlaps} patientName={appointment.patient.full_name} timeZone={timeZone} action={`${moveLabel} anyway`} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={requested ? moveRequest : saveReschedule} disabled={change.isPending || move.isPending}>
              {change.isPending || move.isPending ? "Moving…" : overlaps.length > 0 ? `${moveLabel} anyway` : moveLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {cancelling ? (
        <div className="rounded-2xl border border-danger-soft bg-danger-soft/40 p-4">
          <Field label={appointment.status === "requested" ? "Reason for declining" : "Reason for cancelling"} required>
            <TextArea
              value={cancelReason}
              onChange={(event) => {
                setCancelReason(event.target.value);
              }}
            />
          </Field>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCancelling(false);
                setCancelReason("");
              }}
            >
              Back
            </Button>
            <Button disabled={cancelReason.trim() === "" || setStatus.isPending} onClick={() => { moveTo("cancelled", cancelReason.trim()); }}>
              {appointment.status === "requested" ? "Decline request" : "Confirm cancellation"}
            </Button>
          </div>
        </div>
      ) : null}

      {error === undefined ? null : (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}

      {canWrite && !cancelling ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {appointment.status === "booked" || appointment.status === "requested" ? (
            <Button variant={appointment.status === "requested" ? "primary" : "secondary"} disabled={setStatus.isPending} onClick={() => { moveTo("confirmed"); }}>
              Confirm
            </Button>
          ) : null}
          {requested && !moving && !taken ? (
            <Button variant="secondary" disabled={setStatus.isPending} onClick={() => { setMoving(true); }}>
              Move
            </Button>
          ) : null}
          {appointment.status === "booked" || appointment.status === "confirmed" ? (
            <Button disabled={setStatus.isPending} onClick={() => { moveTo("arrived"); }}>
              Mark arrived
            </Button>
          ) : null}
          {appointment.status === "arrived" ? (
            <Button disabled={setStatus.isPending} onClick={() => { moveTo("in_chair"); }}>
              Seat in chair
            </Button>
          ) : null}
          {appointment.status === "in_chair" ? (
            <Button disabled={setStatus.isPending} onClick={() => { moveTo("completed"); }}>
              Complete
            </Button>
          ) : null}
          {appointment.status === "booked" || appointment.status === "confirmed" ? (
            <Button variant="secondary" disabled={setStatus.isPending} onClick={() => { moveTo("no_show"); }}>
              No-show
            </Button>
          ) : null}
          {!TERMINAL.includes(appointment.status) ? (
            <Button
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => {
                setCancelling(true);
              }}
            >
              {appointment.status === "requested" ? "Decline" : "Cancel"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PatientLink({ patient }: { patient: Appointment["patient"] }) {
  return (
    <a href={patientPath(patient)} className="text-lg font-extrabold tracking-tight text-text hover:underline">
      {patient.full_name}
    </a>
  );
}

function formatHHMM(hour: number): string {
  const whole = Math.floor(hour);
  const minute = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
