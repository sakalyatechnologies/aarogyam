// Dev-only review gallery for the mouth art kit: every tooth type, stage, overlay and brushing band.
// Build and screenshot with scripts/mouth-gallery.mjs.
import { StrictMode, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import {
  ArtSvg, BrushingAnimation, BRUSHING_BANDS, STAGE_MODELS, TOOTH_TYPES, archLayout, eruptionScene, loadBrushingArt, loadShapes,
  loadStageArt, loadToothArt, overlayPart, stagePart, toothScene, toothTypeOf,
  type BrushingArt, type Overlay, type ShapeSet, type StageModel, type StageSet, type ToothArt, type ToothType, type ViewName,
} from "../index.js";

interface Loaded {
  teeth: Record<string, ToothArt>;
  stages: Record<string, StageSet>;
  brushing: Record<string, BrushingArt>;
  shapes: ShapeSet;
}

async function loadAll(): Promise<Loaded> {
  const teeth: Record<string, ToothArt> = {};
  await Promise.all(TOOTH_TYPES.map(async (t) => { teeth[t] = await loadToothArt(t); }));
  const stages: Record<string, StageSet> = {};
  await Promise.all(STAGE_MODELS.map(async (m) => { stages[m] = await loadStageArt(m); }));
  const brushing: Record<string, BrushingArt> = {};
  await Promise.all(BRUSHING_BANDS.map(async (b) => { brushing[b] = await loadBrushingArt(b); }));
  return { teeth, stages, brushing, shapes: await loadShapes() };
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing art");
  return v;
}

const STAGE_DEMOS: [StageModel, ToothType[]][] = [
  ["root_canal", ["u1", "l6", "pl5"]], ["filling", ["l6", "u4"]], ["extraction", ["l6", "u3"]], ["crown", ["u6", "u1"]],
  ["scaling", ["l1", "u3"]], ["implant", ["l6", "u1"]], ["sealant", ["l7", "u6", "pl5"]],
];
const PAIR: ToothType[] = ["l6", "u1"];
const SV: ViewName[] = ["section", "front"];
const TSF: ViewName[] = ["top", "section", "front"];

function Fig({ caption, children }: { caption: string; children: ReactElement }): ReactElement {
  return <figure>{children}<figcaption>{caption}</figcaption></figure>;
}

function Gallery({ d }: { d: Loaded }): ReactElement {
  const t = (k: ToothType) => must(d.teeth[k]);
  const wisdom = must(d.stages.wisdom_extraction);
  const views: ViewName[] = ["top", "front", "section"];
  const ov = (art: ToothArt, view: ViewName, list: Overlay[], fdi?: number) =>
    toothScene(art, view, { shapes: d.shapes, parts: list.map((o) => overlayPart(art, view, o)), ...(fdi ? { fdi } : {}) });
  const stage = (model: StageModel, step: string, art: ToothArt, params?: Record<string, string>, fdi?: number) => {
    const sc = d.stages[model]?.scenes[step];
    if (!sc) return toothScene(art, "section");
    return toothScene(art, sc.view, { shapes: d.shapes, parts: [stagePart(sc, params)], ...(fdi ? { fdi } : {}) });
  };
  const fdiSets = {
    adult: [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47],
    child: [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85],
    mixed: [11, 12, 53, 54, 55, 16, 21, 22, 63, 64, 65, 26, 31, 32, 73, 74, 75, 36, 41, 42, 83, 84, 85, 46],
  };
  return (
    <main>
      <h1>Mouth art kit</h1>
      <p>Every picture below is drawn from the generated art (SVG paths and gradients) through the kit's scene builder.</p>

      <h2>Overview arches (true widths, no overlap)</h2>
      {Object.entries(fdiSets).map(([name, fdis]) => {
        const w = Math.min(window.innerWidth - 34, 560);
        const lay = archLayout(fdis, { width: w });
        return (
          <div key={name}>
            <h3>{name}</h3>
            <div className="arch" style={{ width: w, height: lay.height + 8 }}>
              {lay.slots.map((s) => {
                const art = t(s.type);
                const sc = toothScene(art, "top", { fdi: s.fdi });
                const [, , bw, bh] = sc.box;
                const k = s.w / (bw - 12);
                return <div key={s.fdi} style={{ position: "absolute", left: s.x - (bw * k) / 2, top: s.y - (bh * k) / 2, width: bw * k, height: bh * k, transform: `rotate(${String(s.angle)}deg)` }}><ArtSvg scene={sc} className="fill" /></div>;
              })}
            </div>
          </div>
        );
      })}

      <h2>Tooth types (top, front, inside)</h2>
      <div className="grid wide">
        {TOOTH_TYPES.map((k) => (
          <figure key={k}>
            <div className="row3">{views.map((v) => <ArtSvg key={v} scene={toothScene(t(k), v)} label={`${t(k).label}, ${v}`} />)}</div>
            <figcaption>{`${k} · ${t(k).label}`}</figcaption>
          </figure>
        ))}
      </div>

      <h2>Left side and upper teeth (mirrored and flipped)</h2>
      <div className="grid">
        {[11, 21, 16, 26, 36, 46, 55, 65, 75, 85].map((fdi) => {
          const art = t(must(toothTypeOf(fdi)));
          return <Fig key={fdi} caption={String(fdi)}><div className="row3">{views.map((v) => <ArtSvg key={v} scene={toothScene(art, v, { fdi })} />)}</div></Fig>;
        })}
      </div>

      <h2>Treatment stages</h2>
      {STAGE_DEMOS.map(([model, types]) => (
        <div key={model}>
          <h3>{model}</h3>
          <div className="grid">
            {types.flatMap((ty) => [...(d.stages[model]?.steps ?? []), ...(model === "extraction" ? ["healed"] : [])].flatMap((step) => {
              if (model === "filling" && step !== "decay" && step !== "cleaned") {
                return ["composite", "g:amal"].map((m) => <Fig key={ty + step + m} caption={`${ty} ${step} (${m === "composite" ? "composite" : "amalgam"})`}><ArtSvg scene={stage(model, step, t(ty), { M: m, S: ty === "u4" ? "M" : "O" })} /></Fig>);
              }
              return [<Fig key={ty + step} caption={`${ty} ${step}`}><ArtSvg scene={stage(model, step, t(ty), { M: "g:porc", S: ty === "u4" ? "M" : "O", D: "dentin" })} /></Fig>];
            }))}
          </div>
        </div>
      ))}
      <h3>wisdom_extraction: position next to the 7</h3>
      <div className="grid wide">
        {([["erupted", undefined], ["partial", "vertical"], ["partial", "mesioangular"], ["impacted", "vertical"], ["impacted", "mesioangular"], ["impacted", "distoangular"], ["impacted", "horizontal"], ["unerupted", "vertical"]] as const).map(([e, a]) => (
          <Fig key={e + String(a)} caption={`48 ${e}${a ? " " + a : ""}`}><ArtSvg scene={eruptionScene(t("l8"), t("l7"), wisdom, e, a, { shapes: d.shapes, fdi: 48 })} /></Fig>
        ))}
        <Fig caption="18 impacted distoangular"><ArtSvg scene={eruptionScene(t("u8"), t("u7"), wisdom, "impacted", "distoangular", { shapes: d.shapes, fdi: 18 })} /></Fig>
        <Fig caption="38 partial mesioangular"><ArtSvg scene={eruptionScene(t("l8"), t("l7"), wisdom, "partial", "mesioangular", { shapes: d.shapes, fdi: 38 })} /></Fig>
      </div>

      <h2>Decay: surface by depth (36)</h2>
      {(["M", "O", "D", "B", "L"] as const).map((s) => (
        <div key={s} className="grid">
          {(["enamel", "dentin", "near_pulp", undefined] as const).flatMap((dep) => TSF.map((v) => {
            const sc = ov(t("l6"), v, [dep ? { kind: "caries", surface: s, depth: dep } : { kind: "caries", surface: s }]);
            return <Fig key={s + String(dep) + v} caption={`${s} ${dep ?? "no depth"} ${v}${sc.notes.length ? " · Illustration: depth not recorded" : ""}`}><ArtSvg scene={sc} /></Fig>;
          }))}
        </div>
      ))}

      <h2>Detail overlays</h2>
      <div className="grid">
        {([
          ["infection", { kind: "infection", type: "infection" }], ["abscess", { kind: "infection", type: "abscess" }], ["bleeding", { kind: "bleeding" }],
          ["pocket 4 mm", { kind: "pocket", mm: 4 }], ["pocket 7 mm distal", { kind: "pocket", mm: 7, side: "D" }], ["mobility 1", { kind: "mobility", grade: 1 }],
          ["mobility 2", { kind: "mobility", grade: 2 }], ["mobility 3", { kind: "mobility", grade: 3 }], ["fracture", { kind: "fracture" }],
        ] satisfies [string, Overlay][]).flatMap(([name, o]) => PAIR.flatMap((ty) => SV.map((v) => (
          <Fig key={name + ty + v} caption={`${name} · ${ty} ${v}`}><ArtSvg scene={ov(t(ty), v, [o])} /></Fig>
        ))))}
      </div>

      <h2>Existing work</h2>
      <div className="grid">
        {([
          ["filling MOD composite", { kind: "filled", surfaces: ["M", "O", "D"], material: "composite" }],
          ["filling OB amalgam", { kind: "filled", surfaces: ["O", "B"], material: "amalgam" }],
          ["crown zirconia", { kind: "crown", material: "zirconia" }], ["crown metal", { kind: "crown", material: "cast_metal" }], ["crown gold", { kind: "crown", material: "gold" }],
          ["root canal", { kind: "root_canal" }], ["post and core", { kind: "post_core" }], ["core build-up", { kind: "core_build_up" }],
          ["implant", { kind: "implant" }], ["bridge pontic", { kind: "bridge_pontic" }], ["missing", { kind: "missing" }],
          ["inlay", { kind: "inlay", surfaces: ["O", "M"] }], ["sealant", { kind: "sealant" }], ["veneer", { kind: "veneer" }],
        ] satisfies [string, Overlay][]).flatMap(([name, o]) => PAIR.flatMap((ty) => views.map((v) => (
          <Fig key={name + ty + v} caption={`${name} · ${ty} ${v}`}><ArtSvg scene={ov(t(ty), v, [o])} /></Fig>
        ))))}
        {views.map((v) => <Fig key={"pulp" + v} caption={`pulpotomy + crown · 85 ${v}`}><ArtSvg scene={ov(t("pl5"), v, [{ kind: "pulpotomy" }, { kind: "crown", material: "cast_metal" }], 85)} /></Fig>)}
      </div>

      <h2>Brushing</h2>
      <div className="grid wide brush">
        {BRUSHING_BANDS.map((b) => (
          <figure key={b}>
            <BrushingAnimation art={must(d.brushing[b])} band={b} highlight={21} />
            <figcaption>{b} · highlight 21</figcaption>
          </figure>
        ))}
      </div>
      <h3>Reduced motion stills</h3>
      <div className="grid wide brush">
        {BRUSHING_BANDS.map((b) => (
          <figure key={b}>
            <BrushingAnimation art={must(d.brushing[b])} band={b} reducedMotion />
            <figcaption>{b}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}

function App(): ReactElement {
  const [d, setD] = useState<Loaded | undefined>();
  useEffect(() => { void loadAll().then(setD); }, []);
  return d ? <Gallery d={d} /> : <p>Loading…</p>;
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<StrictMode><App /></StrictMode>);
