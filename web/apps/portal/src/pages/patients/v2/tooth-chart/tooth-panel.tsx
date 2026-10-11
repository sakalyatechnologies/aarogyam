import { Pencil, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, randomUuid, visitId as visitIdSchema, type DentalTerm, type ToothSurface, type PatientId, type PlanItem, type Procedure, type VisitId } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { Button, useToast } from "@sakalya/ui";

import { Tag, statusTone } from "../../../../components/mk/index.js";
import { useAddDentalTerm, useRecordChartEntries, useRecordProcedure } from "../../../../queries.js";
import { useCreatePlan, useSetPlanItemStatus } from "../../../treatment-plans/queries.js";
import { useToothHistory } from "../../../visits/queries.js";
import { kindName, surfaceLabel } from "../../../visits/odontogram/model.js";
import { PillButton } from "../kit.js";
import { allowsSurfaces, blankDraft, buildEntries, defaultMaterial, buildPlan, correctionBatch, draftFromRow, historyRows, treatmentOf, type Draft, type HistoryRow, type RowStatus } from "./model.js";
import { TreatmentForm } from "./treatment-form.js";

const TONE: Readonly<Record<RowStatus, "success" | "info" | "warning" | "neutral" | "danger">> = {
  Completed: "success",
  "In progress": "info",
  Planned: "warning",
  Watch: "neutral",
  Superseded: "neutral",
  "Entered in error": "danger",
};

/** Stands in for the visit while there is none; save() returns before any call when there is no visit. */
const NO_VISIT = visitIdSchema.parse("no-visit");

interface Props {
  patientId: PatientId;
  tooth: number | undefined;
  /** A surface picked in the Classic chart: the Add form starts with it chosen. */
  surface?: ToothSurface | null;
  /** The open visit, when there is one: treatment is recorded in it. */
  visitId: VisitId | undefined;
  canWrite: boolean;
  starting: boolean;
  onStartVisit: () => void;
  terms: readonly DentalTerm[];
  planItems: readonly PlanItem[];
  procedures: readonly Procedure[];
  who: (id: string | null | undefined) => string | undefined;
  onClose: () => void;
}

/** The tooth's side panel: its history (each current row can be edited as a correction) and the Add treatment form. */
export function ToothPanel(props: Props) {
  const { tooth } = props;
  if (tooth === undefined) {
    return (
      <aside className="tc-panel" aria-label="Tooth panel">
        <p className="tc-empty">Tap any tooth to see its history and record a treatment.</p>
      </aside>
    );
  }
  // Keyed by tooth so picking another tooth starts from the history view with a blank form.
  return <SelectedTooth key={tooth} {...props} tooth={tooth} />;
}

function SelectedTooth({ patientId, tooth, surface, visitId, canWrite, starting, onStartVisit, terms, planItems, procedures, who, onClose }: Props & { tooth: number }) {
  const history = useToothHistory(patientId, tooth);
  const [mode, setMode] = useState<"view" | "form">("view");
  const [editing, setEditing] = useState<HistoryRow | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [error, setError] = useState<string | undefined>(undefined);
  // One id per save attempt: a retry after a lost response is the same request, not a second treatment.
  const attempt = useRef(randomUuid());
  const toast = useToast();
  const record = useRecordChartEntries(patientId);
  const createPlan = useCreatePlan(patientId);
  const setItem = useSetPlanItemStatus(patientId);
  const addTerm = useAddDentalTerm();
  const recordProcedure = useRecordProcedure(visitId ?? NO_VISIT, patientId);
  const rows = historyRows({ history: history.data?.history ?? [], planItems, procedures, tooth, who });
  const busy = record.isPending || createPlan.isPending || setItem.isPending || recordProcedure.isPending;
  const open = canWrite && visitId !== undefined;

  const startAdd = () => {
    setEditing(undefined);
    // Start where most records start: Completed, the only material that fits chosen, and a surface picked on the chart.
    const start = blankDraft();
    const first = treatmentOf(start.tx);
    setDraft({ ...start, material: defaultMaterial(first, terms), surfaces: surface != null && allowsSurfaces(first, start.status) ? [surface] : [] });
    setError(undefined);
    setMode("form");
  };
  const startEdit = (row: HistoryRow) => {
    setEditing(row);
    setDraft(draftFromRow(row));
    setError(undefined);
    setMode("form");
  };
  const back = () => {
    setMode("view");
    setError(undefined);
  };

  const refuse = (thrown: unknown) => {
    const failure = apiErrorOf(thrown);
    setError(
      failure?.status === 409
        ? "This visit is closed, or the chart changed. Start a visit or reload, then try again."
        : (failure?.message ?? "Couldn't save the treatment. Please try again."),
    );
  };

  const save = async () => {
    if (visitId === undefined) return;
    setError(undefined);
    const tx = treatmentOf(draft.tx);
    const material = terms.find((t) => t.id === draft.material)?.label;
    try {
      if (draft.status === "Planned") {
        await createPlan.mutateAsync({ ...buildPlan(tooth, draft, material), visit_id: visitId });
      } else if (tx.finding === undefined) {
        await recordProcedure.mutateAsync({ name: tx.label, tooth, surfaces: [], status: "done", client_id: attempt.current, ...(draft.note.trim() === "" ? {} : { note: draft.note.trim() }) });
      } else {
        const fresh = buildEntries(tooth, draft);
        const entries = editing?.kind === "chart" ? correctionBatch(tooth, editing.entries, fresh) : fresh;
        await record.mutateAsync({ entries, visit_id: visitId, client_id: attempt.current });
        // A planned item that is accepted is finished by recording it; a proposed one waits for the patient's yes.
        if (editing?.planItem?.status === "accepted") await setItem.mutateAsync({ item: editing.planItem, status: "done" });
      }
    } catch (thrown) {
      refuse(thrown);
      return;
    }
    attempt.current = randomUuid();
    toast.show({ title: `Tooth ${String(tooth)}: ${tx.label} ${editing === undefined ? "saved" : "updated"}`, tone: "success" });
    setMode("view");
  };

  return (
    <aside className="tc-panel" aria-label={`Tooth ${String(tooth)} panel`} aria-live="polite">
      <div className="tc-head">
        <div>
          <h3>{`Tooth ${String(tooth)}, ${kindName(tooth)}`}</h3>
          <p className="tc-sub">{mode === "view" ? `Treatment record, ${String(rows.length)} ${rows.length === 1 ? "entry" : "entries"}` : "Record treatment, surfaces and materials"}</p>
        </div>
        <button type="button" className="p360-chip" aria-label="Close tooth" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      {mode === "view" ? (
        <>
          {history.isPending ? <p className="tc-meta">Loading history…</p> : null}
          {history.isError ? (
            <p role="alert" className="tc-meta">
              Couldn't load this tooth's history.
            </p>
          ) : null}
          {!history.isPending && !history.isError && rows.length === 0 ? <p className="tc-empty">No treatment on this tooth yet.</p> : null}
          <ol className="tc-history" aria-label={`History of tooth ${String(tooth)}`}>
            {rows.map((row) => (
              <li key={row.key} className="tc-card" data-old={row.status === "Superseded" || row.status === "Entered in error" ? "" : undefined}>
                <div className="tc-card-top">
                  <strong>{row.sitting === undefined || row.treatment !== "root_canal" ? row.label : `${row.label}, sitting ${String(row.sitting)}`}</strong>
                  <Tag tone={statusTone(TONE[row.status])}>{row.status}</Tag>
                </div>
                <p className="tc-meta">{[row.date === undefined ? "Not done yet" : formatDate(row.date), row.material, row.recordedBy].filter((p) => p !== undefined).join(" · ")}</p>
                {row.surfaces.length + row.canals.length === 0 ? null : (
                  <div className="tc-tags">
                    {row.surfaces.map((s) => (
                      <Tag key={s}>{surfaceLabel(tooth, s)}</Tag>
                    ))}
                    {row.canals.map((c) => (
                      <Tag key={c.name}>{c.working_length_mm == null ? c.name : `${c.name} ${String(c.working_length_mm)} mm`}</Tag>
                    ))}
                  </div>
                )}
                {row.note === undefined || row.note === "" ? null : <p>{row.note}</p>}
                {row.editable && open ? (
                  <div className="tc-actions">
                    <Button
                      variant="secondary"
                      icon={<Pencil aria-hidden="true" className="size-3.5" />}
                      aria-label={`Edit ${row.label}${row.date === undefined ? "" : ` of ${formatDate(row.date)}`}`}
                      onClick={() => {
                        startEdit(row);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {!canWrite ? null : visitId === undefined ? (
            <div className="tc-actions">
              <p className="tc-meta" style={{ width: "100%" }}>
                Start a visit to record treatment.
              </p>
              <PillButton disabled={starting} onClick={onStartVisit}>
                {starting ? "Starting…" : "Start visit"}
              </PillButton>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <div className="tc-actions">
              <PillButton icon={<Plus aria-hidden="true" className="size-4" />} onClick={startAdd}>
                Add treatment
              </PillButton>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </>
      ) : (
        <TreatmentForm
          tooth={tooth}
          draft={draft}
          onChange={setDraft}
          terms={terms}
          editing={editing !== undefined && editing.kind === "chart"}
          planned={editing?.kind === "plan"}
          busy={busy}
          error={error}
          onAddMaterial={(label) => addTerm.mutateAsync({ kind: "material", label })}
          onSave={() => void save()}
          onBack={back}
          onClose={onClose}
        />
      )}
    </aside>
  );
}
