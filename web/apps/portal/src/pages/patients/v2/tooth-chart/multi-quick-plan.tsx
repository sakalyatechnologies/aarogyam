/**
 * Several teeth: long-press one tooth, tap the others, tap a chip once. The chip plans that treatment on every
 * selected tooth (the calls Quick plan makes for one tooth, once per tooth), with one Why row applied to all.
 */
import { useEffect, useRef, useState } from "react";

import { randomUuid, type ChartEntry, type DentalTerm, type PatientId, type PlanItem, type VisitId } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { useRecordChartEntries, useSetToothCondition, useSetToothEruption } from "../../../../queries.js";
import { useCreatePlan, useSetPlanItemStatus } from "../../../treatment-plans/queries.js";
import { findingEntries } from "../../../visits/record-finding-dialog.js";
import { blankDraft, buildPlan, defaultMaterial, treatmentOf, type TreatmentKey } from "./model.js";
import { REASONS, UNDO_MS, bump, chipsFor, kindOf, labelOf, planned, readCounts, type Reason } from "./quick-plan.js";

interface Props {
  patientId: PatientId;
  /** The selected teeth, in the order they were picked. */
  teeth: readonly number[];
  visitId: VisitId;
  terms: readonly DentalTerm[];
  planItems: readonly PlanItem[];
  /** The whole chart's current entries; each tooth's own are picked out here. */
  entries: readonly ChartEntry[];
}

const noun = (n: number) => `${String(n)} ${n === 1 ? "tooth" : "teeth"}`;

export function MultiQuickPlan({ patientId, teeth, visitId, terms, planItems, entries }: Props) {
  const toast = useToast();
  const createPlan = useCreatePlan(patientId);
  const setItem = useSetPlanItemStatus(patientId);
  const record = useRecordChartEntries(patientId);
  const setCondition = useSetToothCondition(patientId);
  const setEruption = useSetToothEruption(patientId);
  const [counts] = useState(readCounts);
  const [working, setWorking] = useState(false);
  const [last, setLast] = useState<{ key: TreatmentKey; items: readonly PlanItem[] } | undefined>(undefined);
  const [reasoned, setReasoned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timer.current); }, []);

  const kinds = teeth.map((t) => kindOf(t, entries.filter((e) => e.tooth === t)));
  const lists = kinds.map((k) => chipsFor(k, counts));
  // Only the treatments every selected tooth can have, in the first tooth's order.
  const keys = (lists[0] ?? []).filter((key) => lists.every((l) => l.includes(key)));
  const failed = (title: string) => { toast.show({ title, tone: "danger" }); };
  const isPlanned = (tooth: number, key: TreatmentKey) => planItems.some((i) => i.tooth === tooth && planned(i, key));

  const plan = async (key: TreatmentKey) => {
    const draft = { ...blankDraft(), tx: key, status: "Planned" as const, material: defaultMaterial(treatmentOf(key), terms) };
    const material = terms.find((t) => t.id === draft.material)?.label;
    const made: PlanItem[] = [];
    let missed = 0;
    setWorking(true);
    for (const [i, tooth] of teeth.entries()) {
      if (isPlanned(tooth, key)) continue;
      try {
        const saved = await createPlan.mutateAsync({ ...buildPlan(tooth, draft, material), visit_id: visitId });
        const item = saved.items.find((it) => it.tooth === tooth && it.status === "proposed" && planned(it, key) && !planItems.some((m) => m.id === it.id)) ?? saved.items[0];
        if (item !== undefined) made.push(item);
        bump(kinds[i] ?? "back", key);
      } catch {
        missed += 1;
      }
    }
    setWorking(false);
    if (missed > 0) failed(`Couldn't plan ${labelOf(key).toLowerCase()} on ${noun(missed)}. Please try again.`);
    if (made.length === 0) return;
    setReasoned(false);
    setLast({ key, items: made });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setLast(undefined); }, UNDO_MS);
  };

  const undo = async () => {
    if (last === undefined) return;
    setWorking(true);
    let missed = 0;
    for (const item of last.items) {
      try {
        await setItem.mutateAsync({ item, status: "cancelled" });
      } catch {
        missed += 1;
      }
    }
    setWorking(false);
    clearTimeout(timer.current);
    setLast(undefined);
    if (missed > 0) failed("Couldn't undo everything. Please try again.");
  };

  // One Why for all: the reasons every selected tooth offers.
  const reasonKey = last?.key;
  const reasons: readonly Reason[] =
    reasonKey === undefined || reasoned
      ? []
      : (REASONS[reasonKey]?.(teeth[0] ?? 0) ?? []).filter((r) => teeth.every((t) => REASONS[reasonKey]?.(t).some((x) => x.run === r.run) === true));

  const give = async (reason: Reason) => {
    setWorking(true);
    try {
      if (reason.run === "infection") await Promise.all(teeth.map((tooth) => setCondition.mutateAsync({ tooth, input: { infection: "infection" } })));
      else if (reason.run === "impacted") await Promise.all(teeth.map((tooth) => setEruption.mutateAsync({ tooth, input: { eruption: "impacted" } })));
      else {
        const finding = reason.run === "fractured" ? "fractured" : "caries";
        const depth = reason.run === "caries_near_pulp" ? "near_pulp" : undefined;
        await record.mutateAsync({ entries: findingEntries([...teeth], { finding, surfaces: [], depth }), visit_id: visitId, client_id: randomUuid() });
      }
      setReasoned(true);
    } catch {
      failed("Couldn't record the reason. Please try again.");
    }
    setWorking(false);
  };

  return (
    <div className="tc-details" aria-label="Quick plan for the selected teeth">
      {keys.length === 0 ? (
        <p className="tc-empty">These teeth have no treatment in common. Select teeth of the same kind.</p>
      ) : (
        <div className="tc-chip-row" role="group" aria-label={`Plan a treatment on ${noun(teeth.length)}`}>
          <span className="tc-chip-label">Plan</span>
          {keys.map((key) => {
            const all = teeth.every((t) => isPlanned(t, key));
            return (
              <button key={key} type="button" className="tc-chip" aria-pressed={all} disabled={working} onClick={() => { if (!all) void plan(key); }}>
                {all ? `✓ ${labelOf(key)}` : labelOf(key)}
              </button>
            );
          })}
        </div>
      )}
      <div role="status">
        {last === undefined ? null : (
          <div className="tc-chip-row">
            <span className="tc-chip-date">{`${labelOf(last.key)} planned on ${noun(last.items.length)}`}</span>
            <button type="button" className="tc-chip tc-chip-resolve" disabled={working} onClick={() => { void undo(); }}>
              Undo
            </button>
          </div>
        )}
      </div>
      {reasons.length === 0 ? null : (
        <div className="tc-chip-row" role="group" aria-label="Why">
          <span className="tc-chip-label">Why?</span>
          {reasons.map((r) => (
            <button key={r.label} type="button" className="tc-chip" disabled={working} onClick={() => { void give(r); }}>
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
