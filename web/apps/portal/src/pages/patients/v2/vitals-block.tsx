/**
 * Vitals in the new look. During a visit: what is recorded as chips and one optional inline form (one save, any
 * readings). Otherwise the latest visit's vitals, read-only, with its date. Never part of End visit.
 */
import { useState } from "react";

import { apiErrorOf, type Observation, type VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime } from "@aarogyam/app-kit";
import { Button, Field, TextInput } from "@sakalya/ui";

import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useRecordObservations, useVisit, useVisits } from "../../../queries.js";
import { OBSERVATION_KINDS, parseValue, vitalsOf } from "../../visits/vitals.js";
import { Bento } from "./kit.js";
import { useVisitSession } from "./visit-session.js";

/** The recorded vitals as small chips, oldest first. Hovering one shows when it was taken. */
export function VitalChips({ observations }: { observations: readonly Observation[] }) {
  const vitals = vitalsOf(observations);
  if (vitals.length === 0) return null;
  return (
    <ul aria-label="Vitals" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {vitals.map((v) => (
        <li key={v.id} className="p360-chip" style={{ cursor: "default" }} title={formatDateTime(v.recordedAt)}>
          {v.text}
        </li>
      ))}
    </ul>
  );
}

/** One field per kind on one wrapping line. Saves every value typed in a single request. */
function VitalsForm({ visitId, onDone }: { visitId: VisitId; onDone: () => void }) {
  const record = useRecordObservations(visitId);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>(undefined);
  // A message under the reading it is about, so the doctor sees which field to fix.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = () => {
    const typed = OBSERVATION_KINDS.map((k) => ({ kind: k.value, text: values[k.value] ?? "" })).filter((r) => r.text.trim() !== "");
    const notNumbers = typed.filter((r) => parseValue(r.text) === undefined);
    if (typed.length === 0) {
      setFieldErrors({});
      setError("Type at least one reading.");
      return;
    }
    if (notNumbers.length > 0) {
      setFieldErrors(Object.fromEntries(notNumbers.map((r) => [r.kind, "Must be a number"])));
      setError(undefined);
      return;
    }
    setFieldErrors({});
    setError(undefined);
    const readings = typed.map((r) => ({ kind: r.kind, value: parseValue(r.text) ?? 0 }));
    record.mutate(
      { readings },
      {
        onSuccess: onDone,
        onError: (thrown) => {
          const message = apiErrorOf(thrown)?.message ?? "Couldn't record the vitals.";
          // The API names the reading by its kind first: "Bp_systolic: must be between 60 and 260 mmHg".
          const kind = OBSERVATION_KINDS.find((k) => message.toLowerCase().startsWith(`${k.value}: `));
          if (kind === undefined) {
            setError(message);
          } else {
            setFieldErrors({ [kind.value]: message.slice(kind.value.length + 2) });
          }
        },
      },
    );
  };

  return (
    <form
      aria-label="Add vitals"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {OBSERVATION_KINDS.map((k) => (
        <Field key={k.value} label={`${k.label} (${k.unit})`} className="w-28" error={fieldErrors[k.value]}>
          <TextInput
            inputMode="decimal"
            value={values[k.value] ?? ""}
            onChange={(event) => {
              setValues((prev) => ({ ...prev, [k.value]: event.target.value }));
              setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([kind]) => kind !== k.value)));
            }}
          />
        </Field>
      ))}
      <Button type="submit" disabled={record.isPending}>
        {record.isPending ? "Saving…" : "Save vitals"}
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {error === undefined ? null : (
        <p role="alert" className="m-0 w-full text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * The vitals card on Patient 360. An open visit shows its readings (and Add vitals for those who may write); with no
 * open visit it shows the latest visit's readings with their date, and says nothing when there are none.
 */
export function VitalsBlock() {
  const session = useVisitSession();
  const visits = useVisits(session.patientId);
  const open = session.visit;
  const latest = open ?? [...(visits.data?.items ?? [])].sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  const detail = useVisit(latest?.id);
  const [adding, setAdding] = useState(false);

  if (latest === undefined) {
    return visits.isPending || session.visitLoading ? <SkeletonRows count={1} label="Loading vitals" /> : null;
  }
  const canAdd = session.canWrite && open !== undefined;
  const observations = detail.data?.observations ?? [];
  const none = detail.data !== undefined && vitalsOf(observations).length === 0;
  if (none && !canAdd) return null;
  const title = open === undefined ? "Last vitals" : "Vitals";
  const sub = open === undefined ? formatDate(latest.started_at) : undefined;
  return (
    <Bento flat title={title} sub={sub}>
      {detail.isPending ? (
        <SkeletonRows count={1} label="Loading vitals" />
      ) : detail.isError ? (
        <ApiErrorNotice title="Couldn't load the vitals" error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          {none ? <p className="mk-hint" style={{ margin: 0 }}>No vitals recorded</p> : <VitalChips observations={observations} />}
          {!canAdd ? null : adding ? (
            <VitalsForm
              visitId={latest.id}
              onDone={() => {
                setAdding(false);
              }}
            />
          ) : (
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add vitals
              </Button>
            </div>
          )}
        </div>
      )}
    </Bento>
  );
}
