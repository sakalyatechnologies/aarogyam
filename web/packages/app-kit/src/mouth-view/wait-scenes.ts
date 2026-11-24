// The pictures of "If you wait" (DT4), shared by the tooth detail and Show patient: one scene per frame.
import { overlayPart, viewsForSurface } from "../mouth-art/overlays.js";
import { anchorBoxes, apply, toothScene } from "../mouth-art/scene.js";
import type { Scene, ShapeSet, ToothArt, ViewName } from "../mouth-art/types.js";
import type { ifWaitFrames } from "./model.js";

/** Zooms a section scene to the crown and the top of the root, where decay grows. */
function crownCrop(sc: Scene, art: ToothArt, view: ViewName): Scene {
  const c = anchorBoxes(art.anchors["crown"])[0];
  if (view !== "section" || c === undefined) return sc;
  const [x, y, w, h] = c;
  const pad = w * 0.12;
  const m = sc.outer ?? [1, 0, 0, 1, 0, 0];
  const [ax, ay] = apply(m, x - pad, y), [bx, by] = apply(m, x + w + pad, y + h);
  const top = Math.min(ay, by), bottom = Math.max(ay, by);
  // the root lies towards the middle of the full picture
  const down = (top + bottom) / 2 < sc.box[1] + sc.box[3] / 2;
  const y0 = down ? top - h * 0.25 : top - h * 0.9, y1 = down ? bottom + h * 0.9 : bottom + h * 0.25;
  return { ...sc, box: [Math.min(ax, bx), y0, Math.abs(ax - bx), y1 - y0] };
}

/** One scene per frame: the decay cropped to the crown, the infection frame whole. */
export function waitScenes(wait: NonNullable<ReturnType<typeof ifWaitFrames>>, art: ToothArt, shapes: ShapeSet, fdi: number): Scene[] {
  const view: ViewName = viewsForSurface(wait.surface)[0] ?? "section";
  return wait.frames.map((f) => {
    const sc = toothScene(art, view, { fdi, shapes, parts: f.overlays.map((o) => overlayPart(art, view, o)) });
    return f.overlays.some((o) => o.kind === "infection") ? sc : crownCrop(sc, art, view);
  });
}
