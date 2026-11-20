// Lazy loading: one chunk per tooth type, per treatment model and per brushing band, so a page only
// downloads the art it shows (§1.12 size, §1.4 budget).
import type { BrushingArt, ShapeSet, StageSet, ToothArt, ToothType } from "./types.js";
import type { BrushingBand, StageModel } from "./stage-steps.js";

const TEETH: Record<ToothType, () => Promise<{ art: ToothArt }>> = {
  u1: () => import("./gen/teeth/u1.js"), u2: () => import("./gen/teeth/u2.js"), u3: () => import("./gen/teeth/u3.js"),
  u4: () => import("./gen/teeth/u4.js"), u5: () => import("./gen/teeth/u5.js"), u6: () => import("./gen/teeth/u6.js"),
  u7: () => import("./gen/teeth/u7.js"), u8: () => import("./gen/teeth/u8.js"),
  l1: () => import("./gen/teeth/l1.js"), l2: () => import("./gen/teeth/l2.js"), l3: () => import("./gen/teeth/l3.js"),
  l4: () => import("./gen/teeth/l4.js"), l5: () => import("./gen/teeth/l5.js"), l6: () => import("./gen/teeth/l6.js"),
  l7: () => import("./gen/teeth/l7.js"), l8: () => import("./gen/teeth/l8.js"),
  pu1: () => import("./gen/teeth/pu1.js"), pu2: () => import("./gen/teeth/pu2.js"), pu3: () => import("./gen/teeth/pu3.js"),
  pu4: () => import("./gen/teeth/pu4.js"), pu5: () => import("./gen/teeth/pu5.js"),
  pl1: () => import("./gen/teeth/pl1.js"), pl2: () => import("./gen/teeth/pl2.js"), pl3: () => import("./gen/teeth/pl3.js"),
  pl4: () => import("./gen/teeth/pl4.js"), pl5: () => import("./gen/teeth/pl5.js"),
};

const STAGES: Record<StageModel, () => Promise<{ stages: StageSet }>> = {
  root_canal: () => import("./gen/stages/root_canal.js"),
  filling: () => import("./gen/stages/filling.js"),
  extraction: () => import("./gen/stages/extraction.js"),
  wisdom_extraction: () => import("./gen/stages/wisdom_extraction.js"),
  crown: () => import("./gen/stages/crown.js"),
  scaling: () => import("./gen/stages/scaling.js"),
  implant: () => import("./gen/stages/implant.js"),
  sealant: () => import("./gen/stages/sealant.js"),
};

const BRUSHING: Record<BrushingBand, () => Promise<{ brushing: BrushingArt }>> = {
  general_under_6: () => import("./gen/brushing/general_under_6.js"),
  general_6_12: () => import("./gen/brushing/general_6_12.js"),
  general_teen: () => import("./gen/brushing/general_teen.js"),
  general_adult: () => import("./gen/brushing/general_adult.js"),
};

export async function loadToothArt(type: ToothType): Promise<ToothArt> {
  return (await TEETH[type]()).art;
}
export async function loadStageArt(model: StageModel): Promise<StageSet> {
  return (await STAGES[model]()).stages;
}
export async function loadBrushingArt(band: BrushingBand): Promise<BrushingArt> {
  return (await BRUSHING[band]()).brushing;
}
export async function loadShapes(): Promise<ShapeSet> {
  return (await import("./gen/shapes.js")).SHAPES;
}

/** FDI number -> tooth type, or undefined for an invalid number. */
export function toothTypeOf(fdi: number): ToothType | undefined {
  const q = Math.floor(fdi / 10), p = fdi % 10;
  const upper = q === 1 || q === 2 || q === 5 || q === 6;
  const primary = q >= 5 && q <= 8;
  if (q < 1 || q > 8 || p < 1 || p > (primary ? 5 : 8)) return undefined;
  const key = `${primary ? "p" : ""}${upper ? "u" : "l"}${String(p)}`;
  return isToothType(key) ? key : undefined;
}
function isToothType(k: string): k is ToothType {
  return k in TEETH;
}
/** The mesial neighbour drawn next to an erupting tooth (7 for an 8). */
export function neighborOf(fdi: number): number | undefined {
  const p = fdi % 10;
  return p > 1 ? fdi - 1 : undefined;
}
