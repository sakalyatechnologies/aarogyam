/**
 * Quick plan: one tap on a treatment chip plans it on the tooth (Planned, in the open visit), then one optional tap says why.
 * "More…" opens the full treatment form. Nothing is guessed: a reason is recorded only when the doctor taps it.
 */
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { randomUuid, type ChartEntry, type DentalTerm, type PatientId, type PlanItem, type VisitId } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { useRecordChartEntries, useSetToothCondition, useSetToothEruption } from "../../../../queries.js";
import { useCreatePlan, useSetPlanItemStatus } from "../../../treatment-plans/queries.js";
import { findingEntries } from "../../../visits/record-finding-dialog.js";
import { TREATMENTS, blankDraft, buildPlan, defaultMaterial, treatmentOf, type TreatmentKey } from "./model.js";

type Kind = "back" | "front" | "missing";

const ORDER: Readonly<Record<Kind, readonly TreatmentKey[]>> = {
  back: ["root_canal", "crown", "filling", "extraction", "scaling"],
  front: ["filling", "crown", "root_canal", "extraction"],
  missing: ["implant", "bridge"],
};
/** Words on the chip: Cleaning is the seeded Scaling. */
const LABEL: Partial<Record<TreatmentKey, string>> = { scaling: "Cleaning" };
const UNDO_MS = 6000;
const STORE = "aarogyam.quick-plan.v1";

const COUNTS = z.record(z.string(), z.record(z.string(), z.number()));
type Counts = Partial<Record<string, Partial<Record<string, number>>>>;

function readCounts(): Counts {
  try {
    const raw = window.localStorage.getItem(STORE);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    const checked = COUNTS.safeParse(parsed);
    return checked.success ? checked.data : {};
  } catch {
    return {};
  }
}
function bump(kind: Kind, key: TreatmentKey): void {
  try {
    const all = readCounts();
    const mine = { ...all[kind] };
    mine[key] = (mine[key] ?? 0) + 1;
    window.localStorage.setItem(STORE, JSON.stringify({ ...all, [kind]: mine }));
  } catch {
    /* private window or blocked storage: the default order stays */
  }
}

/** Back teeth (premolars and molars), front teeth, or a missing tooth. */
export function kindOf(tooth: number, entries: readonly ChartEntry[]): Kind {
  if (entries.some((e) => e.finding === "missing")) return "missing";
  const place = tooth % 10;
  return place <= 3 ? "front" : "back";
}

/** The chips for a tooth: the doctor's most used first, the default order breaking ties. */
export function chipsFor(kind: Kind, counts: Counts = readCounts()): readonly TreatmentKey[] {
  const base = ORDER[kind];
  const mine = counts[kind] ?? {};
  return [...base].sort((a, b) => (mine[b] ?? 0) - (mine[a] ?? 0) || base.indexOf(a) - base.indexOf(b));
}

type Reason = { label: string; run: "caries_near_pulp" | "caries" | "fractured" | "infection" | "impacted" };
const REASONS: Partial<Record<TreatmentKey, (tooth: number) => readonly Reason[]>> = {
  root_canal: () => [
    { label: "Decay near the nerve", run: "caries_near_pulp" },
    { label: "Infection", run: "infection" },
    { label: "Broken", run: "fractured" },
  ],
  extraction: (tooth) => [
    { label: "Decay too deep", run: "caries_near_pulp" },
    { label: "Infection", run: "infection" },
    ...(tooth % 10 === 8 ? [{ label: "Wisdom tooth stuck", run: "impacted" } satisfies Reason] : []),
  ],
  filling: () => [
    { label: "Decay", run: "caries" },
    { label: "Broken", run: "fractured" },
  ],
  crown: () => [{ label: "Broken", run: "fractured" }],
};

const labelOf = (key: TreatmentKey) => LABEL[key] ?? treatmentOf(key).label;
const planned = (item: PlanItem, key: TreatmentKey) => (item.status === "proposed" || item.status === "accepted") && item.name.toLowerCase().startsWith(treatmentOf(key).label.toLowerCase());

interface Props {
  patientId: PatientId;
  tooth: number;
  visitId: VisitId;
  terms: readonly DentalTerm[];
  planItems: readonly PlanItem[];
  entries: readonly ChartEntry[];
  /** Open the full treatment form ("More…"). */
  onMore: () => void;
}

export function QuickPlan({ patientId, tooth, visitId, terms, planItems, entries, onMore }: Props) {
  const toast = useToast();
  const createPlan = useCreatePlan(patientId);
  const setItem = useSetPlanItemStatus(patientId);
  const record = useRecordChartEntries(patientId);
  const setCondition = useSetToothCondition(patientId);
  const setEruption = useSetToothEruption(patientId);
  const kind = kindOf(tooth, entries);
  const [counts] = useState(readCounts);
  const keys = chipsFor(kind, counts);
  const mine = planItems.filter((i) => i.tooth === tooth);
  // The row that was just saved; Undo works for a few seconds.
  const [last, setLast] = useState<{ key: TreatmentKey; item: PlanItem } | undefined>(undefined);
  const [undoable, setUndoable] = useState(false);
  const [reasoned, setReasoned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  const busy = createPlan.isPending || setItem.isPending;
  const failed = (title: string) => { toast.show({ title, tone: "danger" }); };

  const plan = (key: TreatmentKey) => {
    const draft = { ...blankDraft(), tx: key, status: "Planned" as const, material: defaultMaterial(treatmentOf(key), terms) };
    const material = terms.find((t) => t.id === draft.material)?.label;
    createPlan.mutate(
      { ...buildPlan(tooth, draft, material), visit_id: visitId },
      {
        onSuccess: (saved) => {
          bump(kind, key);
          const item = saved.items.find((i) => i.tooth === tooth && i.status === "proposed" && planned(i, key) && !mine.some((m) => m.id === i.id)) ?? saved.items[0];
          setReasoned(false);
          if (item !== undefined) setLast({ key, item });
          setUndoable(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => { setUndoable(false); }, UNDO_MS);
        },
        onError: () => { failed(`Couldn't plan ${labelOf(key).toLowerCase()} on tooth ${String(tooth)}. Please try again.`); },
      },
    );
  };
  const undo = () => {
    if (last === undefined) return;
    setItem.mutate(
      { item: last.item, status: "cancelled" },
      {
        onSuccess: () => { clearTimeout(timer.current); setUndoable(false); setLast(undefined); },
        onError: () => { failed("Couldn't undo that. Please try again."); },
      },
    );
  };

  const hasFinding = entries.some((e) => e.finding !== "sound");
  // The reason row: right after a chip is saved, or on a tooth with a planned treatment and no finding yet.
  const reasonKey = last?.key ?? TREATMENTS.map((t) => t.key).find((k) => mine.some((i) => planned(i, k)));
  const reasons = reasonKey === undefined || reasoned || (last === undefined && hasFinding) ? [] : (REASONS[reasonKey]?.(tooth) ?? []);

  const give = (reason: Reason) => {
    const done = () => { setReasoned(true); };
    const oops = () => { failed("Couldn't record the reason. Please try again."); };
    if (reason.run === "infection") setCondition.mutate({ tooth, input: { infection: "infection" } }, { onSuccess: done, onError: oops });
    else if (reason.run === "impacted") setEruption.mutate({ tooth, input: { eruption: "impacted" } }, { onSuccess: done, onError: oops });
    else {
      const finding = reason.run === "fractured" ? "fractured" : "caries";
      const depth = reason.run === "caries_near_pulp" ? "near_pulp" : undefined;
      record.mutate({ entries: findingEntries([tooth], { finding, surfaces: [], depth }), visit_id: visitId, client_id: randomUuid() }, { onSuccess: done, onError: oops });
    }
  };

  return (
    <div className="tc-details" aria-label="Quick plan">
      <div className="tc-chip-row" role="group" aria-label="Plan a treatment">
        <span className="tc-chip-label">Plan</span>
        {keys.map((key) => {
          const on = mine.some((i) => planned(i, key));
          return (
            <button
              key={key}
              type="button"
              className="tc-chip"
              aria-pressed={on}
              disabled={busy}
              onClick={() => {
                if (!on) plan(key);
              }}
            >
              {on ? `✓ ${labelOf(key)}` : labelOf(key)}
            </button>
          );
        })}
        <button type="button" className="tc-chip tc-chip-more" onClick={onMore}>
          More…
        </button>
      </div>
      {undoable && last !== undefined ? (
        <div className="tc-chip-row" role="status">
          <span className="tc-chip-date">{`Tooth ${String(tooth)}: ${labelOf(last.key)} planned`}</span>
          <button type="button" className="tc-chip tc-chip-resolve" disabled={busy} onClick={undo}>
            Undo
          </button>
        </div>
      ) : null}
      {reasons.length === 0 ? null : (
        <div className="tc-chip-row" role="group" aria-label="Why">
          <span className="tc-chip-label">Why?</span>
          {reasons.map((r) => (
            <button key={r.label} type="button" className="tc-chip" disabled={record.isPending || setCondition.isPending || setEruption.isPending} onClick={() => { give(r); }}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
