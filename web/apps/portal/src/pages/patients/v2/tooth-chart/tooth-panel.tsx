import { Pencil, Plus, Search } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, randomUuid, visitId as visitIdSchema, type ChartEntry, type DentalTerm, type ToothCondition, type ToothEruption, type ToothStatus, type ToothSurface, type PatientId, type PlanItem, type Procedure, type VisitId } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";
import { Button, useToast } from "@sakalya/ui";

import { Tag, statusTone } from "../../../../components/mk/index.js";
import { useAddDentalTerm, useRecordChartEntries, useRecordProcedure } from "../../../../queries.js";
import { useCreatePlan, useSetPlanItemStatus } from "../../../treatment-plans/queries.js";
import { useToothHistory } from "../../../visits/queries.js";
import { surfaceLabel } from "../../../visits/odontogram/model.js";
import { PillButton } from "../kit.js";
import { allowsSurfaces, blankDraft, buildEntries, defaultMaterial, buildPlan, correctionBatch, draftFromRow, historyRows, toothName, treatmentOf, type Draft, type HistoryRow, type RowStatus } from "./model.js";
import { DetailChips } from "./detail-chips.js";
import { FindingForm } from "./finding-form.js";
import { HealthRow } from "./health-row.js";
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
  terms: readonly DentalTerm[];
  planItems: readonly PlanItem[];
  procedures: readonly Procedure[];
  who: (id: string | null | undefined) => string | undefined;
  onClose: () => void;
  /** The tooth's current chart entries, for the health the chart suggests. */
  entries?: readonly ChartEntry[];
  /** The doctor's current status of the tooth, if any. */
  status?: ToothStatus | undefined;
  /** The tooth's current condition and eruption (§1.13 details), if any. */
  condition?: ToothCondition | undefined;
  eruption?: ToothEruption | undefined;
  /** Start dictating the tooth's note (a long press on it). */
  dictate?: boolean;
  onDictateStarted?: () => void;
}

const NO_ENTRIES: readonly ChartEntry[] = [];
const noop = () => undefined;

/** The tooth's side panel: its history (each current row can be edited as a correction), the Add treatment form and Record a finding. */
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

function SelectedTooth({ patientId, tooth, surface, visitId, canWrite, terms, planItems, procedures, who, onClose, entries = NO_ENTRIES, status, condition, eruption, dictate = false, onDictateStarted = noop }: Props & { tooth: number }) {
  const history = useToothHistory(patientId, tooth);
  const [mode, setMode] = useState<"view" | "form" | "finding">("view");
  const [editing, setEditing] = useState<HistoryRow | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [error, setError] = useState<string | undefined>(undefined);
  // One id per save attempt: a retry after a lost response is the same request, not a second treatment.
  const attempt = useRef(randomUuid());
  // Done elsewhere is remembered while the panel stays on this tooth: recording old work at a first visit is the common case.
  const elsewhere = useRef(false);
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
    setDraft({ ...start, elsewhere: elsewhere.current, material: defaultMaterial(first, terms), surfaces: surface != null && allowsSurfaces(first, start.status) ? [surface] : [] });
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
          <h3>{`${String(tooth)} · ${toothName(tooth)}`}</h3>
          {mode === "view" ? <p className="tc-sub">{`${String(rows.length)} ${rows.length === 1 ? "entry" : "entries"}`}</p> : null}
        </div>
      </div>

      {mode === "view" ? (
        <>
          <HealthRow patientId={patientId} tooth={tooth} entries={entries} status={status} canWrite={canWrite} who={who} dictate={dictate} onDictateStarted={onDictateStarted} />
          {canWrite ? <DetailChips patientId={patientId} tooth={tooth} entries={entries} procedures={procedures} condition={condition} eruption={eruption} /> : null}
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
                  <span className="tc-tags">
                    {row.elsewhere === true ? <Tag>Done elsewhere</Tag> : null}
                    <Tag tone={statusTone(TONE[row.status])}>{row.status}</Tag>
                  </span>
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
          {!canWrite ? (
            <div className="tc-actions">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : visitId === undefined ? (
            <div className="tc-actions">
              {/* The visit bar at the top holds the one Start visit button. */}
              <p className="tc-meta" style={{ width: "100%" }}>
                Start the visit from the bar at the top to add treatment.
              </p>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <div className="tc-actions">
              <PillButton icon={<Plus aria-hidden="true" className="size-4" />} onClick={startAdd}>
                Add treatment
              </PillButton>
              <PillButton
                variant="ghost"
                icon={<Search aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setMode("finding");
                }}
              >
                Record a finding
              </PillButton>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </>
      ) : mode === "finding" && visitId !== undefined ? (
        <FindingForm patientId={patientId} tooth={tooth} visitId={visitId} surface={surface} onDone={back} onClose={onClose} />
      ) : (
        <TreatmentForm
          tooth={tooth}
          draft={draft}
          onChange={(next) => {
            elsewhere.current = next.elsewhere;
            setDraft(next);
          }}
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
