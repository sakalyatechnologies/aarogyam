import { useState } from "react";

import "./calendar.css";

import { apiErrorOf, type AffectedAppointment } from "@aarogyam/api-client";
import { formatTime } from "@aarogyam/app-kit";
import { Button, Dialog, Pill, Select } from "@sakalya/ui";

import { useChangeAppointment } from "../../queries.js";

const KEEP = "keep";

type Outcome = { state: "moved"; to: string } | { state: "failed"; message: string };

function dayLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
}

/**
 * "Reassign N appointments": the unfinished appointments a doctor's time off covers, each with a suggested free
 * doctor. Moving one is the ordinary appointment update, so the patient notices go out as they always do. Rows left
 * as they are stay with the away doctor and show a "Doctor away" flag; a partial result is reported, not hidden.
 */
export function ReassignDialog({
  open,
  onOpenChange,
  appointments,
  personName,
  timeZone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointments: readonly AffectedAppointment[];
  /** Who is away. */
  personName: string;
  timeZone: string;
}) {
  const change = useChangeAppointment();
  // A choice per appointment: a suggested doctor, or leave it. Starts on the first suggestion.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<string | undefined>(undefined);

  const choiceOf = (a: AffectedAppointment) => picked[a.id] ?? a.suggestions[0]?.practitioner_id ?? KEEP;
  const pending = appointments.filter((a) => outcomes[a.id]?.state !== "moved");
  const toMove = pending.filter((a) => choiceOf(a) !== KEEP);

  const run = async () => {
    setRunning(true);
    setSummary(undefined);
    const next = { ...outcomes };
    let moved = 0;
    let failed = 0;
    // One at a time through the usual update, so each patient notice and conflict check applies as normal.
    for (const a of toMove) {
      const target = choiceOf(a);
      const name = a.suggestions.find((s) => s.practitioner_id === target)?.display_name ?? "another doctor";
      try {
        await change.mutateAsync({ id: a.id, changes: { practitioner_id: target } });
        next[a.id] = { state: "moved", to: name };
        moved += 1;
      } catch (thrown) {
        next[a.id] = { state: "failed", message: apiErrorOf(thrown)?.message ?? "Couldn't move this one." };
        failed += 1;
      }
    }
    setOutcomes(next);
    setRunning(false);
    const left = appointments.filter((a) => next[a.id]?.state !== "moved").length;
    setSummary(
      failed === 0
        ? `Reassigned ${String(moved)} of ${String(appointments.length)}.${left > 0 ? ` ${String(left)} stay with ${personName} and are flagged "Doctor away".` : ""}`
        : `Reassigned ${String(moved)} of ${String(toMove.length)}. ${String(failed)} couldn't be moved and ${failed === 1 ? "stays" : "stay"} flagged "Doctor away".`,
    );
  };

  const count = appointments.length;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Reassign ${String(count)} ${count === 1 ? "appointment" : "appointments"}`}
      description={`${personName} is away. Pick a free doctor for each, or leave it where it is.`}
      dismissOnOutsidePress={false}
      size="lg"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {summary === undefined ? "Not now" : "Close"}
          </Button>
          <Button onClick={() => void run()} disabled={running || toMove.length === 0}>
            {running ? "Reassigning…" : `Reassign ${String(toMove.length)}`}
          </Button>
        </>
      }
    >
      <ul className="mk-rs" aria-label="Affected appointments">
        {appointments.map((a) => {
          const outcome = outcomes[a.id];
          const options = [...a.suggestions.map((s) => ({ value: s.practitioner_id, label: s.in_hours ? s.display_name : `${s.display_name} (outside hours)` })), { value: KEEP, label: "Leave as is" }];
          return (
            <li key={a.id} className="mk-rs-row">
              <div className="mk-rs-who">
                <b>{a.patient_name}</b>
                <span>
                  {dayLabel(a.starts_at, timeZone)} · {formatTime(a.starts_at, timeZone)}
                </span>
              </div>
              {outcome?.state === "moved" ? (
                <Pill tone="success">Moved to {outcome.to}</Pill>
              ) : (
                <div className="mk-rs-pick">
                  <Select
                    aria-label={`Doctor for ${a.patient_name} at ${formatTime(a.starts_at, timeZone)}`}
                    options={options}
                    value={choiceOf(a)}
                    disabled={running}
                    onValueChange={(value) => {
                      setPicked((prev) => ({ ...prev, [a.id]: value }));
                    }}
                  />
                  <Pill tone="warning">Doctor away</Pill>
                </div>
              )}
              {outcome?.state === "failed" ? (
                <p role="alert" className="mk-rs-err">
                  {outcome.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {summary === undefined ? null : (
        <p role="status" className="mk-rs-sum">
          {summary}
        </p>
      )}
    </Dialog>
  );
}
