// Wisdom tooth (or any permanent tooth) position: erupted, partial, impacted or unerupted, at its
// recorded angle, next to its mesial neighbour (the 7 for an 8). Composed from both teeth's section
// art over a shared bone-and-gum backdrop.
import { shadeForAge, type Shade } from "./palette.js";
import { MM, SceneBuilder, anchorBoxes, apply, mul, rotateAbout, translate, viewSource } from "./scene.js";
import type { ArtLayer, Box, Scene, ShapeSet, StageSet, ToothArt } from "./types.js";

export type Eruption = "erupted" | "partial" | "impacted" | "unerupted";
export type Angulation = "vertical" | "mesioangular" | "distoangular" | "horizontal";

const BODY = ["dentin", "tubules", "enamel", "enamelSheen", "dej", "pulp", "vessels", "nerve", "toothEdge"];

export interface EruptionOptions {
  /** FDI of the drawn tooth (mirrors quadrants 2 and 3). */
  fdi?: number;
  shade?: Shade;
  age?: number;
  shapes?: ShapeSet;
}

/** Scene key for an eruption record, as used in art-map.json. */
export function eruptionKey(eruption: Eruption, angulation?: Angulation): string {
  return eruption === "erupted" ? "erupted" : `${eruption}_${angulation ?? "vertical"}`;
}

export function eruptionScene(tooth: ToothArt, neighbor: ToothArt | undefined, wisdom: StageSet, eruption: Eruption, angulation: Angulation | undefined, opts: EruptionOptions = {}): Scene {
  const bd = wisdom.backdrop;
  const shade = opts.shade ?? shadeForAge(opts.age, tooth.primary);
  const b = new SceneBuilder();
  const tex = tooth.views.section.layers.find((l) => l.n === "boneTexture")?.d ?? "";
  if (!bd) return b.build(tooth.views.section.box);
  b.add(bd.layers, { shade, gradients: bd.g, slots: { tex }, anchors: {}, clips: bd.clips });
  const crown = anchorBoxes(tooth.anchors.crown)[0] ?? [30, 30, 40, 50];
  const body = (art: ToothArt) => art.views.section.layers.filter((l) => BODY.includes(l.n));
  if (neighbor) {
    b.add(body(neighbor), viewSource(neighbor, "section", { shade, shapes: opts.shapes, prefix: "n-", group: translate(bd.neighborX, 0) }));
  }
  const drop = (bd.drop[eruption] ?? 0) * MM;
  const angle = eruption === "erupted" ? 0 : (bd.angle[angulation ?? "vertical"] ?? 0);
  const [cx, cy, cw, ch] = crown;
  const group = mul(translate(0, drop), rotateAbout(angle, cx + cw / 2, cy + ch));
  const extra: ArtLayer[] = [];
  if (eruption !== "erupted") extra.push({ n: "follicle", d: "@crown", s: "pdl", w: 2.2, o: 0.55 });
  b.add([...extra, ...body(tooth)], viewSource(tooth, "section", { shade, shapes: opts.shapes, prefix: "t-", group }));
  if (eruption === "partial") {
    // the gum flap (operculum) over the distal part of the crown, joined to the gum line
    const p0 = apply(group, cx, cy), p1 = apply(group, cx + cw, cy);
    const topY = Math.min(p0[1], p1[1]) - 1.2, gumY = 76, xe = p0[0] + (p1[0] - p0[0]) * 0.55;
    const flap = `M2 ${f(gumY + 6)}L2 ${f(gumY)}C${f(p0[0] - 3)} ${f(gumY - 2)} ${f(p0[0] - 2)} ${f(topY)} ${f(p0[0] + cw * 0.15)} ${f(topY)}C${f(xe - 5)} ${f(topY - 1)} ${f(xe)} ${f(topY + 1)} ${f(xe + 1)} ${f(topY + 4)}C${f(xe + 1)} ${f(topY + 7)} ${f(xe - 6)} ${f(topY + 6)} ${f(p0[0] + 4)} ${f(gumY + 6)}Z`;
    b.add([{ n: "flap", d: flap, f: "g:w_gum" }, { n: "flapEdge", d: flap, s: "gumCutDeep", w: 0.6, o: 0.5 }], { shade, gradients: bd.g, slots: {}, anchors: {}, clips: {} });
  }
  const top = Math.min(crown[1] - 10, 60);
  const box: Box = [0, top, bd.box[2], Math.min(196, bd.box[3]) - top];
  const mirrored = opts.fdi !== undefined && [2, 3].includes(Math.floor(opts.fdi / 10));
  const sx = mirrored ? -1 : 1, sy = tooth.arch === "upper" ? -1 : 1;
  if (sx === 1 && sy === 1) return b.build(box);
  const W = bd.box[2];
  return b.build([sx < 0 ? W - box[0] - box[2] : box[0], sy < 0 ? 200 - box[1] - box[3] : box[1], box[2], box[3]], [sx, 0, 0, sy, sx < 0 ? W : 0, sy < 0 ? 200 : 0]);
}
const f = (v: number) => String(Math.round(v * 10) / 10);
