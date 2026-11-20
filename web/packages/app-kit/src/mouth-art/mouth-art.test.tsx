import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ART_KEYS, resolveArt, resolveDetail } from "./art-map.js";
import { archLayout } from "./arch.js";
import { brushingPose, brushingScene } from "./brushing.js";
import { eruptionKey, eruptionScene } from "./eruption.js";
import { loadBrushingArt, loadShapes, loadStageArt, loadToothArt, toothTypeOf } from "./loaders.js";
import { overlayPart } from "./overlays.js";
import { BrushingAnimation } from "./react.js";
import { drawScene, sceneToSvg, type Canvas2D } from "./render.js";
import { composeLayers, stagePart, toothScene } from "./scene.js";
import { BRUSHING_BANDS, DETAIL_VALUES, EXTRA_SCENES, STAGE_MODELS, STAGE_STEPS } from "./stage-steps.js";
import { TOOTH_TYPES, type ArtLayer } from "./types.js";
import dentalRs from "../../../../../crates/aarogyam-domain/src/dental.rs?raw";
import vocab from "../../../../../specialties/dental/vocabulary.json" with { type: "json" };
import artMapJson from "../../../../../specialties/dental/art-map.json" with { type: "json" };
import sizesJson from "./gen/sizes.json" with { type: "json" };

afterEach(cleanup);

function seededFindings(): string[] {
  const src = dentalRs;
  const block = /Finding \{([\s\S]*?)\n\s*\}\n\);/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/=> "([a-z_]+)"/g)].map((m) => m[1] ?? "");
}
function vocabulary(): { procedures: string[]; materials: string[] } {
  return { procedures: vocab.procedures.map((t) => t.id), materials: vocab.materials.map((t) => t.id) };
}
const isField = (k: string): k is keyof typeof DETAIL_VALUES => k in DETAIL_VALUES;
const mapped = (r: { art: string } | { text_only: true; label: string }) => ("art" in r ? ART_KEYS.has(r.art) : r.label.length > 0);

describe("art-map coverage (§1.13)", () => {
  it("maps every seeded finding, procedure and material to art or text_only", () => {
    const findings = seededFindings();
    expect(findings).toContain("missing");
    expect(findings.length).toBe(10);
    const { procedures, materials } = vocabulary();
    expect(procedures.length).toBeGreaterThanOrEqual(16);
    const unmapped = [
      ...findings.filter((f) => !mapped(resolveArt("findings", f)) || ("text_only" in resolveArt("findings", f) && f !== "watch" && f !== "missing")).map((f) => `finding ${f}`),
      ...procedures.filter((p) => !mapped(resolveArt("procedures", p))).map((p) => `procedure ${p}`),
      ...materials.filter((m) => !mapped(resolveArt("materials", m))).map((m) => `material ${m}`),
    ];
    expect(unmapped).toEqual([]);
    // every listed value has an explicit entry (no fallthrough to the custom-term label)
    for (const [group, ids] of [["findings", findings], ["procedures", procedures], ["materials", materials]] as const) {
      const table: Record<string, unknown> = artMapJson[group];
      for (const id of ids) expect(id in table, `${group}.${id}`).toBe(true);
    }
  });

  it("maps every §1.13 detail value (DETAIL_VALUES until chart-details.json is seeded)", () => {
    const fields = Object.entries(DETAIL_VALUES);
    for (const [field, values] of fields) {
      if (!isField(field)) throw new Error(field);
      for (const v of values) expect(mapped(resolveDetail(field, v)), `${field}=${v}`).toBe(true);
    }
  });

  it("resolves clinic-custom terms and unknown ids to text_only; missing may be art or text (DT7)", () => {
    expect(resolveArt("procedures", "0b9f0c4e-2f7a-4c43-9b8e-6f1f5c2d9a10")).toMatchObject({ text_only: true });
    expect(resolveArt("materials", "not_seeded")).toMatchObject({ text_only: true });
    expect(mapped(resolveArt("findings", "missing"))).toBe(true);
  });
});

describe("stage art", () => {
  it("has a scene for every step id, and the extra scenes", async () => {
    for (const m of STAGE_MODELS) {
      const set = await loadStageArt(m);
      expect(set.steps).toEqual([...STAGE_STEPS[m]]);
      for (const s of STAGE_STEPS[m]) expect(set.scenes[s], `${m}.${s}`).toBeDefined();
    }
    for (const [m, list] of Object.entries(EXTRA_SCENES)) {
      const set = await loadStageArt(m === "extraction" ? "extraction" : "wisdom_extraction");
      for (const s of list) expect(set.scenes[s], `${m}.${s}`).toBeDefined();
    }
  });

  it("every slot a stage or overlay uses exists on every tooth type", async () => {
    const shapes = await loadShapes();
    const refs = new Set<string>();
    const collect = (layers: ArtLayer[]) => { for (const l of layers) refs.add(l.d); };
    for (const m of STAGE_MODELS) for (const sc of Object.values((await loadStageArt(m)).scenes)) collect(sc.add);
    const missing: string[] = [];
    for (const type of TOOTH_TYPES) {
      const art = await loadToothArt(type);
      for (const r of refs) {
        for (const S of ["M", "O", "D"]) for (const D of ["enamel", "dentin", "near_pulp"]) {
          const d = r.replace("{S}", S).replace("{D}", D);
          if (d.startsWith("@") && d !== "@tex" && !(d.slice(1) in art.geo) && !(d.slice(1) in (art.views.top.slots ?? {}))) missing.push(`${type} ${d}`);
          if (d.startsWith("#") && !(d.slice(1) in shapes.d)) missing.push(`shape ${d}`);
        }
      }
      for (const S of ["M", "O", "D", "B", "L"]) expect(art.views.top.anchors?.[`surf.${S}`], `${type} surf.${S}`).toBeDefined();
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe("scenes and renderers (m3: one d for SVG and Path2D)", () => {
  it("draws the same path strings in the SVG and on a canvas", async () => {
    const art = await loadToothArt("l6");
    const shapes = await loadShapes();
    const rc = await loadStageArt("root_canal");
    const sc = rc.scenes.dressing;
    if (!sc) throw new Error("no dressing scene");
    const scene = toothScene(art, "section", { shapes, parts: [stagePart(sc)], fdi: 36 });
    const svg = sceneToSvg(scene);
    const drawn: string[] = [];
    class FakePath { constructor(public d = "") { drawn.push(d); } addPath(): void { /* recorded via constructor */ } }
    const noop = () => undefined;
    const grad = { addColorStop: noop };
    const ctx: Canvas2D = {
      save: noop, restore: noop, transform: noop, clip: noop, fill: noop, stroke: noop, setLineDash: noop,
      createLinearGradient: () => grad, createRadialGradient: () => grad, fillText: noop, strokeText: noop,
      fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "round", lineJoin: "round", globalAlpha: 1, font: "", textAlign: "center",
    };
    drawScene(ctx, scene, { scale: 2, makePath: (d) => new FakePath(d) });
    for (const node of scene.nodes) {
      expect(svg).toContain(`d="${node.d}"`);
      expect(drawn).toContain(node.d);
    }
    expect(scene.nodes.length).toBeGreaterThan(10);
  });

  it("composeLayers hides and inserts above a named layer, chaining later inserts", () => {
    const base: ArtLayer[] = [{ n: "a", d: "M0 0" }, { n: "b", d: "M0 0" }, { n: "c", d: "M0 0" }];
    const out = composeLayers(base, ["c"], [{ n: "x", d: "M0 0", above: "a" }, { n: "y", d: "M0 0" }, { n: "z", d: "M0 0", above: "a" }]);
    expect(out.map((l) => l.n)).toEqual(["a", "x", "y", "z", "b"]);
  });

  it("labels decay without a recorded depth as an illustration (§1.13)", async () => {
    const art = await loadToothArt("l6");
    expect(overlayPart(art, "section", { kind: "caries", surface: "O" }).notes).toEqual(["depth_not_recorded"]);
    expect(overlayPart(art, "section", { kind: "caries", surface: "O", depth: "near_pulp" }).notes).toEqual([]);
  });

  it("mirrors left-side teeth and flips upper teeth", async () => {
    const art = await loadToothArt("u6");
    expect(toothScene(art, "top", { fdi: 16 }).outer).toEqual([1, 0, 0, -1, 0, 200]);
    expect(toothScene(art, "top", { fdi: 26 }).outer).toEqual([-1, 0, 0, -1, 100, 200]);
    expect(toothTypeOf(55)).toBe("pu5");
    expect(toothTypeOf(48)).toBe("l8");
    expect(toothTypeOf(59)).toBeUndefined();
  });

  it("composes every wisdom position next to the 7", async () => {
    const [m3, m2, w] = await Promise.all([loadToothArt("l8"), loadToothArt("l7"), loadStageArt("wisdom_extraction")]);
    for (const e of ["erupted", "partial", "impacted", "unerupted"] as const) {
      for (const a of ["vertical", "mesioangular", "distoangular", "horizontal"] as const) {
        const s = eruptionScene(m3, m2, w, e, a, { fdi: 38 });
        expect(s.nodes.length).toBeGreaterThan(15);
        expect(ART_KEYS.has(`scene:wisdom_extraction.position.${eruptionKey(e, a)}`)).toBe(true);
      }
    }
  });
});

describe("overview layout", () => {
  it("never overlaps neighbouring milk teeth at 390 px", () => {
    const child = [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85];
    const mixed = [11, 12, 53, 54, 55, 16, 21, 22, 63, 64, 65, 26, 31, 32, 73, 74, 75, 36, 41, 42, 83, 84, 85, 46];
    for (const set of [child, mixed]) {
      const { slots } = archLayout(set, { width: 358 });
      expect(slots.length).toBe(set.length);
      for (const a of slots) for (const b of slots) {
        if (a === b || Math.floor(a.fdi / 10) !== Math.floor(b.fdi / 10) || Math.abs((a.fdi % 10) - (b.fdi % 10)) !== 1) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${String(a.fdi)}-${String(b.fdi)}`).toBeGreaterThanOrEqual(((a.w + b.w) / 2) * 0.98);
      }
    }
  });
});

describe("brushing (§1.4, DT6)", () => {
  it("picks the band variant: children get the parent's hand, teens and adults floss", async () => {
    const kid = await loadBrushingArt("general_6_12");
    const teen = await loadBrushingArt("general_teen");
    const hasSkin = (s: ReturnType<typeof brushingScene>) => s.gradients.some((g) => g.id.endsWith("b_skin"));
    expect(hasSkin(brushingScene(kid, "general_6_12", brushingPose("general_6_12", 500)))).toBe(true);
    expect(hasSkin(brushingScene(teen, "general_teen", brushingPose("general_teen", 500)))).toBe(false);
    expect(brushingPose("general_teen", 5500).phase).toBe("floss");
    expect(brushingPose("general_6_12", 5500).phase).toBe("chewing");
    const under6 = await loadBrushingArt("general_under_6");
    expect(Object.keys(under6.upper.teeth).every((k) => k.startsWith("5"))).toBe(true);
  });

  it("keeps each lazy brushing-<band> chunk within 8 KB gzipped", () => {
    const sizes: Record<string, { gz: number } | undefined> = sizesJson;
    for (const band of BRUSHING_BANDS) expect(sizes[`brushing/${band}.ts`]?.gz ?? Infinity, band).toBeLessThanOrEqual(8 * 1024);
  });

  describe("animation", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"] });
    });
    afterEach(() => { vi.useRealTimers(); });

    it("Pause stops the loop and Play resumes it (WCAG 2.2.2)", async () => {
      const art = await loadBrushingArt("general_adult");
      render(<BrushingAnimation art={art} band="general_adult" reducedMotion={false} />);
      const brushTransform = () => [...document.querySelectorAll("path")].find((p) => (p.getAttribute("fill") ?? "").includes("b_handle"))?.getAttribute("transform");
      act(() => { vi.advanceTimersByTime(300); });
      const button = screen.getByRole("button", { name: "Pause" });
      expect(button.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      const paused = brushTransform();
      act(() => { vi.advanceTimersByTime(700); });
      expect(brushTransform()).toBe(paused);
      fireEvent.click(button);
      act(() => { vi.advanceTimersByTime(700); });
      expect(brushTransform()).not.toBe(paused);
    });
  });

  it("shows three captioned stills under reduced motion", async () => {
    const art = await loadBrushingArt("general_under_6");
    render(<BrushingAnimation art={art} band="general_under_6" reducedMotion />);
    const figs = document.querySelectorAll("figure");
    expect(figs.length).toBe(3);
    for (const f of figs) expect(f.querySelector("figcaption")?.textContent.length ?? 0).toBeGreaterThan(10);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("sizes", () => {
  it("keeps per-tooth-type and per-model chunks small", () => {
    for (const [k, v] of Object.entries(sizesJson)) {
      const gz = v.gz;
      if (k.startsWith("teeth/")) expect(gz, k).toBeLessThanOrEqual(11 * 1024);
      if (k.startsWith("stages/")) expect(gz, k).toBeLessThanOrEqual(3 * 1024);
    }
  });
});
