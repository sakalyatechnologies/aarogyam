// Pictures for the usual options (audit item 2 + 9): an option's `look` ("overlay:..." / "scene:...", the keys the API
// already sends) drawn as a small picture of the tooth after that choice, and a before/after slider (now vs the choice).
// General guidance, never this patient's result. Lazy chunk: the art kit loads only when a choice is shown.
import { useEffect, useState, type ReactElement } from "react";

import { loadShapes, loadStageArt, loadToothArt, toothTypeOf } from "../mouth-art/loaders.js";
import { overlayPart, type Overlay } from "../mouth-art/overlays.js";
import { ArtSvg } from "../mouth-art/react.js";
import { stagePart, toothScene, type ScenePart } from "../mouth-art/scene.js";
import { STAGE_MODELS, STAGE_STEPS, type StageModel } from "../mouth-art/stage-steps.js";
import type { Scene, ViewName } from "../mouth-art/types.js";
import { overlaysFor, stageParams, type SnapTooth } from "../mouth-view/model.js";
import { CompareSlider } from "./compare-slider.js";

export type Look = { kind: "overlay"; overlay: Overlay } | { kind: "scene"; model: StageModel; step: string };

const PLAIN: readonly Overlay[] = [{ kind: "root_canal" }, { kind: "post_core" }, { kind: "core_build_up" }, { kind: "pulpotomy" }, { kind: "sealant" }, { kind: "fracture" }, { kind: "missing" },
  { kind: "bleeding" }, { kind: "crown" }, { kind: "veneer" }, { kind: "implant" }, { kind: "bridge_abutment" }, { kind: "bridge_pontic" }];
const isModel = (m: string): m is StageModel => STAGE_MODELS.some((x) => x === m);

/** An option's `look` key as art, or undefined for a key this art kit can't draw. Pure. */
export function parseLook(look: string): Look | undefined {
  const at = look.indexOf(":");
  if (at < 0) return undefined;
  const type = look.slice(0, at);
  const parts = look.slice(at + 1).split(".");
  if (type === "overlay") {
    const [kind = "", arg = ""] = parts;
    if (kind === "caries" && (arg === "enamel" || arg === "dentin" || arg === "near_pulp")) return { kind: "overlay", overlay: { kind: "caries", surface: "O", depth: arg } };
    const plain = PLAIN.find((o) => o.kind === kind);
    return plain === undefined ? undefined : { kind: "overlay", overlay: plain };
  }
  if (type === "scene") {
    const [model = "", step = ""] = parts;
    if (!isModel(model)) return undefined;
    const steps: readonly string[] = STAGE_STEPS[model];
    // "scene:extraction" is the end result; "scene:wisdom_extraction.position.*" is the step it names
    const end = model === "extraction" || model === "wisdom_extraction" ? "socket_healing" : (steps.at(-1) ?? "");
    return { kind: "scene", model, step: steps.includes(step) ? step : end };
  }
  return undefined;
}

/** What "now" looks like when the caller has no chart record: the situation's usual picture. */
const NOW_FALLBACK: Readonly<Record<string, Overlay[]>> = {
  deep_decay: [{ kind: "caries", surface: "O", depth: "near_pulp" }],
  infection: [{ kind: "caries", surface: "O", depth: "near_pulp" }, { kind: "infection", type: "abscess" }],
  missing: [{ kind: "missing" }],
};

export interface LookScenes { now: Scene; after: Scene }

function useLookScenes(tooth: number, look: string, situationKey: string, record: SnapTooth | undefined): LookScenes | undefined {
  const [out, setOut] = useState<{ key: string; scenes?: LookScenes } | undefined>(undefined);
  const key = `${String(tooth)}|${look}|${situationKey}|${record === undefined ? "" : `${record.finding ?? ""}${JSON.stringify(record.details ?? {})}${(record.surfaces ?? []).join("")}`}`;
  useEffect(() => {
    let live = true;
    const type = toothTypeOf(tooth), l = parseLook(look);
    if (type === undefined || l === undefined) return;
    void Promise.all([loadToothArt(type), loadShapes(), l.kind === "scene" ? loadStageArt(l.model) : Promise.resolve(undefined)]).then(([art, shapes, stages]) => {
      if (!live) return;
      const nowOv = record === undefined ? (NOW_FALLBACK[situationKey] ?? []) : overlaysFor(record);
      const stage = l.kind === "scene" ? stages?.scenes[l.step] : undefined;
      const view: ViewName = stage?.view ?? "section";
      const base: ScenePart = { add: [], ...(stage?.grow ? { grow: stage.grow } : {}) };
      const draw = (parts: ScenePart[]): Scene => toothScene(art, view, { fdi: tooth, shapes, parts: [base, ...parts] });
      const now = draw(nowOv.map((o) => overlayPart(art, view, o)));
      const params = { S: "O", D: "dentin", ...stageParams(record) };
      const after = l.kind === "overlay" ? draw([overlayPart(art, view, l.overlay)]) : stage === undefined ? undefined : draw([stagePart(stage, params)]);
      setOut(after === undefined ? { key } : { key, scenes: { now, after } });
    }, () => { if (live) setOut({ key }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return out?.key === key ? out.scenes : undefined;
}

interface ArtProps { tooth: number; look: string; situationKey: string; record?: SnapTooth | undefined; label: string }

/** The small picture on an option card: the tooth after this choice. Nothing when the key has no art. */
export function OptionPicture({ tooth, look, situationKey, record, label }: ArtProps): ReactElement | null {
  const s = useLookScenes(tooth, look, situationKey, record);
  if (s === undefined) return null;
  const [, , w, h] = s.after.box;
  return <div className="ps-opt-art" style={{ aspectRatio: `${w.toFixed(2)} / ${h.toFixed(2)}` }}><ArtSvg scene={s.after} label={label} /></div>;
}

/** The before/after slider for one choice: now on the left, opening at 15% so the difference shows at once. */
export function OptionCompare({ tooth, look, situationKey, record, label }: ArtProps): ReactElement | null {
  const s = useLookScenes(tooth, look, situationKey, record);
  if (s === undefined) return null;
  return <CompareSlider a={s.now} b={s.after} label={`Tooth ${String(tooth)}`} aWords="Now" bWords={label} initialPos={15} />;
}
