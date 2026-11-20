// three.js renderer of the 3D tooth detail: materials with micro-texture, stencil-capped cut faces for
// the Inside view, on-demand rendering, a coarse first frame then a refined one, animated step changes.
import {
  ACESFilmicToneMapping, AlwaysStencilFunc, BackSide, Box3, BufferAttribute, BufferGeometry, CanvasTexture, Color,
  DecrementWrapStencilOp, DirectionalLight, FrontSide, Group, IncrementWrapStencilOp, Material, MathUtils, Mesh,
  MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NotEqualStencilFunc, Object3D, PerspectiveCamera,
  PlaneGeometry, Plane, PMREMGenerator, Vector4, RepeatWrapping, ReplaceStencilOp, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildScene, KIND_ORDER, type Built, type Kind, type Layer, type Quality } from "./build.js";
import { at, clamp, mix, type MeshData } from "./sdf.js";
import { resolveScene, type SceneSpec, type Tooth3dOptions, type View } from "./spec.js";

export interface Tooth3dLabel { text: string; x: number; y: number; warn: boolean }
export interface Tooth3dHandle {
  /** Changes any option; geometry rebuilds only when the tooth, stage or details change. */
  update(opts: Partial<Tooth3dOptions>): void;
  /** Moves to another step of the current stage, animated unless reduced motion is on. */
  setStep(step: string): void;
  dispose(): void;
  /** Resolves after the refined frame (or at once when WebGL is unavailable). */
  readonly ready: Promise<void>;
  /** False when WebGL could not start (a `webglunavailable` event was dispatched on the canvas). */
  readonly ok: boolean;
  /** The resolved scene (notes such as "Illustration: depth not recorded", 2D badges). */
  readonly spec: SceneSpec | null;
  /** Renders now and returns a data URL of the canvas. */
  snapshot(type?: string): string;
  /** Visible triangles, frames drawn, label positions (CSS px). */
  stats(): { tris: number; frames: number; labels: Tooth3dLabel[] };
}

export const WEBGL_UNAVAILABLE = "webglunavailable";

const SHADE_3D: Record<string, [string, string]> = {
  A1: ["#f1e7d3", "#e8d3a8"], A2: ["#ecdcc0", "#e2c792"], A3: ["#e5d0a8", "#d9bb80"], "A3.5": ["#dcc396", "#cfad6e"], P: ["#f5f0e7", "#ecdcbd"],
};
const CAP: Record<Kind, string> = {
  gum: "#e0808c", bone: "#efe2c6", cancellous: "#d9c08f", abscess: "#80391c", clot: "#6a121a", enamel: "#f9f5ec", dentin: "#e9c886",
  pulp: "#de6672", decaySoft: "#9a6436", decayDark: "#2a160a", pressure: "#d6303f", calculus: "#bfa36a", composite: "#dde6ea",
  amalgam: "#8d9298", gold: "#cfa640", temporary: "#cdbfae", medicament: "#f7f6f0", core: "#c9d3db", gp: "#e8714c", sealant: "#f6efd9",
  crown: "#fbf8f2", implant: "#8f969d", abutment: "#aab1b8",
};

// ------------------------------------------------------------------ shader helpers

const NOISE_GLSL = `
float rtHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rtNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rtHash(i), rtHash(i + vec3(1,0,0)), f.x), mix(rtHash(i + vec3(0,1,0)), rtHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rtHash(i + vec3(0,0,1)), rtHash(i + vec3(1,0,1)), f.x), mix(rtHash(i + vec3(0,1,1)), rtHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 rtBump(vec3 pos, vec3 n, float h){ vec3 dpx = dFdx(pos), dpy = dFdy(pos); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2); return normalize(abs(det) * n - g); }
`;

interface Texture { freq: number; amp: number; rough: number; lines?: number; pores?: CanvasTexture; poreStr?: number; planar?: boolean }
/** Adds procedural micro-texture (bump + roughness variation), perikymata lines and bone pores. */
function textured<M extends Material>(mat: M, t: Texture): M {
  mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
    sh.uniforms["rtPores"] = { value: t.pores ?? null };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRtO; varying vec3 vRtW; varying vec3 vRtN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vRtO = position; vRtW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRtN = ${t.planar ? "vec3(0.0, 0.0, 1.0)" : "normalize(mat3(modelMatrix) * objectNormal)"};`);
    let fs = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec3 vRtO; varying vec3 vRtW; varying vec3 vRtN; uniform sampler2D rtPores;\n${NOISE_GLSL}`);
    if (t.pores) {
      fs = fs.replace("#include <map_fragment>", `#include <map_fragment>
        vec3 bw = pow(abs(normalize(vRtN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z); vec3 pp = vRtW * 0.09;
        float tp = texture2D(rtPores, pp.yz).r * bw.x + texture2D(rtPores, pp.xz).r * bw.y + texture2D(rtPores, pp.xy).r * bw.z;
        diffuseColor.rgb *= mix(1.0, tp, ${(t.poreStr ?? 0.5).toFixed(2)});`);
    }
    if (t.amp > 0 && fs.includes("#include <normal_fragment_maps>")) {
      const f = t.freq.toFixed(2);
      fs = fs.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        float rtN2 = rtNoise(vRtO * ${f} * 0.37 + 11.0); roughnessFactor = clamp(roughnessFactor * mix(${(1 - t.rough).toFixed(2)}, ${(1 + t.rough).toFixed(2)}, rtN2), 0.04, 1.0);`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        float rtH = rtNoise(vRtO * ${f}) * 0.65 + rtNoise(vRtO * ${f} * 2.7) * 0.35${t.lines ? ` + 0.12 * sin(vRtO.y * ${t.lines.toFixed(1)} + rtNoise(vRtO * 1.3) * 3.0)` : ""};
        normal = rtBump(-vViewPosition, normal, rtH * ${t.amp.toFixed(3)});`);
    }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `rt${String(t.freq)}:${String(t.amp)}:${String(t.lines ?? 0)}:${t.pores ? "p" : ""}:${t.planar ? "pl" : ""}`;
  return mat;
}

function poreTexture(): CanvasTexture | undefined {
  if (typeof document === "undefined") return undefined;
  const N = 256, cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const x = cv.getContext("2d");
  if (!x) return undefined;
  x.fillStyle = "#fff";
  x.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 700; i++) {
    const px = rnd() * N, py = rnd() * N, r = 1.2 + rnd() * rnd() * 7, a = 0.18 + rnd() * 0.4;
    x.fillStyle = `rgba(120,88,60,${a.toFixed(3)})`;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      x.beginPath();
      x.ellipse(px + ox, py + oy, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, 7);
      x.fill();
    }
  }
  const t = new CanvasTexture(cv);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function geometryOf(m: MeshData, index?: Uint16Array | Uint32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(m.position, 3));
  g.setAttribute("normal", new BufferAttribute(m.normal, 3));
  if (m.color) g.setAttribute("color", new BufferAttribute(m.color, m.colorSize ?? 3));
  g.setIndex(new BufferAttribute(index ?? m.index, 1));
  g.computeBoundingSphere();
  return g;
}

const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// ------------------------------------------------------------------ mount

/**
 * Mounts the 3D tooth detail on a canvas. On a device without WebGL it dispatches a
 * `webglunavailable` event on the canvas (next microtask) and returns an inert handle, so the caller
 * keeps the 2D art.
 */
export function mountTooth3d(canvas: HTMLCanvasElement, initial: Tooth3dOptions): Tooth3dHandle {
  let opts: Tooth3dOptions = { ...initial };
  let renderer: WebGLRenderer;
  const fail = (): void => { queueMicrotask(() => canvas.dispatchEvent(new CustomEvent(WEBGL_UNAVAILABLE, { bubbles: true }))); };
  let spec0: SceneSpec | null = null;
  try {
    spec0 = resolveScene(opts);
    const DPR0 = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
    renderer = new WebGLRenderer({ canvas, antialias: DPR0 < 2, stencil: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(DPR0);
  } catch {
    fail();
    return {
      update: () => undefined, setStep: () => undefined, dispose: () => undefined, ready: Promise.resolve(), ok: false, spec: spec0,
      snapshot: () => "", stats: () => ({ tris: 0, frames: 0, labels: [] }),
    };
  }
  renderer.localClippingEnabled = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = env;
  const key = new DirectionalLight(0xfff8f0, 2.4);
  key.position.set(-25, 40, 35);
  const rim = new DirectionalLight(0xe8f0ff, 0.8);
  rim.position.set(30, 10, -30);
  scene.add(key, rim);
  const camera = new PerspectiveCamera(30, 1, 1, 600);
  const head = new DirectionalLight(0xffffff, 0.55);
  head.position.set(0, 0.35, 1);
  head.target.position.set(0, 0, -1);
  camera.add(head, head.target);
  scene.add(camera);
  const clip = new Plane(new Vector3(0, 0, -1), 1000), planes = [clip];
  const pores = poreTexture();

  // materials
  const common = { clippingPlanes: planes };
  const vc = { ...common, vertexColors: true };
  const en = { ...vc, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.16, sheen: 0.25, sheenRoughness: 0.5, sheenColor: new Color("#ffffff"), specularIntensity: 0.75, envMapIntensity: 0.55 };
  const enamelTex: Texture = { freq: 2.6, amp: 0.016, rough: 0.35, lines: 15 };
  const M = {
    enamelT: textured(new MeshPhysicalMaterial({ ...en, transmission: 0.22, thickness: 1.5, ior: 1.62, attenuationColor: new Color("#f7eddc"), attenuationDistance: 5 }), enamelTex),
    enamelO: textured(new MeshPhysicalMaterial(en), enamelTex),
    dentin: textured(new MeshPhysicalMaterial({ ...vc, roughness: 0.62, sheen: 0.25, sheenRoughness: 0.7, sheenColor: new Color("#fff4dc"), envMapIntensity: 0.6 }), { freq: 3.2, amp: 0.015, rough: 0.2 }),
    pulp: new MeshStandardMaterial({ ...common, color: "#d4707a", roughness: 0.45 }),
    gum: textured(new MeshPhysicalMaterial({ ...vc, color: "#e07c88", roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new Color("#ffc4c4"), envMapIntensity: 0.6, transparent: true, opacity: 0.84, depthWrite: false }), { freq: 4.5, amp: 0.035, rough: 0.4 }),
    bone: textured(new MeshStandardMaterial({ ...vc, color: "#e3d1ad", roughness: 0.9, envMapIntensity: 0.6, transparent: true, opacity: 0.58, depthWrite: false }), { freq: 1.6, amp: 0.05, rough: 0.2, ...(pores ? { pores, poreStr: 0.55 } : {}) }),
    composite: textured(new MeshPhysicalMaterial({ ...en }), enamelTex),
    glass: new MeshPhysicalMaterial({ ...vc, color: "#efe8da", roughness: 0.55 }),
    amalgam: textured(new MeshStandardMaterial({ ...vc, color: "#8e949a", metalness: 0.85, roughness: 0.5 }), { freq: 6, amp: 0.02, rough: 0.3 }),
    gold: new MeshStandardMaterial({ ...vc, color: "#d8b04a", metalness: 1, roughness: 0.22 }),
    temporary: textured(new MeshStandardMaterial({ ...vc, color: "#cfc2b0", roughness: 0.88 }), { freq: 5, amp: 0.04, rough: 0.2 }),
    medicament: new MeshStandardMaterial({ ...vc, color: "#fbfaf4", roughness: 0.7 }),
    core: new MeshPhysicalMaterial({ ...vc, color: "#d5dade", roughness: 0.35, clearcoat: 0.5 }),
    gp: new MeshStandardMaterial({ ...vc, color: "#e2735a", roughness: 0.5 }),
    sealant: new MeshPhysicalMaterial({ ...vc, color: "#f6f1e6", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: new Color("#ffffff") }),
    ceramic: textured(new MeshPhysicalMaterial({ ...vc, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.3, sheenColor: new Color("#ffffff"), envMapIntensity: 0.7 }), { freq: 2.6, amp: 0.008, rough: 0.2 }),
    metal: new MeshStandardMaterial({ ...vc, color: "#c4c7cb", metalness: 1, roughness: 0.22 }),
    implant: textured(new MeshStandardMaterial({ ...vc, color: "#9ea5ac", metalness: 1, roughness: 0.38 }), { freq: 9, amp: 0.02, rough: 0.3 }),
    abutment: new MeshStandardMaterial({ ...vc, color: "#c3c8cd", metalness: 1, roughness: 0.18 }),
    calculus: textured(new MeshStandardMaterial({ ...vc, color: "#cdb57e", roughness: 0.95 }), { freq: 5.5, amp: 0.09, rough: 0.1 }),
    abscess: new MeshStandardMaterial({ ...common, color: "#8a3a1a", roughness: 0.6, emissive: new Color("#5a0e04"), emissiveIntensity: 0.4, transparent: true, opacity: 0.62, depthWrite: false }),
    infection: new MeshStandardMaterial({ ...common, color: "#c0503a", roughness: 0.6, emissive: new Color("#6a1a10"), emissiveIntensity: 0.3, transparent: true, opacity: 0.55, depthWrite: false }),
    clot: new MeshPhysicalMaterial({ ...vc, color: "#7a1820", roughness: 0.35, clearcoat: 0.8 }),
  };
  const stBack = new MeshBasicMaterial({ side: BackSide, clippingPlanes: planes, depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilFail: IncrementWrapStencilOp, stencilZFail: IncrementWrapStencilOp, stencilZPass: IncrementWrapStencilOp });
  const stFront = new MeshBasicMaterial({ side: FrontSide, clippingPlanes: planes, depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilFail: DecrementWrapStencilOp, stencilZFail: DecrementWrapStencilOp, stencilZPass: DecrementWrapStencilOp });
  const depthPre = new MeshBasicMaterial({ clippingPlanes: planes, colorWrite: false, transparent: true, depthWrite: true });
  const capGeo = new PlaneGeometry(400, 400);
  const caps = new Map<Kind, Mesh<PlaneGeometry, MeshBasicMaterial>>();
  KIND_ORDER.forEach((k, i) => {
    const mat = new MeshBasicMaterial({ color: CAP[k], toneMapped: false, stencilWrite: true, stencilRef: 0, stencilFunc: NotEqualStencilFunc, stencilFail: ReplaceStencilOp, stencilZFail: ReplaceStencilOp, stencilZPass: ReplaceStencilOp });
    if ((k === "cancellous" || k === "bone") && pores) textured(mat, { freq: 1, amp: 0, rough: 0, pores, poreStr: k === "cancellous" ? 0.75 : 0.25, planar: true });
    if (k === "gum" || k === "bone" || k === "cancellous") vignette(mat);
    const m = new Mesh(capGeo, mat);
    m.renderOrder = 102 + i * 3;
    m.visible = false;
    m.onAfterRender = (r) => { r.clearStencil(); };
    caps.set(k, m);
    scene.add(m);
  });

  // state
  let spec: SceneSpec = spec0;
  let built: Built | null = null;
  let quality: Quality = "coarse";
  let world: Group | null = null;
  let frames = 0, disposed = false, raf = 0;
  const reduced = (): boolean => opts.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const target = new Vector3();
  let az = 0, el = 0, dist = 60, dragAz = 0, dragEl = 0;
  let camAnim: { t0: number; from: [number, number, number, Vector3]; to: [number, number, number, Vector3] } | null = null;
  interface Anim { t0: number; dur: number; tick: (e: number) => void; done: () => void }
  let anim: Anim | null = null;
  let labelsCache: { view: View; list: { text: string; obj: Object3D; p: Vector3; warn: boolean }[] } | null = null;
  let overlay: HTMLDivElement | null = null;

  const matFor = (l: Layer): Material => {
    const k = l.kind;
    if (k === "enamel") return spec.view === "inside" || quality === "coarse" ? M.enamelO : M.enamelT;
    if (k === "crown") return l.look === "metal" ? M.metal : l.look === "gold" ? M.gold : M.ceramic;
    if (k === "composite") return l.look === "glass_ionomer" ? M.glass : spec.view === "inside" || quality === "coarse" ? M.composite : M.enamelT;
    if (k === "abscess") return l.label === "Infection" ? M.infection : M.abscess;
    if (k === "decaySoft" || k === "decayDark" || k === "pressure" || k === "cancellous") return M.pulp;
    return M[k];
  };

  function syncColors(): void {
    const [e, d] = SHADE_3D[spec.shade] ?? SHADE_3D["A2"] ?? ["#ecdcc0", "#e2c792"];
    M.enamelT.color.set(e);
    M.enamelO.color.set(e);
    M.dentin.color.set(d);
    M.composite.color.set(e).lerp(new Color("#f4efe6"), 0.05);
    M.ceramic.color.set(e).lerp(new Color("#ffffff"), 0.14);
    caps.get("crown")?.material.color.set("#dbe6ee");
    const bg = opts.background ? new Color(opts.background) : null;
    scene.background = bg;
    renderer.setClearColor(bg ?? new Color(0x000000), bg ? 1 : 0);
    const dark = bg ? bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.3 : false;
    const wis = spec.site === "wisdom";
    M.gum.opacity = wis ? 0.82 : 0.95;
    M.bone.opacity = (wis ? 0.4 : 0.5) + (dark ? 0.16 : 0);
    const lift = spec.upper ? -1 : 1;
    key.position.set(-25, 40 * lift, 35);
    rim.position.set(30, 10 * lift, -30);
    for (const k of ["gum", "bone", "cancellous"] as const) { const u: unknown = caps.get(k)?.material.userData["fade"]; if (isFade(u)) u.bg.value.copy(bg ?? new Color(0xffffff)); }
  }

  function makeWorld(b: Built): Group {
    const grp = new Group();
    grp.scale.set(spec.mirrored ? -1 : 1, spec.upper ? -1 : 1, 1);
    if (spec.cut === "x" && spec.view === "inside") grp.rotation.y = -Math.PI / 2;
    for (const part of b.parts) {
      const pg = new Group();
      pg.name = part.name;
      pg.position.set(...part.position);
      pg.rotation.z = part.rz;
      for (const l of part.layers) {
        const outerIdx = spec.view !== "inside" ? l.outer : undefined;
        const geo = geometryOf(l.mesh, outerIdx);
        const m = new Mesh(geo, matFor(l));
        m.userData = { layer: l };
        m.visible = !l.capOnly && !(spec.view !== "inside" && l.kind === "pulp");
        if (l.kind === "bone" || l.kind === "gum") {
          m.renderOrder = l.kind === "bone" ? 2 : 4;
          const pre = new Mesh(geo, depthPre);
          pre.renderOrder = m.renderOrder - 1;
          pre.userData = { pre: true };
          pg.add(pre);
        }
        const i = KIND_ORDER.indexOf(l.kind);
        const capGeoSrc = outerIdx ? geometryOf(l.mesh) : geo;
        const sb = new Mesh(capGeoSrc, stBack), sf = new Mesh(capGeoSrc, stFront);
        sb.renderOrder = 100 + i * 3;
        sf.renderOrder = 101 + i * 3;
        sb.userData = { section: l.kind };
        sf.userData = { section: l.kind };
        sb.visible = sf.visible = spec.view === "inside";
        pg.add(m, sb, sf);
      }
      grp.add(pg);
    }
    return grp;
  }

  function syncSection(): void {
    const on = spec.view === "inside" && built !== null;
    const kinds = new Set<Kind>();
    world?.traverse((o) => { const k: unknown = o.userData["section"]; if (isKind(k)) { o.visible = on; kinds.add(k); } });
    let cw = 1000;
    if (on && built && world) {
      world.updateMatrixWorld(true);
      const p = spec.cut === "x" ? new Vector3(built.cut, 0, 0) : new Vector3(0, 0, built.cut);
      cw = p.applyMatrix4(world.matrixWorld).z;
    }
    clip.constant = cw;
    if (on && built && world) {
      const box = new Box3();
      for (const x of [built.min[0], built.max[0]]) for (const y of [built.min[1], built.max[1]]) box.expandByPoint(new Vector3(x, y, built.cut).applyMatrix4(world.matrixWorld));
      const c = box.getCenter(new Vector3()), sz = box.getSize(new Vector3());
      for (const k of ["gum", "bone", "cancellous"] as const) {
        const u: unknown = caps.get(k)?.material.userData["fade"];
        if (isFade(u)) u.area.value.set(c.x, c.y, Math.max(sz.x / 2, 4), Math.max(sz.y / 2, 4));
      }
    }
    for (const [k, m] of caps) { m.visible = on && kinds.has(k); m.position.z = cw; }
  }

  function disposeWorld(w: Group | null): void {
    if (!w) return;
    scene.remove(w);
    const seen = new Set<object>();
    w.traverse((o) => { const g: unknown = o instanceof Mesh ? o.geometry : null; if (g instanceof BufferGeometry && !seen.has(g)) { seen.add(g); g.dispose(); } });
  }

  // camera
  function viewPose(): [number, number, number, Vector3] {
    if (!built || !world) return [0, 0, 60, new Vector3()];
    world.updateMatrixWorld(true);
    const box = new Box3();
    for (const x of [built.min[0], built.max[0]]) for (const y of [built.min[1], built.max[1]]) for (const z of [built.min[2], built.max[2]])
      box.expandByPoint(new Vector3(x, y, z).applyMatrix4(world.matrixWorld));
    const size = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
    const tan = Math.tan(MathUtils.degToRad(camera.fov / 2)), aspect = camera.aspect || 1;
    const ant = /[123]$/.test(spec.type), up = spec.upper ? -1 : 1;
    if (spec.view === "top") {
      const cr = new Vector3(...built.crown).applyMatrix4(world.matrixWorld);
      const w = Math.max(size.x * 0.62, 12);
      return [0, 78 * up, (w * 0.55) / (tan * Math.min(aspect, 1.3)) + 8, cr];
    }
    if (spec.view === "front") {
      // frame the crown and the upper roots; the rest of the ridge fades out
      const fb = new Box3();
      for (const x of [built.min[0], built.max[0]]) for (const y of [Math.max(built.min[1], built.focusY), built.max[1]]) for (const z of [built.min[2], built.max[2]])
        fb.expandByPoint(new Vector3(x, y, z).applyMatrix4(world.matrixWorld));
      fb.getSize(size);
      fb.getCenter(c);
    }
    const d = Math.max((size.y / 2) / tan * 1.06, (size.x / 2) / (tan * aspect) * 1.08) + size.z / 2;
    if (spec.view === "inside") return [0, 0, d, c];
    return [ant ? 24 : 0, (ant ? 4 : spec.upper ? 12 : 20) * up, d * 1.02, c];
  }
  function placeCamera(p: [number, number, number, Vector3]): void {
    const [a, e, d, t] = p;
    target.copy(t);
    const ea = MathUtils.degToRad(clamp(e + dragEl, -85, 85)), aa = MathUtils.degToRad(a + dragAz);
    camera.position.set(t.x + d * Math.cos(ea) * Math.sin(aa), t.y + d * Math.sin(ea), t.z + d * Math.cos(ea) * Math.cos(aa));
    camera.up.set(0, 1, 0);
    camera.lookAt(t);
    az = a; el = e; dist = d;
  }
  function goView(instant: boolean): void {
    const to = viewPose();
    if (instant || reduced() || frames === 0) { camAnim = null; placeCamera(to); invalidate(); return; }
    camAnim = { t0: performance.now(), from: [az, el, dist, target.clone()], to };
    invalidate();
  }

  // labels
  function computeLabels(): void {
    labelsCache = null;
    if (!opts.labels || !built || !world) return;
    const list: { text: string; obj: Object3D; p: Vector3; warn: boolean }[] = [];
    const partObj = (n: string): Object3D | undefined => world?.children.find((c) => c.name === n);
    if (spec.view === "inside") {
      for (const a of built.insideAnchors) { const o = partObj(a.part); if (o) list.push({ text: a.text, obj: o, p: new Vector3(...a.p), warn: a.warn === true }); }
    } else {
      world.updateMatrixWorld(true);
      const camDir = camera.position.clone().sub(target).normalize();
      const seen = new Set<string>();
      for (const a of built.insideAnchors) if (a.warn) { const o = partObj(a.part); if (o) { list.push({ text: a.text, obj: o, p: new Vector3(...a.p), warn: true }); seen.add(a.text); } }
      world.traverse((o) => {
        if (!(o instanceof Mesh) || !o.visible) return;
        const l: unknown = o.userData["layer"];
        if (!isLayer(l) || !l.label || seen.has(l.label) || (spec.view === "top" && l.kind === "bone") || l.kind === "dentin" && spec.site === "tooth" && spec.canal === "pulp" && spec.crown === "none") return;
        const P = l.mesh.position, N = l.mesh.normal, nm = o.matrixWorld.clone().invert().transpose();
        let best = -1, bi = -1;
        const n = new Vector3(), centre = new Vector3();
        let cnt = 0;
        for (let i = 0; i < P.length; i += 3 * 5) {
          n.set(at(N, i), at(N, i + 1), at(N, i + 2)).applyMatrix4(nm).normalize();
          if (n.dot(camDir) > 0.6) { centre.add(new Vector3(at(P, i), at(P, i + 1), at(P, i + 2))); cnt++; }
        }
        if (!cnt) return;
        centre.divideScalar(cnt);
        for (let i = 0; i < P.length; i += 3 * 5) {
          n.set(at(N, i), at(N, i + 1), at(N, i + 2)).applyMatrix4(nm).normalize();
          const f = n.dot(camDir);
          if (f < 0.6) continue;
          const s = f - 0.08 * Math.hypot(at(P, i) - centre.x, at(P, i + 1) - centre.y, at(P, i + 2) - centre.z);
          if (s > best) { best = s; bi = i; }
        }
        if (bi >= 0) { seen.add(l.label); list.push({ text: l.label, obj: o, p: new Vector3(at(P, bi), at(P, bi + 1), at(P, bi + 2)), warn: false }); }
      });
    }
    labelsCache = { view: spec.view, list };
  }
  function projectLabels(): Tooth3dLabel[] {
    if (!labelsCache) return [];
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return labelsCache.list.map((l) => {
      const v = l.p.clone().applyMatrix4(l.obj.matrixWorld).project(camera);
      return { text: l.text, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, warn: l.warn };
    });
  }
  function drawLabels(): void {
    if (!opts.labels) { overlay?.remove(); overlay = null; return; }
    const host = canvas.parentElement;
    if (!host) return;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif;";
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(overlay);
    }
    const ls = projectLabels(), w = canvas.clientWidth;
    const sides: Record<string, Tooth3dLabel[]> = { l: [], r: [] };
    for (const l of ls) (l.x < w / 2 ? sides["l"] : sides["r"])?.push(l);
    let html = `<svg width="100%" height="100%" style="position:absolute;inset:0;overflow:visible">`;
    let pills = "";
    for (const [side, arr] of Object.entries(sides)) {
      arr.sort((a, b) => a.y - b.y);
      let last = -99;
      for (const l of arr) {
        const ly = Math.max(l.y, last + 24);
        last = ly;
        const lx = side === "l" ? Math.max(8, Math.min(l.x - 40, w * 0.22)) : Math.min(w - 8, Math.max(l.x + 40, w * 0.78));
        const col = l.warn ? "#c62828" : "currentColor";
        html += `<line x1="${l.x.toFixed(1)}" y1="${l.y.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${col}" stroke-opacity=".7" stroke-width="1"/><circle cx="${l.x.toFixed(1)}" cy="${l.y.toFixed(1)}" r="2.5" fill="${col}"/>`;
        const tx = side === "l" ? `right:${(w - lx + 4).toFixed(1)}px` : `left:${(lx + 4).toFixed(1)}px`;
        pills += `<span style="position:absolute;${tx};top:${(ly - 9).toFixed(1)}px;padding:2px 7px;border-radius:9px;white-space:nowrap;background:${l.warn ? "#c62828" : "rgba(255,255,255,.88)"};color:${l.warn ? "#fff" : "#1d2a27"};box-shadow:0 1px 3px rgba(0,0,0,.18)">${escapeHtml(l.text)}</span>`;
      }
    }
    overlay.innerHTML = html + "</svg>" + pills;
  }

  // frames
  function resize(): void {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function invalidate(): void {
    if (!raf && !disposed) raf = requestAnimationFrame(frame);
  }
  function frame(now: number): void {
    raf = 0;
    if (disposed) return;
    let moving = false;
    if (camAnim) {
      const u = clamp((now - camAnim.t0) / 650, 0, 1), e = easeInOut(u), a = camAnim.from, b = camAnim.to;
      placeCamera([mix(a[0], b[0], e), mix(a[1], b[1], e), mix(a[2], b[2], e), a[3].clone().lerp(b[3], e)]);
      if (u >= 1) { camAnim = null; computeLabels(); }
      moving = true;
    }
    if (anim) {
      const u = clamp((now - anim.t0) / anim.dur, 0, 1);
      anim.tick(easeInOut(u));
      if (u >= 1) { const a = anim; anim = null; a.done(); }
      moving = true;
    }
    renderer.render(scene, camera);
    frames++;
    drawLabels();
    if (moving) invalidate();
  }

  // building and transitions
  function build(q: Quality): Built {
    quality = q;
    return buildScene(spec, q);
  }
  function show(b: Built, animate: boolean): void {
    const old = world, oldBuilt = built;
    built = b;
    world = makeWorld(b);
    scene.add(world);
    syncColors();
    if (!animate || !old || !oldBuilt || reduced()) {
      disposeWorld(old);
      syncSection();
      goView(true);
      computeLabels();
      invalidate();
      return;
    }
    // entering parts drop, screw or fade in; leaving parts fade out; moved parts glide
    const has = (bb: Built, part: string, k: Kind): boolean => bb.parts.some((p) => p.name === part && p.layers.some((l) => l.kind === k));
    interface Movable { material: unknown; position: Vector3; rotation: { y: number } }
    const movers: { mesh: Movable; mat: Material; clone: Material; enter: string; dir: number }[] = [];
    const wrap = (mesh: Movable, enter: string, dir: number): void => {
      const mat = mesh.material;
      if (!(mat instanceof Material)) return;
      const clone = mat.clone();
      clone.transparent = true;
      clone.onBeforeCompile = (sh, r) => { mat.onBeforeCompile(sh, r); };
      clone.customProgramCacheKey = () => mat.customProgramCacheKey();
      mesh.material = clone;
      movers.push({ mesh, mat, clone, enter, dir });
    };
    const scan = (w: Group, other: Built, dir: number): void => {
      for (const pg of w.children) for (const o of pg.children) {
        if (!(o instanceof Mesh)) continue;
        const l: unknown = o.userData["layer"];
        if (!isLayer(l) || !l.enter || l.capOnly || has(other, pg.name, l.kind)) {
          if (dir < 0 && (!isLayer(l) || !l.enter || has(b, pg.name, isLayer(l) ? l.kind : "gum"))) o.visible = false;
          continue;
        }
        if (o.visible) wrap(o, l.enter, dir);
      }
    };
    scan(world, oldBuilt, 1);
    old.traverse((o) => { if (o.userData["section"] !== undefined || o.userData["pre"]) o.visible = false; });
    scan(old, b, -1);
    const glides: { obj: Object3D; from: Vector3; to: Vector3; rf: number; rt: number }[] = [];
    for (const pg of world.children) {
      const prev = old.children.find((c) => c.name === pg.name);
      if (prev && (!prev.position.equals(pg.position) || prev.rotation.z !== pg.rotation.z)) glides.push({ obj: pg, from: prev.position.clone(), to: pg.position.clone(), rf: prev.rotation.z, rt: pg.rotation.z });
    }
    world.traverse((o) => { if (o.userData["section"] !== undefined) o.visible = false; });
    syncSection();
    for (const c of caps.values()) c.visible = false;
    const base = new Map(movers.map((m) => [m.mesh, m.mesh.position.clone()]));
    const t0 = performance.now();
    anim = {
      t0, dur: 900,
      tick: (e) => {
        for (const m of movers) {
          const k = m.dir > 0 ? e : 1 - e;
          m.clone.opacity = (m.mat.opacity) * clamp(k * 1.6, 0, 1);
          const p0 = base.get(m.mesh) ?? new Vector3();
          if (m.enter === "drop" || m.enter === "screw") m.mesh.position.set(p0.x, p0.y + (1 - k) * (m.enter === "screw" ? 6 : 5), p0.z);
          if (m.enter === "screw") m.mesh.rotation.y = (1 - k) * Math.PI * 3;
        }
        for (const g of glides) { g.obj.position.lerpVectors(g.from, g.to, e); g.obj.rotation.z = mix(g.rf, g.rt, e); }
      },
      done: () => {
        for (const m of movers) { m.mesh.material = m.mat; m.clone.dispose(); m.mesh.rotation.y = 0; const p0 = base.get(m.mesh); if (p0) m.mesh.position.copy(p0); }
        disposeWorld(old);
        syncSection();
        computeLabels();
        invalidate();
      },
    };
    invalidate();
  }

  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((r) => { resolveReady = r; });
  function refine(): void {
    refineTimer = undefined;
    if (disposed) return;
    show(build("fine"), false);
    resolveReady();
  }
  function rebuild(animate: boolean): void {
    if (quality === "fine") { show(build("fine"), animate); return; }
    show(build("coarse"), false);
    if (refineTimer === undefined) refineTimer = setTimeout(refine, 30);
  }

  // interaction: drag turns the tooth around its target
  let drag: { x: number; y: number; az: number; el: number } | null = null;
  const onDown = (e: PointerEvent): void => {
    if (opts.interactive === false) return;
    drag = { x: e.clientX, y: e.clientY, az: dragAz, el: dragEl };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    dragAz = drag.az - (e.clientX - drag.x) * 0.5;
    if (e.pointerType !== "touch") dragEl = clamp(drag.el + (e.clientY - drag.y) * 0.4, -70, 70);
    placeCamera([az, el, dist, target.clone()]);
    invalidate();
  };
  const onUp = (): void => { if (drag) { drag = null; computeLabels(); invalidate(); } };
  const onLost = (e: Event): void => { e.preventDefault(); canvas.dispatchEvent(new CustomEvent(WEBGL_UNAVAILABLE, { bubbles: true })); };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("webglcontextlost", onLost);
  if (opts.interactive !== false) canvas.style.touchAction = "pan-y";
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { resize(); goView(true); }) : null;
  ro?.observe(canvas);

  resize();
  try {
    rebuild(false);
    renderer.render(scene, camera);
    frames++;
  } catch {
    fail();
  }

  const handle: Tooth3dHandle = {
    ready,
    get ok() { return !disposed; },
    get spec() { return spec; },
    update(next) {
      const prev = spec;
      opts = { ...opts, ...next };
      spec = resolveScene(opts);
      if (spec.key !== prev.key || (spec.view === "inside") !== (prev.view === "inside")) {
        const viewOnly = spec.key === prev.key;
        if (!viewOnly) {
          rebuild(true);
          // another tooth or site: frame it (a step change of the same tooth keeps the user's turn)
          if (spec.type !== prev.type || spec.site !== prev.site || spec.upper !== prev.upper || spec.mirrored !== prev.mirrored) { dragAz = 0; dragEl = 0; goView(true); }
        }
        else if (built) show(built, false);
      } else syncColors();
      if (spec.view !== prev.view) { dragAz = 0; dragEl = 0; goView(false); }
      computeLabels();
      invalidate();
    },
    setStep(step) {
      if (!opts.stage) return;
      handle.update({ stage: { ...opts.stage, step } });
    },
    snapshot(type = "image/png") {
      renderer.render(scene, camera);
      return canvas.toDataURL(type);
    },
    stats() {
      let tris = 0;
      world?.traverse((o) => { if (o instanceof Mesh && o.visible && o.userData["layer"] && o.geometry instanceof BufferGeometry) tris += (o.geometry.index?.count ?? 0) / 3; });
      return { tris, frames, labels: projectLabels() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (refineTimer !== undefined) clearTimeout(refineTimer);
      ro?.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("webglcontextlost", onLost);
      overlay?.remove();
      disposeWorld(world);
      for (const m of Object.values(M)) m.dispose();
      for (const m of [stBack, stFront, depthPre]) m.dispose();
      for (const c of caps.values()) c.material.dispose();
      capGeo.dispose();
      pores?.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      resolveReady();
    },
  };
  return handle;
}

interface Fade { area: { value: { set(a: number, b: number, c: number, d: number): void } }; bg: { value: Color } }
function isFade(v: unknown): v is Fade {
  return typeof v === "object" && v !== null && "area" in v && "bg" in v;
}
/** Cut faces of the ridge fade into the background toward their edges (no boxy section). */
function vignette(mat: MeshBasicMaterial): void {
  const fade = { area: { value: new Vector4(0, 0, 10, 10) }, bg: { value: new Color(0xffffff) } };
  mat.userData["fade"] = fade;
  const prev = mat.onBeforeCompile.bind(mat), prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms["rtArea"] = fade.area;
    sh.uniforms["rtBg"] = fade.bg;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vRtW2;").replace("#include <project_vertex>", "#include <project_vertex>\nvRtW2 = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vRtW2; uniform vec4 rtArea; uniform vec3 rtBg;")
      .replace("#include <tonemapping_fragment>", "vec2 rq = (vRtW2.xy - rtArea.xy) / rtArea.zw; float rr = length(vec2(rq.x * 0.96, max(rq.y, -1.2 + abs(rq.x) * 0.2)));\ngl_FragColor.rgb = mix(gl_FragColor.rgb, rtBg, smoothstep(0.8, 1.04, rr));\n#include <tonemapping_fragment>");
  };
  mat.customProgramCacheKey = () => prevKey() + "vig";
}

function isKind(v: unknown): v is Kind {
  return KIND_ORDER.some((k) => k === v);
}
function isLayer(v: unknown): v is Layer {
  return typeof v === "object" && v !== null && "kind" in v && "mesh" in v;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
