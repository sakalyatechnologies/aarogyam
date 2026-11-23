// The 3D smile style (present-studio-design §6.4, Beta). Enamel shells are baked per tooth type by
// scripts/bake-smile-meshes.mjs; three.js comes from the npm dependency. Only anatomy is baked: decay, fillings
// and crowns are painted at runtime into a per-tooth vertex-colour pass from the recorded overlays. Teeth sit on
// an arch at their recorded positions and never move for crowding. This chunk loads only behind the gate
// (smile3d-gate.ts); the fps probe here reports back through `onFail`.
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Raycaster, Scene, SphereGeometry, Vector2, WebGLRenderer, Group,
} from "three";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type { Overlay } from "../mouth-art/overlays.js";
import { FactList, IllustrationBadge, ProvenanceFooter } from "./blocks.js";
import type { Orientation, PresentModel, ToothFacts } from "./model.js";
import { PROBE_MS, probePasses } from "./smile3d-gate.js";
import { SMILE_MESHES, type BakedTooth } from "./smile3d-meshes.gen.js";
import { ToothSheet, type ToothSheetProps } from "./tooth-sheet.js";

export interface Smile3dProps {
  model: PresentModel;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  theme: "light" | "dark";
  onOpen: (tooth: number) => void;
  /** Called when WebGL is unavailable or the 2 s probe is under 24 fps: the slot shows the painted style. */
  onFail?: (() => void) | undefined;
  load3d?: ToothSheetProps["load3d"];
}

// ---- decoding the baked shells -------------------------------------------------------------------
interface Decoded { position: Float32Array; normal: Float32Array; index: Uint16Array; baked: BakedTooth }
const decodeCache = new Map<string, Decoded>();

function decode(type: string): Decoded | undefined {
  const hit = decodeCache.get(type);
  if (hit) return hit;
  const baked = SMILE_MESHES[type];
  if (baked === undefined) return undefined;
  const raw = atob(baked.b);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const n = baked.n;
  const q = new Int16Array(bytes.buffer.slice(0, n * 6));
  const nq = new Int8Array(bytes.buffer.slice(n * 6, n * 9));
  const dq = new Int16Array(bytes.buffer.slice(n * 9, n * 9 + baked.t * 6));
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const a = i % 3;
    const lo = baked.lo[a] ?? 0, hi = baked.hi[a] ?? 0;
    position[i] = lo + ((q[i] ?? 0) + 32767) / 65534 * (hi - lo);
    normal[i] = (nq[i] ?? 0) / 127;
  }
  const index = new Uint16Array(dq.length);
  for (let i = 0, prev = 0; i < dq.length; i++) { prev += dq[i] ?? 0; index[i] = prev; }
  const d = { position, normal, index, baked };
  decodeCache.set(type, d);
  return d;
}

// ---- runtime paint (decay, work) -----------------------------------------------------------------
const ENAMEL = new Color("#f1e9d6");
const THIN = new Color("#cdd7df");
const CARIES: Record<string, string> = { enamel: "#c9a56a", dentin: "#5a3a22", near_pulp: "#2b1a12" };
const WORK: Record<string, string> = { amalgam: "#8e949a", gold: "#d8b04a", cast_metal: "#c4c7cb", metal: "#c4c7cb", composite: "#e6dcc2", glass_ionomer: "#e2dccb", temporary: "#cfc2b0" };
const CROWN: Record<string, string> = { gold: "#d8b04a", cast_metal: "#c4c7cb", metal: "#c4c7cb" };
const METAL = new Set(["amalgam", "gold", "cast_metal", "metal"]);

const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Base-frame direction of a surface: mesial +x, buccal +z, biting +y. */
const DIR: Record<string, [number, number, number]> = { M: [1, 0, 0], D: [-1, 0, 0], B: [0, 0, 1], L: [0, 0, -1], O: [0, 1, 0] };

interface Patch { color: Color; dir: [number, number, number]; strength: number; whole: boolean }

function patchesOf(draw: readonly Overlay[]): Patch[] {
  const out: Patch[] = [];
  for (const o of draw) {
    if (o.kind === "caries") out.push({ color: new Color(CARIES[o.depth ?? "dentin"]), dir: DIR[o.surface] ?? DIR["O"] ?? [0, 1, 0], strength: 1, whole: false });
    else if (o.kind === "filled" || o.kind === "inlay") for (const s of o.surfaces ?? ["O"]) out.push({ color: new Color(WORK[o.material ?? "composite"] ?? "#dcd9d2"), dir: DIR[s] ?? [0, 1, 0], strength: 1, whole: false });
    else if (o.kind === "crown") out.push({ color: new Color(CROWN[o.material ?? ""] ?? "#f5f1e8"), dir: [0, 1, 0], strength: 1, whole: true });
    else if (o.kind === "veneer") out.push({ color: new Color("#f7f3ea"), dir: [0, 0, 1], strength: 1, whole: false });
  }
  return out;
}

function paint(d: Decoded, patches: readonly Patch[]): BufferAttribute {
  const { position, normal, baked } = d;
  const n = baked.n, h = (baked.hi[1] ?? 1) - (baked.lo[1] ?? 0);
  const col = new Float32Array(n * 3);
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const y = ((position[i * 3 + 1] ?? 0) - (baked.lo[1] ?? 0)) / h;
    const nx = normal[i * 3] ?? 0, ny = normal[i * 3 + 1] ?? 0, nz = normal[i * 3 + 2] ?? 0;
    c.copy(ENAMEL);
    c.lerp(THIN, 0.55 * sstep(0.78, 1, y) * (1 - Math.abs(ny)));   // incisal translucency: thin enamel at the tip
    c.multiplyScalar(1 - 0.14 * sstep(0.55, 0.95, Math.abs(nx)) * (1 - y));   // cheap contact-area occlusion
    for (const p of patches) {
      const w = p.whole ? 1 : sstep(0.4, 0.85, nx * p.dir[0] + ny * p.dir[1] + nz * p.dir[2]) * (p.dir[1] === 1 ? sstep(0.45, 0.8, y) : 1);
      if (w > 0) c.lerp(p.color, w * p.strength);
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  return new BufferAttribute(col, 3);
}

// ---- layout ---------------------------------------------------------------------------------------
export interface Slot { tooth: number; type: string; x: number; z: number; rotY: number; upper: boolean; mirror: boolean }

const R = 24;      // arch radius (mm)
const FLAT = 1.25; // the arch is flatter side to side than front to back
/** Places the recorded teeth on a shared arch, each by its own width, mesial to distal from the midline. */
export function layoutArch(teeth: readonly ToothFacts[], orientation: Orientation): Slot[] {
  const out: Slot[] = [];
  for (const upper of [true, false]) for (const right of [true, false]) {
    const side = teeth.filter((t) => (t.type.includes("u") === upper) && ((t.quadrant === 1 || t.quadrant === 4) === right) && !t.type.startsWith("p") && t.type.length === 2).sort((a, b) => a.index - b.index);
    // the patient's right is on the viewer's right in the mirror, on the left in a photo
    const sign = right === (orientation === "mirror") ? 1 : -1;
    let arc = 0;
    for (const t of side) {
      const w = decode(t.type)?.baked;
      const width = w === undefined ? 8 : (w.hi[0] ?? 0) - (w.lo[0] ?? 0);
      const mid = arc + width / 2;
      arc += width;
      const th = mid / R;
      out.push({ tooth: t.tooth, type: t.type, x: sign * R * Math.sin(th) * FLAT, z: -R * (1 - Math.cos(th)), rotY: sign * th, upper, mirror: sign === 1 });
    }
  }
  return out;
}

const impactedOf = (t: ToothFacts): boolean => t.eruption === "impacted" || t.eruption === "unerupted";

// ---- the component --------------------------------------------------------------------------------
export function Smile3d({ model, orientation, onOrientation, onOpen, onFail, load3d, theme, toothSheet }: Smile3dProps & { toothSheet?: boolean | undefined }): ReactElement {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seeThrough, setSeeThrough] = useState(false);
  const [sheet, setSheet] = useState<number | undefined>(undefined);
  const hasImpacted = model.teeth.some((t) => impactedOf(t) && !t.missing && t.shown !== "not_recorded");
  const examples = model.teeth.filter((t) => t.index === 8 && t.type.length === 2 && t.shown !== "not_recorded" && !t.missing && t.eruption === undefined);
  const open = toothSheet === true ? setSheet : onOpen;
  const openRef = useRef(open);
  const failRef = useRef(onFail);
  const seeRef = useRef(seeThrough);
  useEffect(() => { openRef.current = open; failRef.current = onFail; seeRef.current = seeThrough; });
  const redraw = useRef<() => void>(() => undefined);
  const slots = useMemo(() => layoutArch(model.teeth, orientation), [model, orientation]);

  useEffect(() => {
    const cv = canvas.current;
    const box = wrap.current;
    if (cv === null || box === null || sheet !== undefined) return undefined;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { failRef.current?.(); return undefined; }
    cv.addEventListener("webglunavailable", () => { failRef.current?.(); });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0xb08a80, 1.1), new AmbientLight(0xffffff, 0.35));
    const key = new DirectionalLight(0xfff4e6, 1.5); key.position.set(20, 40, 60);
    const rim = new DirectionalLight(0xdbe8ff, 0.7); rim.position.set(-30, 10, -20);   // wrap: light from behind softens the edges
    scene.add(key, rim);
    const world = new Group();
    scene.add(world);
    const gumMat = new MeshStandardMaterial({ color: "#d98a86", roughness: 0.75, transparent: true, opacity: 1 });
    const gumGeo = new SphereGeometry(1, 18, 12);
    const owned: { dispose: () => void }[] = [gumMat, gumGeo];
    const picks: Mesh[] = [];
    const impacted = new Set(model.teeth.filter(impactedOf).map((t) => t.tooth));
    const bySlot = new Map(slots.map((s) => [s.tooth, s]));
    let minX = 0, maxX = 0;
    for (const t of model.teeth) {
      const s = bySlot.get(t.tooth);
      if (s === undefined) continue;
      const d = decode(s.type);
      if (d === undefined) continue;
      const lo = d.baked.lo, hi = d.baked.hi;
      const tip = hi[1] ?? 0, root = lo[1] ?? 0;
      const f = s.upper ? -1 : 1;
      const dip = impacted.has(t.tooth) ? (s.upper ? 4.5 : -4.5) : 0;
      const y0 = (s.upper ? 0.25 + tip : -0.25 - tip) + dip;
      const cerv = y0 + f * root;   // the neck: the gum line
      const width = (hi[0] ?? 0) - (lo[0] ?? 0), depth = (hi[2] ?? 0) - (lo[2] ?? 0);
      const away = s.upper ? 1 : -1;
      const gum = new Mesh(gumGeo, gumMat);
      // a missing tooth is a real gap: the gum dips toward the biting plane
      gum.scale.set(width * 0.62, t.missing ? 2.4 : 4.2, depth * 0.62);
      gum.position.set(s.x, cerv + away * (t.missing ? 1.2 : 2.8), s.z);
      gum.rotation.y = s.rotY;
      world.add(gum);
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      if (t.missing || t.shown === "not_recorded" && t.index === 8) continue;
      const geo = new BufferGeometry();
      geo.setAttribute("position", new BufferAttribute(d.position, 3));
      geo.setAttribute("normal", new BufferAttribute(d.normal, 3));
      geo.setIndex(new BufferAttribute(d.index, 1));
      const patches = t.shown === "not_recorded" ? [] : patchesOf(t.draw);
      geo.setAttribute("color", paint(d, patches));
      const metal = t.draw.some((o) => (o.kind === "filled" || o.kind === "crown") && METAL.has(o.material ?? ""));
      const mat = new MeshStandardMaterial({ vertexColors: true, roughness: metal ? 0.3 : 0.38, metalness: metal ? 0.35 : 0, side: DoubleSide });
      const m = new Mesh(geo, mat);
      m.position.set(s.x, y0, s.z);
      m.rotation.y = s.rotY;
      m.scale.set(s.mirror ? -1 : 1, f, 1);
      m.userData["tooth"] = t.tooth;
      world.add(m);
      picks.push(m);
      owned.push(geo, mat);
    }
    const cam = new PerspectiveCamera(32, 1, 1, 400);
    const span = Math.max(30, (maxX - minX) / 2 + 8);
    const fit = () => {
      const w = box.clientWidth, h = Math.max(1, box.clientHeight);
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      const dist = Math.max(span / (Math.tan((cam.fov * Math.PI) / 360) * cam.aspect), 70);
      // the default view tilts down so the lower biting surfaces show
      const tilt = 0.42;
      cam.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist - 6);
      cam.lookAt(0, 0, -6);
      cam.updateProjectionMatrix();
    };
    let yaw = 0;
    const draw = () => {
      const see = seeRef.current;
      gumMat.opacity = see ? 0.22 : 1;
      gumMat.depthWrite = !see;
      world.rotation.y = yaw;
      renderer.render(scene, cam);
    };
    redraw.current = draw;
    fit();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { fit(); draw(); }) : undefined;
    ro?.observe(box);
    // 2 s fps probe: a slow device stops here and the painted style takes over
    let frames = 0, t0 = 0, raf = 0, probing = true, gone = false;
    const tick = (now: number) => {
      if (gone) return;
      if (t0 === 0) t0 = now;
      frames++;
      draw();
      if (now - t0 >= PROBE_MS) {
        probing = false;
        if (!probePasses(frames, now - t0)) failRef.current?.();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // drag to turn a little; a tap on a tooth opens it, or, for a tooth under the gum, shows through the gum
    const ray = new Raycaster(), ndc = new Vector2();
    let down: { x: number; y: number; yaw: number } | undefined;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY, yaw }; };
    const onMove = (e: PointerEvent) => {
      if (down === undefined) return;
      yaw = Math.max(-0.7, Math.min(0.7, down.yaw + (e.clientX - down.x) / 300));
      if (!probing) draw();
    };
    const onUp = (e: PointerEvent) => {
      const d0 = down;
      down = undefined;
      if (d0 === undefined || Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 6) return;
      const r = cv.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects(picks, false)[0];
      const tooth: unknown = hit?.object.userData["tooth"];
      if (typeof tooth !== "number") return;
      if (impacted.has(tooth)) { setSeeThrough(true); return; }
      openRef.current(tooth);
    };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      for (const o of owned) o.dispose();
      renderer.dispose();
      redraw.current = () => undefined;
    };
  }, [model, slots, sheet, theme]);

  useEffect(() => { seeRef.current = seeThrough; redraw.current(); }, [seeThrough]);

  if (sheet !== undefined) return <div className="ps-painted ps-painted-sheet" data-present-style="smile3d" data-view="sheet"><ToothSheet model={model} tooth={sheet} load3d={load3d} onBack={() => { setSheet(undefined); }} /></div>;
  const illustration = [
    "Tooth shapes and colours are a 3D model built from your record, not a scan or a photo. Teeth stay where they are; none are moved or straightened.",
    ...(model.teeth.some((t) => t.shown === "not_recorded") ? ["Plain teeth have nothing recorded yet."] : []),
  ];
  return (
    <div className="ps-painted ps-3d" data-present-style="smile3d" data-view="3d">
      <div className="ps-stage">
        <div className="ps-knobs">
          <div className="ps-seg" role="group" aria-label="Which way round">
            {(["mirror", "photo"] as const).map((o) => (
              <button key={o} type="button" aria-pressed={orientation === o} onClick={() => { onOrientation(o); }}>{o === "mirror" ? "As in your mirror" : "As in a photo"}</button>
            ))}
          </div>
          {hasImpacted ? <button type="button" className="ps-prompt" aria-pressed={seeThrough} onClick={() => { setSeeThrough(!seeThrough); }}>See through gum</button> : null}
        </div>
        <div className="ps-3d-box" ref={wrap}><canvas ref={canvas} aria-label="3D model of your smile, drag to turn it" /></div>
        <div className="ps-caption">
          <IllustrationBadge>3D model based on your record (Beta)</IllustrationBadge>
          {examples.length === 0 ? null : <IllustrationBadge>Wisdom teeth: example, not your tooth</IllustrationBadge>}
          <span className="ps-muted">Tap a tooth to look closer. Drag to turn the smile.</span>
        </div>
      </div>
      <div className="ps-side">
        <FactList model={model} onOpen={open} />
        <ProvenanceFooter recorded={["The list comes from this visit's record."]} illustration={illustration} />
      </div>
    </div>
  );
}

/** The style module's shape (§6), like the painted style's. */
export const smile3dStyle = { id: "smile3d" as const, label: "3D smile", Component: (p: Smile3dProps) => <Smile3d {...p} toothSheet /> };
