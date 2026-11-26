/**
 * "Go with this" at work: cancels the old suggestion's proposed item, plans the chosen option, and shows Undo for 6 seconds.
 * Loaded only when the doctor taps it. The plan and mouth queries refresh on each change, so the patient's view updates in place.
 */
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { DentalTerm, PatientId, PlanItem, PresentStudio, VisitId } from "@aarogyam/api-client";
import type { ChooseTarget } from "@aarogyam/app-kit/present";
import { useToast } from "@sakalya/ui";

import { useCreatePlan, useSetPlanItemStatus } from "../../treatment-plans/queries.js";
import { chooseOption, undoChoice, type Chosen, type Ctx } from "./choose-plan.js";

const UNDO_MS = 6000;

interface Props {
  patientId: PatientId;
  visitId: VisitId;
  studio: PresentStudio | undefined;
  planItems: readonly PlanItem[];
  terms: readonly DentalTerm[];
  chosen: { target: ChooseTarget };
  onDone: () => void;
}

export function ChooseHost({ patientId, visitId, studio, planItems, terms, chosen, onDone }: Props) {
  const createPlan = useCreatePlan(patientId);
  const setItem = useSetPlanItemStatus(patientId);
  const toast = useToast();
  const [undo, setUndo] = useState<({ tooth: number } & Chosen) | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handled = useRef<object | undefined>(undefined);
  const ctx = (): Ctx => ({
    create: (input) => createPlan.mutateAsync(input),
    cancel: (item) => setItem.mutateAsync({ item, status: "cancelled" }),
    visitId, terms, planItems,
  });
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  const start = useEffectEvent(async (target: ChooseTarget) => {
    const { tooth, situation, option } = target;
    try {
      const done = await chooseOption(ctx(), studio, tooth, situation, option);
      if (done === undefined) throw new Error("no item");
      setUndo({ tooth, ...done });
      clearTimeout(timer.current);
      timer.current = setTimeout(onDone, UNDO_MS);
    } catch {
      toast.show({ title: `Couldn't change the plan for tooth ${String(tooth)}. Please try again.`, tone: "danger" });
      onDone();
    }
  });
  useEffect(() => {
    if (handled.current === chosen) return;
    handled.current = chosen;
    void start(chosen.target);
  }, [chosen]);

  if (undo === undefined) return null;
  const run = () => {
    const { tooth, ...rest } = undo;
    clearTimeout(timer.current);
    void undoChoice(ctx(), tooth, rest).catch(() => { toast.show({ title: "Couldn't undo that. Please try again.", tone: "danger" }); }).finally(onDone);
  };
  return (
    <div className="pm-undo" role="status">
      <span>{`Tooth ${String(undo.tooth)}: ${undo.label} planned`}</span>
      <button type="button" className="pm-chip" onClick={run}>Undo</button>
    </div>
  );
}
