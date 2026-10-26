import { useState } from "react";

import { apiErrorOf, type AppointmentId, type MissedListPage } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";
import { DateInput, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { localInstant } from "../../../lib/time.js";
import { useChangeAppointment, useSetAppointmentStatus } from "../../../queries.js";
import { useSendMissedReminder } from "../../queue/desk-queries.js";
import type { Appointment } from "./seeing.js";

type Missed = MissedListPage["items"][number];

/** "Missed today": the day's no-shows, each with Check in (late arrival), Reschedule and Send reminder right on the row. */
export function MissedSection({ missed, appointments, zone }: { missed: MissedListPage; appointments: readonly Appointment[]; zone: string }) {
  const { can } = useClinic();
  const canWrite = can("appointments.write");
  const toast = useToast();
  const setStatus = useSetAppointmentStatus();
  const remind = useSendMissedReminder();
  const [moving, setMoving] = useState<AppointmentId | undefined>(undefined);
  if (missed.items.length === 0) {
    return null;
  }
  const checkIn = (item: Missed) => {
    setStatus.mutate(
      { id: item.appointment_id, change: { status: "arrived" } },
      {
        onSuccess: () => {
          toast.show({ title: "Checked in", tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't check them in.", tone: "danger" });
        },
      },
    );
  };
  return (
    <section aria-label="Missed today">
      <h3 className="tv2-h3">Missed today ({missed.items.length})</h3>
      <ul aria-label="Missed today" className="tv2-list tv2-qlist">
        {missed.items.map((item) => {
          const known = appointments.find((a) => a.id === item.appointment_id);
          const name = known?.patient.full_name ?? item.patient_number;
          return (
            <li key={item.appointment_id} className="tv2-missed">
              <span className="tv2-grow">
                <span className="tv2-name">{name}</span>
                <span className="tv2-sub">Was due {formatTime(item.starts_at, zone)}</span>
              </span>
              {canWrite ? (
                <>
                  <button
                    type="button"
                    className="tv2-chip"
                    disabled={setStatus.isPending}
                    aria-label={`Check in ${name}`}
                    onClick={() => {
                      checkIn(item);
                    }}
                  >
                    Check in
                  </button>
                  <button
                    type="button"
                    className="tv2-chip"
                    aria-label={`Reschedule ${name}`}
                    onClick={() => {
                      setMoving(moving === item.appointment_id ? undefined : item.appointment_id);
                    }}
                  >
                    Reschedule
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="tv2-chip"
                disabled={remind.isPending}
                aria-label={`Send reminder to ${name}`}
                onClick={() => {
                  remind.mutate(item.patient_id);
                }}
              >
                Send reminder
              </button>
              {moving === item.appointment_id ? (
                <Reschedule
                  item={item}
                  known={known}
                  zone={zone}
                  onDone={() => {
                    setMoving(undefined);
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A date and a start time, then one PATCH; the doctor and the visit length stay as they were. */
function Reschedule({ item, known, zone, onDone }: { item: Missed; known: Appointment | undefined; zone: string; onDone: () => void }) {
  const change = useChangeAppointment();
  const toast = useToast();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const minutes = known === undefined ? 30 : Math.max(5, Math.round((Date.parse(known.ends_at) - Date.parse(known.starts_at)) / 60_000));
  const save = () => {
    const startsAt = localInstant(date, time, zone);
    change.mutate(
      {
        id: item.appointment_id,
        changes: { starts_at: startsAt, ends_at: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString(), practitioner_id: item.practitioner_id },
      },
      {
        onSuccess: () => {
          toast.show({ title: "Appointment moved", tone: "success" });
          onDone();
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't move that appointment.", tone: "danger" });
        },
      },
    );
  };
  return (
    <div className="tv2-resched">
      <DateInput value={date} onValueChange={setDate} aria-label="New date" />
      <TextInput
        value={time}
        aria-label="New start time (24-hour, HH:MM)"
        onChange={(event) => {
          setTime(event.target.value);
        }}
      />
      <button type="button" className="tv2-chip" disabled={date === "" || change.isPending} onClick={save}>
        {change.isPending ? "Moving…" : "Move"}
      </button>
    </div>
  );
}
