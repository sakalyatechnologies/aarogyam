// "Go with this": the plan changes, loaded only when the doctor taps it (it pulls in the chart's treatment model).
import type { DentalTerm, NewPlan, PlanItem, Plan, PresentStudio, VisitId } from "@aarogyam/api-client";

import { blankDraft, buildPlan, defaultMaterial, treatmentOf, type TreatmentKey } from "../../patients/v2/tooth-chart/model.js";
import { planned } from "../../patients/v2/tooth-chart/quick-plan.js";
import { OPTION_TREATMENTS, singleTreatment } from "./option-map.js";

export interface Ctx {
  create: (input: NewPlan) => Promise<Plan>;
  cancel: (item: PlanItem) => Promise<unknown>;
  visitId: VisitId;
  terms: readonly DentalTerm[];
  planItems: readonly PlanItem[];
}
export interface Chosen { made: PlanItem; old: readonly PlanItem[]; label: string }

async function plan(ctx: Ctx, tooth: number, key: TreatmentKey): Promise<PlanItem | undefined> {
  const draft = { ...blankDraft(), tx: key, status: "Planned" as const, material: defaultMaterial(treatmentOf(key), ctx.terms) };
  const material = ctx.terms.find((t) => t.id === draft.material)?.label;
  const saved = await ctx.create({ ...buildPlan(tooth, draft, material), visit_id: ctx.visitId });
  const before = new Set(ctx.planItems.map((i) => i.id));
  return saved.items.find((i) => i.tooth === tooth && i.status === "proposed" && planned(i, key) && !before.has(i.id)) ?? saved.items[0];
}

/** Cancels the proposed item(s) of the old suggestion on the tooth, then plans the chosen option the way a Quick plan chip does. */
export async function chooseOption(ctx: Ctx, studio: PresentStudio | undefined, tooth: number, situation: string, option: string): Promise<Chosen | undefined> {
  const key = singleTreatment(option);
  if (key === undefined) return undefined;
  const suggested = studio?.situations.find((s) => s.tooth === tooth && s.key === situation)?.options.find((o) => o.suggested === true);
  const oldKeys = suggested === undefined ? [] : (OPTION_TREATMENTS[suggested.key] ?? []);
  const old = ctx.planItems.filter((i) => i.tooth === tooth && i.status === "proposed" && oldKeys.some((k) => planned(i, k)));
  for (const item of old) await ctx.cancel(item);
  const made = await plan(ctx, tooth, key);
  return made === undefined ? undefined : { made, old, label: treatmentOf(key).label };
}

/** Cancels what was just planned and plans the old suggestion again. */
export async function undoChoice(ctx: Ctx, tooth: number, chosen: Chosen): Promise<void> {
  await ctx.cancel(chosen.made);
  for (const item of chosen.old) {
    const key = Object.values(OPTION_TREATMENTS).flat().find((k) => planned({ ...item, status: "proposed" }, k));
    if (key !== undefined) await plan(ctx, tooth, key);
  }
}
