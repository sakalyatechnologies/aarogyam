import { CalendarCheck, Footprints } from "lucide-react";
import { useState } from "react";

import { apiErrorOf } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";
import { Badge, Button, Dialog, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useAppointments, useSetAppointmentStatus } from "../../queries.js";
import { WalkInWizard } from "./walk-in-wizard.js";

/**
 * The one "Add to queue" entry point. It asks which path: check in someone who booked for today, or register a walk-in
 * with no booking (details, health, consent).
 */
export function AddToQueue({
  open,
  onOpenChange,
  day,
  practitioners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clinic day, `YYYY-MM-DD`. */
  day: string;
  practitioners: readonly { id: string; display_name: string }[];
}) {
  const [mode, setMode] = useState<"choose" | "checkin" | "walkin">("choose");
  const close = () => {
    onOpenChange(false);
    setMode("choose");
  };
  return (
    <>
      <Dialog
        open={open && mode !== "walkin"}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        title="Add to queue"
        description={mode === "choose" ? "Did the patient book for today?" : "Find today's booking and check them in."}
        footer={
          mode === "checkin" ? (
            <Button
              variant="secondary"
              onClick={() => {
                setMode("choose");
              }}
            >
              Back
            </Button>
          ) : (
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          )
        }
      >
        {mode === "choose" ? (
          <div className="fd-choices">
            <button
              type="button"
              className="fd-choice"
              onClick={() => {
                setMode("checkin");
              }}
            >
              <CalendarCheck aria-hidden="true" className="size-5" />
              <b>Check in a booking</b>
              <span>They have an appointment today. Search by name.</span>
            </button>
            <button
              type="button"
              className="fd-choice"
              onClick={() => {
                setMode("walkin");
              }}
            >
              <Footprints aria-hidden="true" className="size-5" />
              <b>Register a walk-in</b>
              <span>No booking. Three quick steps: details, health, consent.</span>
            </button>
          </div>
        ) : (
          <CheckInList day={day} onDone={close} />
        )}
      </Dialog>
      <WalkInWizard
        open={open && mode === "walkin"}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        practitioners={practitioners}
      />
    </>
  );
}

/** Today's appointments that have not arrived yet, searchable, each with a Check in button. */
function CheckInList({ day, onDone }: { day: string; onDone: () => void }) {
  const { session } = useClinic();
  const [search, setSearch] = useState("");
  const appointments = useAppointments({ from: day, to: day });
  const setStatus = useSetAppointmentStatus();
  const toast = useToast();
  const needle = search.trim().toLowerCase();
  const waiting = (appointments.data?.items ?? [])
    .filter((a) => (a.status === "booked" || a.status === "confirmed") && a.token_number == null)
    .filter((a) => needle === "" || a.patient.full_name.toLowerCase().includes(needle) || a.patient.number.toLowerCase().includes(needle))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        type="search"
        aria-label="Search today's bookings"
        placeholder="Search by name or patient number"
        value={search}
        onChange={(event) => {
          setSearch(event.currentTarget.value);
        }}
      />
      {appointments.isPending ? (
        <p role="status" className="text-sm text-muted">
          Loading today's bookings…
        </p>
      ) : appointments.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {apiErrorOf(appointments.error)?.message ?? "Couldn't load today's bookings."}
        </p>
      ) : waiting.length === 0 ? (
        <p className="text-sm text-muted">{needle === "" ? "Nobody left to check in for today." : "No booking matches that search."}</p>
      ) : (
        <ul className="fd-list">
          {waiting.map((a) => (
            <li key={a.id}>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm">{a.patient.full_name}</b>
                <span className="block truncate text-xs text-muted">
                  {formatTime(a.starts_at, session.clinic.timezone)} · {a.practitioner.display_name}
                  {a.reason == null ? "" : ` · ${a.reason}`}
                </span>
              </div>
              <Badge tone="info">Booked</Badge>
              <Button
                disabled={setStatus.isPending}
                aria-label={`Check in ${a.patient.full_name}`}
                onClick={() => {
                  setStatus.mutate(
                    { id: a.id, change: { status: "arrived" } },
                    {
                      onSuccess: () => {
                        toast.show({ title: `${a.patient.full_name} checked in`, tone: "success" });
                        onDone();
                      },
                      onError: (thrown) => {
                        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't check in. Please try again.", tone: "danger" });
                      },
                    },
                  );
                }}
              >
                Check in
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
