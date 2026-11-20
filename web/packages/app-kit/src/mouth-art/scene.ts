// Framework-free scene building: layers + overlays + stage scenes -> a resolved Scene that the SVG
// and canvas renderers draw identically.
import { paintColor, shadeForAge, type Shade } from "./palette.js";
import type {
  ArtLayer, ArtView, Box, GradientSpec, Matrix, ResolvedPaint, Scene, SceneLabel, SceneNode, ShapeSet, StageScene,
  ToothArt, ViewName,
} from "./types.js";

export const MM = 6.2;
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a ∘ b: apply b first, then a. */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export function rotateAbout(deg: number, cx: number, cy: number): Matrix {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return mul(translate(cx, cy), mul([c, s, -s, c, 0, 0], translate(-cx, -cy)));
}
export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
const isBoxList = (a: Box | Box[]): a is Box[] => Array.isArray(a[0]);
export function anchorBoxes(a: Box | Box[] | undefined): Box[] {
  if (!a) return [];
  return isBoxList(a) ? a : [a];
}

export interface LayerParams {
  /** Surface: M, O, D, B or L. */
  S?: string;
  /** Decay depth: enamel, dentin or near_pulp. */
  D?: string;
  /** Material paint (see materialPaint). */
  M?: string;
}

/** Hide base layers and insert added layers ("above" a named layer, else after the previous insert). */
export function composeLayers(base: ArtLayer[], hide: Iterable<string>, add: ArtLayer[]): ArtLayer[] {
  const hidden = new Set(hide);
  const out = hidden.has("*") ? [] : base.filter((l) => !hidden.has(l.n));
  const lastAfter = new Map<string, number>();
  let prev = -1;
  let prevAnchor: string | undefined;
  for (const l of add) {
    let at = out.length;
    let anchor: string | undefined;
    if (l.above !== undefined) {
      const i = out.findIndex((x) => x.n === l.above);
      if (i >= 0) { at = (lastAfter.get(l.above) ?? i) + 1; anchor = l.above; }
    } else if (prev >= 0) {
      at = prev + 1;
      anchor = prevAnchor;
    }
    for (const [k, v] of lastAfter) if (v >= at) lastAfter.set(k, v + 1);
    out.splice(at, 0, l);
    if (anchor !== undefined) lastAfter.set(anchor, at);
    prev = at;
    prevAnchor = anchor;
  }
  return out;
}

export interface ResolveSource {
  shade: Shade;
  gradients: GradientSpec[];
  slots: Record<string, string>;
  anchors: Record<string, Box | Box[]>;
  clips: Record<string, string>;
  shapes?: ShapeSet | undefined;
  params?: LayerParams | undefined;
  /** Id prefix keeping clips and gradients unique when several pieces share a scene. */
  prefix?: string | undefined;
  group?: Matrix | undefined;
}

/** Collects resolved nodes, gradients and clips. */
export class SceneBuilder {
  readonly nodes: SceneNode[] = [];
  readonly labels: SceneLabel[] = [];
  readonly notes: string[] = [];
  private readonly grads = new Map<string, Scene["gradients"][number]>();
  private readonly clipMap: Scene["clips"] = {};

  add(layers: ArtLayer[], src: ResolveSource, mark?: ReadonlySet<string>): void {
    const gmap = new Map<string, GradientSpec>();
    for (const g of [...(src.shapes?.g ?? []), ...src.gradients]) gmap.set(g.id, g);
    const p = src.prefix ?? "";
    const sub = (v: string) => v.replace("{S}", src.params?.S ?? "O").replace("{D}", src.params?.D ?? "dentin").replace("{M}", src.params?.M ?? "composite");
    const resolveD = (d: string): string | undefined => {
      if (d.startsWith("@")) return src.slots[d.slice(1)];
      if (d.startsWith("#")) return src.shapes?.d[d.slice(1)];
      return d;
    };
    const paint = (name: string | undefined, rawOpacity = 1): ResolvedPaint | undefined => {
      if (name === undefined) return undefined;
      const n = sub(name);
      if (n.startsWith("g:")) {
        const spec = gmap.get(n.slice(2));
        if (!spec) return undefined;
        const id = p + spec.id;
        if (!this.grads.has(id)) {
          this.grads.set(id, { id, spec, colors: spec.s.map(([, c, a]) => paintColor(c, src.shade, a ?? 1)) });
        }
        return { gradient: id };
      }
      return { color: paintColor(n, src.shade, rawOpacity) };
    };
    for (const layer of layers) {
      const d = resolveD(sub(layer.d));
      if (d === undefined || d === "") continue;
      const fill = paint(layer.f);
      const stroke = paint(layer.s);
      if (!fill && !stroke) continue;
      let clip: string | undefined;
      if (layer.c !== undefined) {
        const cd = src.clips[layer.c];
        const resolved = cd === undefined ? undefined : resolveD(cd);
        if (resolved !== undefined) {
          clip = p + "c_" + layer.c;
          this.clipMap[clip] = src.group ? { d: resolved, group: src.group } : { d: resolved };
        }
      }
      const mats: (Matrix | undefined)[] = [];
      if (layer.at !== undefined) {
        const boxes = anchorBoxes(src.anchors[layer.at]);
        if (boxes.length === 0) continue;
        for (const [x, y, w, h] of boxes) mats.push([w / 100, 0, 0, h / 100, x, y]);
      } else {
        mats.push(undefined);
      }
      for (let m of mats) {
        if (layer.tr) m = m ? mul(m, layer.tr) : layer.tr;
        if (layer.mv) {
          const [x, y, w, h] = anchorBoxes(src.anchors.crown)[0] ?? [40, 40, 20, 20];
          const cx = x + w / 2, cy = y + h / 2;
          const mv = mul(translate(layer.mv[0] * MM, layer.mv[1] * MM), rotateAbout(layer.mv[2], cx, cy));
          m = m ? mul(mv, m) : mv;
        }
        const node: SceneNode = { d };
        if (fill) node.fill = fill;
        if (stroke) { node.stroke = stroke; node.width = layer.w ?? 1; }
        if (layer.o !== undefined && layer.o !== 1) node.opacity = layer.o;
        if (layer.dash) node.dash = layer.dash;
        if (layer.rule) node.rule = layer.rule;
        if (clip !== undefined) node.clip = clip;
        if (src.group) node.group = src.group;
        if (m) node.m = m;
        if (mark?.has(layer.n) === true) node.n = layer.n;
        this.nodes.push(node);
      }
    }
  }

  build(box: Box, outer?: Matrix): Scene {
    const scene: Scene = { box, gradients: [...this.grads.values()], clips: this.clipMap, nodes: this.nodes, labels: this.labels, notes: [...new Set(this.notes)] };
    if (outer) scene.outer = outer;
    return scene;
  }
}

/** FDI quadrant helpers: quadrants 2, 3, 6 and 7 are drawn mirrored. */
export function isMirrored(fdi: number | undefined): boolean {
  if (fdi === undefined) return false;
  return [2, 3, 6, 7].includes(Math.floor(fdi / 10));
}

/** Whole-scene transform and final viewBox for a tooth view. */
export function placement(art: ToothArt, box: Box, fdi: number | undefined): { outer: Matrix | undefined; box: Box } {
  const sx = isMirrored(fdi) ? -1 : 1, sy = art.arch === "upper" ? -1 : 1;
  if (sx === 1 && sy === 1) return { outer: undefined, box };
  const [x, y, w, h] = box;
  return {
    outer: [sx, 0, 0, sy, sx < 0 ? 100 : 0, sy < 0 ? 200 : 0],
    box: [sx < 0 ? 100 - x - w : x, sy < 0 ? 200 - y - h : y, w, h],
  };
}

export function viewSource(art: ToothArt, view: ViewName, extra: { shade: Shade; shapes?: ShapeSet | undefined; params?: LayerParams | undefined; texture?: string; prefix?: string; group?: Matrix }): ResolveSource {
  const v: ArtView = art.views[view];
  const tooth = view !== "top";
  const slots: Record<string, string> = { ...(tooth ? art.geo : {}), ...(v.slots ?? {}) };
  if (extra.texture !== undefined) slots.tex = extra.texture;
  return {
    shade: extra.shade,
    gradients: [...v.g, ...(tooth ? art.mat : (v.mat ?? []))],
    slots,
    anchors: { ...(tooth ? art.anchors : {}), ...(v.anchors ?? {}) },
    clips: v.clips,
    shapes: extra.shapes,
    params: extra.params,
    prefix: extra.prefix,
    group: extra.group,
  };
}

export interface ToothSceneOptions {
  /** FDI number: picks mirroring for the left side. */
  fdi?: number;
  shade?: Shade;
  age?: number;
  shapes?: ShapeSet;
  /** Extra hide/add, e.g. from overlays or a stage scene. */
  parts?: ScenePart[];
  params?: LayerParams;
  /** Layer names to keep on their nodes (`data-n` in ArtSvg), e.g. callout anchors. */
  mark?: readonly string[];
}

export interface ScenePart {
  /** Extra room in mm beyond the crown. */
  grow?: number;
  hide?: string[];
  add: ArtLayer[];
  params?: LayerParams;
  labels?: SceneLabel[];
  notes?: string[];
}

/** A stage scene as a part. */
export function stagePart(scene: StageScene, params?: LayerParams): ScenePart {
  return { hide: scene.hide ?? [], add: scene.add, ...(params ? { params } : {}), ...(scene.grow ? { grow: scene.grow } : {}) };
}

/** Builds a tooth view with optional parts (overlays, a stage) into a Scene. */
export function toothScene(art: ToothArt, view: ViewName, opts: ToothSceneOptions = {}): Scene {
  const shade = opts.shade ?? shadeForAge(opts.age, art.primary);
  const parts = opts.parts ?? [];
  const v = art.views[view];
  const hide = parts.flatMap((p) => p.hide ?? []);
  const add = parts.flatMap((p) => p.add.map((l) => (p.params ? { ...l, ...substitute(l, p.params) } : l)));
  const layers = composeLayers(v.layers, hide, add);
  const b = new SceneBuilder();
  b.add(layers, viewSource(art, view, { shade, shapes: opts.shapes, params: opts.params }), opts.mark === undefined ? undefined : new Set(opts.mark));
  const grow = Math.max(0, ...parts.map((p) => p.grow ?? 0)) * MM;
  const vb: Box = grow ? [v.box[0], v.box[1] - grow, v.box[2], v.box[3] + grow] : v.box;
  const { outer, box } = placement(art, vb, opts.fdi);
  for (const p of parts) {
    for (const l of p.labels ?? []) {
      const [x, y] = outer ? apply(outer, l.x, l.y) : [l.x, l.y];
      const flipX = outer !== undefined && outer[0] < 0;
      const anchor = flipX && l.anchor === "start" ? "end" : flipX && l.anchor === "end" ? "start" : l.anchor;
      b.labels.push(anchor === undefined ? { text: l.text, x, y } : { text: l.text, x, y, anchor });
    }
    b.notes.push(...(p.notes ?? []));
  }
  return b.build(box, outer);
}

function substitute(l: ArtLayer, p: LayerParams): Partial<ArtLayer> {
  const s = (v: string) => v.replace("{S}", p.S ?? "{S}").replace("{D}", p.D ?? "{D}").replace("{M}", p.M ?? "{M}");
  const out: Partial<ArtLayer> = { d: s(l.d) };
  if (l.f !== undefined) out.f = s(l.f);
  if (l.s !== undefined) out.s = s(l.s);
  return out;
}
