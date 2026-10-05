import { useState } from "react";

import { apiErrorOf, type Appointment, type AppointmentStatus, type PractitionerPage, type RoomPage } from "@aarogyam/api-client";
import { formatDateTime } from "@aarogyam/app-kit";
import { Button, DateInput, Dialog, Field, Pill, Select, TextArea, TextInput, useToast, type Tone } from "@sakalya/ui";

import { ageSex, patientPath } from "../../lib/patients.js";
import { localDateHour, localInstant } from "../../lib/time.js";
import { useChangeAppointment, useSetAppointmentStatus } from "../../queries.js";

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
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const start = localDateHour(appointment.starts_at, timeZone);
  const [editDate, setEditDate] = useState(start.date);
  const [editTime, setEditTime] = useState(formatHHMM(start.hour));
  const [editRoomId, setEditRoomId] = useState(appointment.room_id ?? "");
  const [editPractitionerId, setEditPractitionerId] = useState(appointment.practitioner.id);
  const durationMinutes = Math.round((Date.parse(appointment.ends_at) - Date.parse(appointment.starts_at)) / 60_000);

  const moveTo = (status: AppointmentStatus, reason?: string) => {
    setError(undefined);
    setStatus.mutate(
      { id: appointment.id, change: { status, ...(reason === undefined ? {} : { reason }) } },
      {
        onSuccess: () => {
          toast.show({
            title: appointment.status === "requested" && status === "cancelled" ? "Request declined" : `Marked ${STATUS_LABEL[status].toLowerCase()}`,
            tone: "success",
          });
          onClose();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't update that appointment. Please try again.");
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
        },
      },
      {
        onSuccess: (saved) => {
          toast.show({
            title: saved.warnings.length > 0 ? saved.warnings.map((w) => w.message).join(" ") : "Appointment moved",
            tone: saved.warnings.length > 0 ? "warning" : "success",
          });
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
        <Pill tone={STATUS_TONE[appointment.status]}>{STATUS_LABEL[appointment.status]}</Pill>
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
      </dl>
      {appointment.status === "requested" ? (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning-text">
          The patient asked for this time online. Confirm it, or decline with a reason; they are emailed either way.
        </p>
      ) : null}
      {appointment.cancel_reason == null ? null : (
        <p className="text-sm text-muted">Cancelled: {appointment.cancel_reason}</p>
      )}

      {editable ? (
        <div className="rounded-2xl border border-border p-4">
          <p className="mb-3 text-sm font-bold text-text">Reschedule</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Doctor">
              <Select options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))} value={editPractitionerId} onValueChange={setEditPractitionerId} />
            </Field>
            <Field label="Chair" hint="Optional">
              <Select options={rooms.map((r) => ({ value: r.id, label: r.name }))} value={editRoomId} onValueChange={setEditRoomId} placeholder="No chair assigned" />
            </Field>
            <Field label="Date">
              <DateInput value={editDate} onValueChange={setEditDate} />
            </Field>
            <Field label="Start time" hint="24-hour, HH:MM">
              <TextInput
                value={editTime}
                onChange={(event) => {
                  setEditTime(event.target.value);
                }}
              />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={saveReschedule} disabled={change.isPending}>
              {change.isPending ? "Moving…" : "Move appointment"}
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
