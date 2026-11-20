import { describe, expect, it, vi } from "vitest";
import { toothTypeOf } from "../mouth-art/loaders.js";
import { DETAIL_VALUES, EXTRA_SCENES, STAGE_MODELS, STAGE_STEPS } from "../mouth-art/stage-steps.js";
import { TOOTH_TYPES } from "../mouth-art/types.js";
import { buildScene, type Built, type Kind } from "./build.js";
import { isStep, resolveScene, typeOfFdi, type SceneSpec, type Tooth3dOptions } from "./spec.js";

// A WebGL stand-in: jsdom has no GPU, so the renderer and the environment map are faked.
vi.mock("three", async (importOriginal) => {
  const three = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    localClippingEnabled = false;
    toneMapping = 0;
    toneMappingExposure = 1;
    renders = 0;
    constructor(o: { canvas: HTMLCanvasElement }) {
      if (o.canvas.dataset["nogl"]) throw new Error("no WebGL");
    }
    setPixelRatio(): void { /* fake */ }
    setSize(): void { /* fake */ }
    setClearColor(): void { /* fake */ }
    render(): void { this.renders++; }
    clearStencil(): void { /* fake */ }
    dispose(): void { /* fake */ }
    forceContextLoss(): void { /* fake */ }
  }
  class FakePmrem {
    fromScene(): { texture: { dispose(): void } } { return { texture: { dispose: () => undefined } }; }
    dispose(): void { /* fake */ }
  }
  return { ...three, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePmrem };
});

const kinds = (b: Built, part?: string): Set<Kind> => new Set(b.parts.filter((p) => !part || p.name === part).flatMap((p) => p.layers.map((l) => l.kind)));
const steps = (m: (typeof STAGE_MODELS)[number]): string[] => [...STAGE_STEPS[m], ...(m in EXTRA_SCENES ? ["healed"] : [])];

describe("resolveScene: every 2D step id maps to a distinct 3D scene", () => {
  for (const model of STAGE_MODELS) {
    it(model, () => {
      const fdi = model === "wisdom_extraction" ? 38 : model === "implant" ? 36 : 46;
      const keys = steps(model).map((step) => {
        expect(isStep(model, step)).toBe(true);
        return resolveScene({ fdi, stage: { model, step } }).key;
      });
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
  it("rejects an unknown step and tooth", () => {
    expect(() => resolveScene({ fdi: 46, stage: { model: "root_canal", step: "nope" } })).toThrow();
    expect(() => resolveScene({ fdi: 99 })).toThrow();
  });
  it("root canal steps", () => {
    const at = (step: string): SceneSpec => resolveScene({ fdi: 21, stage: { model: "root_canal", step } });
    expect(at("access_clean")).toMatchObject({ canal: "open", access: "open", crown: "none" });
    expect(at("dressing")).toMatchObject({ canal: "medicament", access: "temporary" });
    expect(at("obturation")).toMatchObject({ canal: "filled", access: "core" });
    expect(at("crown")).toMatchObject({ canal: "filled", crown: "crown" });
    expect(at("dressing").cut).toBe("x");
  });
  it("other models", () => {
    expect(resolveScene({ fdi: 46, stage: { model: "implant", step: "abutment" } })).toMatchObject({ site: "implant", implant: 2 });
    expect(resolveScene({ fdi: 46, stage: { model: "extraction", step: "remove" } })).toMatchObject({ site: "tooth", lift: true });
    expect(resolveScene({ fdi: 46, stage: { model: "extraction", step: "socket_healing" } }).site).toBe("socket");
    expect(resolveScene({ fdi: 46, stage: { model: "scaling", step: "calculus" } })).toMatchObject({ calculus: true, gumInflamed: true });
    expect(resolveScene({ fdi: 36, stage: { model: "sealant", step: "sealed" } }).sealant).toBe(true);
    expect(resolveScene({ fdi: 16, stage: { model: "crown", step: "prep", material: "gold" } })).toMatchObject({ crown: "prep", crownLook: "gold" });
    const filled = resolveScene({ fdi: 36, stage: { model: "filling", step: "filled", material: "amalgam" }, details: { caries: [{ surface: "M", depth: "near_pulp" }] } });
    expect(filled.cavities).toEqual([{ surface: "M", depth: "near_pulp", state: "filled", look: "amalgam" }]);
  });
});

describe("resolveScene: every §1.13 detail value", () => {
  it("caries depth", () => {
    for (const depth of DETAIL_VALUES.caries_depth) {
      expect(resolveScene({ fdi: 46, details: { caries: [{ surface: "O", depth }] } }).cavities[0]).toMatchObject({ depth, state: "decay" });
    }
    expect(resolveScene({ fdi: 46, details: { caries: [{ surface: "O" }] } }).notes).toContain("Illustration: depth not recorded");
  });
  it("infection", () => {
    for (const v of DETAIL_VALUES.infection) expect(resolveScene({ fdi: 46, details: { infection: v } }).infection).toBe(v);
    expect(resolveScene({ fdi: 46, details: { abscess: true } }).infection).toBe("abscess");
    expect(resolveScene({ fdi: 46 }).infection).toBeNull();
  });
  it("eruption and angulation", () => {
    for (const eruption of DETAIL_VALUES.eruption) for (const angulation of DETAIL_VALUES.angulation) {
      const s = resolveScene({ fdi: 38, details: { eruption, angulation } });
      if (eruption === "erupted") expect(s.site).toBe("tooth");
      else expect(s.wisdom).toEqual({ eruption, angulation, neighbor: "l7" });
    }
    expect(resolveScene({ fdi: 38, stage: { model: "wisdom_extraction", step: "position" } }).notes).toContain("Illustration: position not recorded");
  });
  it("bleeding, pockets and mobility become 2D badges", () => {
    for (const mm of DETAIL_VALUES.pocket_mm) expect(resolveScene({ fdi: 46, details: { pocket_mm: Number(mm) } }).badges[0]).toMatchObject({ kind: "pocket", value: Number(mm) });
    for (const g of [1, 2, 3] as const) expect(resolveScene({ fdi: 75, details: { mobility: g } }).badges[0]?.label).toBe(`Loose milk tooth, grade ${String(g)}`);
    expect(resolveScene({ fdi: 46, details: { mobility: 0 } }).badges).toEqual([]);
    expect(resolveScene({ fdi: 46, details: { bleeding: true } }).badges[0]?.kind).toBe("bleeding");
  });
  it("existing work and fracture", () => {
    const s = resolveScene({ fdi: 36, details: { fracture: true, restorations: [{ kind: "root_canal" }, { kind: "crown", material: "pfm" }, { kind: "filled", surfaces: ["D"], material: "amalgam" }] } });
    expect(s).toMatchObject({ fracture: true, canal: "filled", access: "core", crown: "crown", crownLook: "ceramic" });
    expect(resolveScene({ fdi: 36, details: { restorations: [{ kind: "implant" }] } })).toMatchObject({ site: "implant", implant: 3 });
    expect(resolveScene({ fdi: 36, details: { restorations: [{ kind: "missing" }] } }).site).toBe("healed");
  });
  it("tooth types match the 2D kit for every FDI number", () => {
    for (const q of [1, 2, 3, 4, 5, 6, 7, 8]) for (let p = 1; p <= 8; p++) expect(typeOfFdi(q * 10 + p)).toBe(toothTypeOf(q * 10 + p));
    expect(resolveScene({ fdi: 24 })).toMatchObject({ upper: true, mirrored: true });
    expect(resolveScene({ fdi: 44 })).toMatchObject({ upper: false, mirrored: false });
  });
});

describe("buildScene", () => {
  it("draws every tooth type within budget", () => {
    for (const t of TOOTH_TYPES) {
      const b = buildScene(resolveScene({ toothType: t }), "coarse");
      expect(kinds(b, "tooth")).toEqual(new Set(["enamel", "dentin", "pulp"]));
      expect(b.tris).toBeLessThan(30000);
    }
  }, 60000);
  it("root canal parts per step", () => {
    const k = (step: string): Set<Kind> => kinds(buildScene(resolveScene({ fdi: 46, stage: { model: "root_canal", step } }), "coarse"), "tooth");
    expect(k("access_clean").has("pulp")).toBe(false);
    expect([...k("dressing")]).toEqual(expect.arrayContaining(["medicament", "temporary"]));
    expect([...k("obturation")]).toEqual(expect.arrayContaining(["gp", "core"]));
    expect([...k("crown")]).toEqual(expect.arrayContaining(["gp", "crown"]));
  });
  it("detail overlays and every step build", () => {
    const cases: Tooth3dOptions[] = [
      { fdi: 46, details: { caries: [{ surface: "O", depth: "near_pulp" }, { surface: "M", depth: "enamel" }], infection: "abscess", fracture: true } },
      { fdi: 38, details: { eruption: "impacted", angulation: "horizontal" } },
      ...STAGE_MODELS.flatMap((model) => steps(model).map((step): Tooth3dOptions => ({ fdi: model === "wisdom_extraction" ? 48 : 36, stage: { model, step } }))),
    ];
    for (const o of cases) {
      const b = buildScene(resolveScene(o), "coarse");
      expect(b.tris).toBeGreaterThan(1000);
      expect(kinds(b, "perio")).toEqual(new Set(["gum", "bone", "cancellous"]));
    }
    const b = buildScene(resolveScene(cases[0] ?? {}), "coarse");
    expect([...kinds(b, "tooth")]).toEqual(expect.arrayContaining(["decayDark", "abscess"]));
    expect(b.insideAnchors.some((a) => a.text === "Abscess" && a.warn)).toBe(true);
    const w = buildScene(resolveScene(cases[1] ?? {}), "coarse");
    expect(w.parts.map((p) => p.name)).toEqual(["perio", "neighbor", "tooth"]);
    expect(w.insideAnchors.some((a) => a.text === "Pressing on 7")).toBe(true);
  }, 60000);
});

describe("mountTooth3d", () => {
  const canvas = (): HTMLCanvasElement => { const c = document.createElement("canvas"); document.body.appendChild(c); return c; };
  it("falls back with a webglunavailable event", async () => {
    const { mountTooth3d, WEBGL_UNAVAILABLE } = await import("./index.js");
    const c = canvas();
    c.dataset["nogl"] = "1";
    const seen = vi.fn();
    const h = mountTooth3d(c, { fdi: 46 });
    c.addEventListener(WEBGL_UNAVAILABLE, seen);
    await Promise.resolve();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(h.ok).toBe(false);
    await h.ready;
    expect(() => { h.update({ view: "top" }); h.setStep("x"); h.dispose(); }).not.toThrow();
  });
  it("mounts, refines, changes step and view, disposes", async () => {
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => setTimeout(() => { f(performance.now()); }, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { clearTimeout(id); });
    const { mountTooth3d } = await import("./index.js");
    const c = canvas();
    const h = mountTooth3d(c, { fdi: 46, stage: { model: "root_canal", step: "access_clean" }, view: "inside", labels: true, reducedMotion: true });
    expect(h.ok).toBe(true);
    await h.ready;
    expect(h.spec?.canal).toBe("open");
    const t0 = h.stats().tris;
    expect(t0).toBeGreaterThan(5000);
    expect(t0).toBeLessThan(60000);
    h.setStep("dressing");
    expect(h.spec?.canal).toBe("medicament");
    h.update({ view: "front", details: { infection: "abscess" } });
    expect(h.spec?.infection).toBe("abscess");
    await new Promise((r) => setTimeout(r, 20));
    expect(h.stats().frames).toBeGreaterThan(1);
    h.dispose();
    expect(h.ok).toBe(false);
    vi.unstubAllGlobals();
  }, 30000);
});
