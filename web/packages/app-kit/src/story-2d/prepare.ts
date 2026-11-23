// Loads the art a story needs (the same lazy chunks the mouth view uses) and builds every scene
// once, so drawing a frame is pure and cheap.
import type { VisitStory } from "@aarogyam/api-client";

import { archLayout, type ArchSlot } from "../mouth-art/arch.js";
import { loadShapes, loadStageArt, loadToothArt, toothTypeOf } from "../mouth-art/loaders.js";
import { overlayPart } from "../mouth-art/overlays.js";
import { stagePart, toothScene } from "../mouth-art/scene.js";
import { sceneArt, type StageModel } from "../mouth-art/stage-steps.js";
import type { Scene, ShapeSet, StageSet, ToothArt, ToothType, ViewName } from "../mouth-art/types.js";
import { detailOverlays, overlaysFor, stageParams, toothInfo, type PositionState } from "../mouth-view/model.js";
import { storyboard, storyFacts, type Segment, type StoryFacts } from "./storyboard.js";

/** One arch position in layout units (the mouth view's 360-wide arch). */
export interface ArchTooth { s: PositionState; slot: ArchSlot; nx: number; ny: number; r: number; scene: Scene | undefined }

export interface PreparedStory {
  story: VisitStory;
  facts: StoryFacts;
  board: Segment[];
  /** ms. */
  duration: number;
  arch: { teeth: ArchTooth[]; width: number; minY: number; maxY: number; midY: number };
  /** The stepper's picture per step index. */
  steps: Scene[];
  /** The view each step is drawn in. */
  stepViews: ViewName[];
  /** The walked tooth's plain picture (title card and the zoom's landing). */
  hero: Scene | undefined;
}

export interface PrepareOptions {
  loadTooth?: (t: ToothType) => Promise<ToothArt>;
  loadStage?: (m: StageModel) => Promise<StageSet>;
  loadShapes?: () => Promise<ShapeSet>;
}

export const ARCH_W = 360;

export async function prepareStory(story: VisitStory, opts: PrepareOptions = {}): Promise<PreparedStory> {
  const facts = storyFacts(story);
  const board = storyboard(facts);
  const all = [...facts.states.upper, ...facts.states.lower];
  const focus = facts.focus;

  const types = new Set<ToothType>();
  for (const s of all) {
    const t = toothTypeOf(s.fdi);
    if (t !== undefined && s.shown !== "not_recorded") types.add(t);
  }
  const focusType = focus === undefined ? undefined : toothTypeOf(focus.fdi);
  if (focusType !== undefined) types.add(focusType);
  const models = new Set<StageModel>();
  for (const step of focus?.treatment.steps ?? []) {
    const art = sceneArt(step.scene);
    if (art !== undefined) models.add(art.model);
  }
  const tooth = opts.loadTooth ?? loadToothArt;
  const stage = opts.loadStage ?? loadStageArt;
  const [shapes, teethArt, stageArt] = await Promise.all([
    (opts.loadShapes ?? loadShapes)(),
    Promise.all([...types].map(async (t) => [t, await tooth(t)] as const)),
    Promise.all([...models].map(async (m) => [m, await stage(m)] as const)),
  ]);
  const artOf = new Map<ToothType, ToothArt>(teethArt);
  const stageOf = new Map<StageModel, StageSet>(stageArt);

  // the overview arch, as in the mouth view
  const lay = archLayout(all.map((s) => s.fdi), { width: ARCH_W, between: 44, gapMm: 0.9, depth: 1.02 });
  const bySlot = new Map(lay.slots.map((s) => [s.fdi, s]));
  const upperY = Math.max(...lay.slots.filter((s) => toothInfo(s.fdi).upper).map((s) => s.y), 0);
  const lowerY = Math.min(...lay.slots.filter((s) => !toothInfo(s.fdi).upper).map((s) => s.y), lay.height);
  const teeth: ArchTooth[] = [];
  for (const s of all) {
    const slot = bySlot.get(s.fdi);
    if (slot === undefined) continue;
    const cy = s.arch === "upper" ? upperY + 14 : lowerY - 14;
    const dx = slot.x - ARCH_W / 2, dy = slot.y - cy, len = Math.hypot(dx, dy) || 1;
    const art = s.shown === "not_recorded" ? undefined : artOf.get(slot.type);
    const scene = art === undefined ? undefined : toothScene(art, "top", { fdi: s.fdi, shapes, parts: overlaysFor(s.tooth, false).map((o) => overlayPart(art, "top", o)) });
    teeth.push({ s, slot, nx: dx / len, ny: dy / len, r: Math.max(slot.w, slot.h) / 2, scene });
  }
  const ys = teeth.map((p) => p.slot.y);
  const upMax = Math.max(...teeth.filter((p) => p.s.arch === "upper").map((p) => p.slot.y + p.slot.h / 2), 0);
  const loMin = Math.min(...teeth.filter((p) => p.s.arch === "lower").map((p) => p.slot.y - p.slot.h / 2), lay.height);

  // the stepper's pictures: each step's stage scene, or the tooth as charted
  const steps: Scene[] = [];
  const stepViews: ViewName[] = [];
  let hero: Scene | undefined;
  const fArt = focusType === undefined ? undefined : artOf.get(focusType);
  if (focus !== undefined && fArt !== undefined) {
    const t = focus.tooth;
    const params = stageParams(t);
    const back = toothInfo(focus.fdi).pos >= 4;
    const plainView: ViewName = back ? "top" : "front";
    const plain = (view: ViewName) => toothScene(fArt, view, { fdi: focus.fdi, shapes, parts: overlaysFor(t).map((o) => overlayPart(fArt, view, o)) });
    hero = toothScene(fArt, "front", { fdi: focus.fdi, shapes });
    let last: Scene | undefined;
    for (const step of focus.treatment.steps) {
      const art = sceneArt(step.scene);
      const st = art === undefined ? undefined : stageOf.get(art.model)?.scenes[art.step];
      let scene: Scene;
      let view: ViewName = stepViews[stepViews.length - 1] ?? plainView;
      if (st !== undefined) {
        view = st.view;
        const extra = detailOverlays(t).map((o) => overlayPart(fArt, st.view, o));
        scene = toothScene(fArt, st.view, { fdi: focus.fdi, shapes, parts: [stagePart(st, params), ...extra] });
      } else {
        scene = last ?? plain(plainView);
      }
      steps.push(scene);
      stepViews.push(view);
      last = scene;
    }
  }
  return {
    story, facts, board,
    duration: board[board.length - 1]?.end ?? 0,
    arch: { teeth, width: ARCH_W, minY: Math.min(...ys, 0) - 30, maxY: Math.max(...ys, lay.height) + 30, midY: (upMax + loMin) / 2 },
    steps, stepViews, hero,
  };
}
