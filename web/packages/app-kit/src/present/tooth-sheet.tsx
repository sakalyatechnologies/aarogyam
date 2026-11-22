// ToothSheet (present-studio-design §5.3, slice 1c): one tooth, drawn from its recorded state: the biting side
// and a cut-away (section) pair, a before/after CompareSlider (one scene, one viewBox), the recorded steps, the
// usual steps under "Usual plan · general guidance" (words only: no numbers, no dates) and an optional lazy 3D.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactElement } from "react";

import { eruptionScene } from "../mouth-art/eruption.js";
import { loadShapes, loadStageArt, loadToothArt, neighborOf, toothTypeOf } from "../mouth-art/loaders.js";
import { overlayPart, type Overlay } from "../mouth-art/overlays.js";
import { ArtSvg } from "../mouth-art/react.js";
import { stagePart, toothScene, type ScenePart } from "../mouth-art/scene.js";
import { sceneArt, type StageModel } from "../mouth-art/stage-steps.js";
import type { Scene, ShapeSet, StageSet, ToothArt, ViewName } from "../mouth-art/types.js";
import {
  details3d, detailOverlays, isAngulation, isEruption, mainTreatment, modelTitle, overlaysFor, stageParams, stepLabels, stepOverlays, toothInfo,
  type SnapStep, type SnapTooth,
} from "../mouth-view/model.js";
import type { Tooth3dHandle, Tooth3dOptions } from "../real-teeth-3d/index.js";
import { IllustrationBadge, ProvenanceFooter, RecordBadge } from "./blocks.js";
import { CompareSlider } from "./compare-slider.js";
import type { FactItem, PresentModel, ToothFacts } from "./model.js";

/** What a state of the tooth is drawn from: the record as charted, or one stage picture. */
export type StateSpec = { kind: "record" } | { kind: "stage"; model: StageModel; step: string };

export interface SheetStepRow { key: string; heading: string; words: string; state: "done" | "current" | "next" }

export interface SheetContent {
  tooth: number;
  where: string;
  title: string;
  facts: FactItem[];
  /** Steps backed by a record here: "Visit 2" only on done or current, the next date alone. */
  recorded: SheetStepRow[];
  /** The treatment's usual steps: words only. */
  usual: { key: string; words: string }[];
  treatment?: string;
  /** The picture now (the pair) and, when a next step is recorded, the picture after it. */
  now: StateSpec;
  after?: StateSpec;
  afterWords?: string | undefined;
  /** A wisdom tooth drawn from its recorded eruption. */
  wisdom: boolean;
  recorded_tooth: boolean;
}

const stageOf = (s: SnapStep | undefined): StateSpec | undefined => {
  const a = s === undefined ? undefined : sceneArt(s.scene);
  return a === undefined ? undefined : { kind: "stage", model: a.model, step: a.step };
};

/** The sheet's words and which states to draw, from the facts only. Pure. */
export function sheetContent(model: PresentModel, tooth: number): SheetContent {
  const tf = model.teeth.find((t) => t.tooth === tooth);
  const record = tf?.record;
  const facts = model.facts.filter((f) => f.tooth === tooth);
  const info = toothInfo(tooth);
  const main = mainTreatment(record);
  const steps = main?.steps ?? [];
  const labels = main === undefined ? [] : stepLabels(main, record);
  const recorded: SheetStepRow[] = [];
  steps.forEach((s, i) => {
    if (s.state === "done" || s.state === "current" || s.state === "next") recorded.push({ key: s.key, heading: labels[i]?.heading ?? "", words: s.words, state: s.state });
  });
  const usual = steps.filter((s) => s.state === "usual").map((s) => ({ key: s.key, words: s.words }));
  const cur = steps.findLast((s) => s.state === "current") ?? steps.findLast((s) => s.state === "done");
  const next = steps.find((s) => s.state === "next");
  const now: StateSpec = stageOf(cur) ?? { kind: "record" };
  let after: StateSpec | undefined;
  let afterWords: string | undefined;
  if (next !== undefined) { after = stageOf(next); afterWords = "After the next recorded step"; }
  else if (main?.state === "planned" && cur === undefined) {
    // a recorded plan item: the picture of the finished treatment
    const last = steps.findLast((s) => stageOf(s) !== undefined);
    after = stageOf(last);
    afterWords = `After the planned ${modelTitle(main.model).toLowerCase()}`;
  } else if (cur !== undefined && main?.state === "in_progress") {
    // nothing booked yet: the usual step that follows, shown as illustration
    const nx = steps.slice(steps.indexOf(cur) + 1).find((s) => s.state === "usual" && stageOf(s) !== undefined);
    after = stageOf(nx);
    if (after !== undefined) afterWords = "Usually, the step after this";
  }
  const wisdom = main === undefined && isEruption(record?.details?.eruption) && record.details.eruption !== "erupted" && !info.primary;
  return {
    tooth, where: info.name, title: facts[0]?.words ?? (tf?.shown === "sound" ? "Nothing to treat" : "Nothing recorded for this tooth"), facts, recorded, usual,
    ...(main === undefined ? {} : { treatment: modelTitle(main.model) }), now, ...(after === undefined ? {} : { after, afterWords }), wisdom, recorded_tooth: record !== undefined,
  };
}

interface Art { tooth: ToothArt; shapes: ShapeSet; stages: Partial<Record<StageModel, StageSet>>; neighbour?: ToothArt | undefined; wisdom?: StageSet | undefined }

/** Loads the sheet's art lazily; "failed" lets the sheet stay as text. */
function useSheetArt(c: SheetContent, tooth: number): { art: Art | undefined; failed: boolean } {
  const [state, setState] = useState<{ key: string; art?: Art; failed?: boolean } | undefined>(undefined);
  const models = [c.now, c.after].flatMap((s) => (s?.kind === "stage" ? [s.model] : []));
  const key = `${String(tooth)}|${models.join(",")}|${c.wisdom ? "w" : ""}`;
  const type = toothTypeOf(tooth);
  useEffect(() => {
    let live = true;
    if (type === undefined) return;
    const nb = c.wisdom ? toothTypeOf(neighborOf(tooth) ?? 0) : undefined;
    const uniq = [...new Set(models)];
    void Promise.all([
      loadToothArt(type), loadShapes(), Promise.all(uniq.map((m) => loadStageArt(m))),
      nb === undefined ? Promise.resolve(undefined) : loadToothArt(nb),
      c.wisdom ? loadStageArt("wisdom_extraction") : Promise.resolve(undefined),
    ]).then(([t, shapes, sets, neighbour, wisdom]) => {
      if (!live) return;
      const stages: Art["stages"] = {};
      uniq.forEach((m, i) => { const set = sets[i]; if (set !== undefined) stages[m] = set; });
      setState({ key, art: { tooth: t, shapes, stages, neighbour, wisdom } });
    }, () => { if (live) setState({ key, failed: true }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const cur = state?.key === key ? state : undefined;
  return { art: cur?.art, failed: type === undefined || cur?.failed === true };
}

/** Builds one view of the tooth in one state; `grow` is shared by both states so their boxes match. */
function stateScene(art: Art, spec: StateSpec, view: ViewName, t: SnapTooth | undefined, fdi: number, grow: number): Scene {
  const base: ScenePart = { add: [], ...(grow > 0 ? { grow } : {}) };
  const asRecord = (): ScenePart[] => [base, ...overlaysFor(t).map((o) => overlayPart(art.tooth, view, o))];
  const withOverlays = (os: Overlay[] | undefined): ScenePart[] => (os === undefined ? asRecord() : [base, ...os.map((o) => overlayPart(art.tooth, view, o))]);
  let parts: ScenePart[];
  if (spec.kind === "record") parts = asRecord();
  else {
    const sc = art.stages[spec.model]?.scenes[spec.step];
    if (sc === undefined) parts = asRecord();
    else if (sc.view === view) parts = [base, stagePart(sc, stageParams(t)), ...(t === undefined ? [] : detailOverlays(t).map((o) => overlayPart(art.tooth, view, o)))];
    else parts = withOverlays(stepOverlays(`${spec.model}.${spec.step}`, t));
  }
  return toothScene(art.tooth, view, { fdi, shapes: art.shapes, parts });
}

const growOf = (art: Art, spec: StateSpec | undefined): number => (spec?.kind === "stage" ? (art.stages[spec.model]?.scenes[spec.step]?.grow ?? 0) : 0);

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return c.getContext("webgl2") !== null || c.getContext("webgl") !== null;
  } catch { return false; }
}

export interface ToothSheetProps {
  model: PresentModel;
  tooth: number;
  onBack?: (() => void) | undefined;
  /** Inside a story card: no "Back" button, no Esc handling and no focus grab. */
  embedded?: boolean | undefined;
  /** Lazy 3D module (`import("@aarogyam/app-kit/real-teeth-3d")`); without it there is no "See in 3D". */
  load3d?: (() => Promise<{ mountTooth3d: (canvas: HTMLCanvasElement, opts: Tooth3dOptions) => Tooth3dHandle }>) | undefined;
}

export function ToothSheet({ model, tooth, onBack, embedded = false, load3d }: ToothSheetProps): ReactElement {
  const c = useMemo(() => sheetContent(model, tooth), [model, tooth]);
  const tf: ToothFacts | undefined = model.teeth.find((t) => t.tooth === tooth);
  const record = tf?.record;
  const { art, failed } = useSheetArt(c, tooth);
  const back = useRef<HTMLButtonElement>(null);
  const goBack = useEffectEvent(() => { onBack?.(); });
  useEffect(() => {
    if (embedded) return;
    back.current?.focus({ preventScroll: true });
    // Esc goes back to the map; it never leaves Present
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); goBack(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, [embedded]);

  const pair = useMemo(() => {
    if (art === undefined) return undefined;
    const g = Math.max(growOf(art, c.now), 0);
    const one = (view: ViewName): Scene => {
      if (c.wisdom && view === "section" && art.wisdom !== undefined && isEruption(record?.details?.eruption)) {
        const ang = record.details.angulation;
        return eruptionScene(art.tooth, art.neighbour, art.wisdom, record.details.eruption, isAngulation(ang) ? ang : undefined, { fdi: tooth, shapes: art.shapes });
      }
      return stateScene(art, c.now, view, record, tooth, g);
    };
    return { top: one("top"), section: one("section") };
  }, [art, c, record, tooth]);

  const compare = useMemo(() => {
    if (art === undefined || c.after === undefined) return undefined;
    const afterStage = c.after.kind === "stage" ? art.stages[c.after.model]?.scenes[c.after.step] : undefined;
    const view: ViewName = afterStage?.view ?? "section";
    const g = Math.max(growOf(art, c.now), growOf(art, c.after));
    return { a: stateScene(art, c.now, view, record, tooth, g), b: stateScene(art, c.after, view, record, tooth, g) };
  }, [art, c, record, tooth]);

  // 3D: lazy, mounted in the sheet on the first tap
  const [want3d, setWant3d] = useState(false);
  const [no3d, setNo3d] = useState(false);
  const [webgl] = useState(() => load3d !== undefined && hasWebGL());
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<Tooth3dHandle | undefined>(undefined);
  const stage3d = c.now.kind === "stage" ? { model: c.now.model, step: c.now.step, ...(record?.material === undefined ? {} : { material: record.material }) } : null;
  const opts = (): Tooth3dOptions => ({ fdi: tooth, view: "inside", labels: true, reducedMotion: false, details: details3d(record), stage: stage3d });
  const optsNow = useEffectEvent(opts);
  useEffect(() => {
    if (!want3d || load3d === undefined) return;
    let live = true;
    void load3d().then((mod) => {
      const el = canvas.current;
      if (!live || el === null || handle.current !== undefined) return;
      handle.current = mod.mountTooth3d(el, optsNow());
      if (!handle.current.ok) setNo3d(true);
    }, () => { setNo3d(true); });
    return () => { live = false; };
  }, [want3d, load3d]);
  useEffect(() => () => { handle.current?.dispose(); handle.current = undefined; }, []);
  const show3d = webgl && !no3d && record !== undefined;

  const label = `${c.where}, ${String(tooth)}`;
  const recordedWords = c.facts.length > 0 ? ["The pictures and this list come from this visit's record."] : [];
  return (
    <section className="ps-sheet" data-tooth-sheet={tooth} aria-label={label}>
      {embedded ? null : <button ref={back} type="button" className="pm-chip ps-sheet-back" onClick={onBack}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Back to the map
      </button>}
      <header className="ps-sheet-head">
        <h3 className="ps-sheet-title">{`${c.where} · ${String(tooth)}`}</h3>
        {c.facts.length === 0 ? <p className="ps-muted">{c.recorded_tooth ? "Nothing to treat is recorded on this tooth." : "Nothing was recorded for this tooth at this visit. That doesn't mean it is healthy or unhealthy."}</p> : (
          <ul className="ps-sheet-facts">
            {c.facts.map((f) => (
              <li key={f.id} className="ps-fact" data-kind={f.kind} data-fact={f.id}><b>{f.words}</b><RecordBadge on={f.recorded_on} /></li>
            ))}
          </ul>
        )}
      </header>

      <div className="ps-sheet-art">
        {failed ? <p className="ps-muted" role="status" data-art-failed="">The pictures didn't load. The record is listed above.</p> : pair === undefined ? <div className="ps-wait" role="status" aria-label="Loading the pictures" /> : (
          <>
            <div className="ps-pair" data-pair="">
              <figure className="ps-pic" data-view="top"><div className="ps-pic-art"><ArtSvg scene={pair.top} label={`${label}, seen from the biting side`} /></div><figcaption>Biting side</figcaption></figure>
              <figure className="ps-pic" data-view="section"><div className="ps-pic-art"><ArtSvg scene={pair.section} label={`${label}, cut open`} /></div><figcaption>Cut open</figcaption></figure>
            </div>
            <div className="ps-caption">
              <IllustrationBadge>Painting based on your record</IllustrationBadge>
              {c.wisdom ? null : c.recorded_tooth ? null : <IllustrationBadge>Example, not your tooth</IllustrationBadge>}
            </div>
            <canvas ref={canvas} className="ps-3d" hidden={!want3d || no3d} aria-label={`${label} in 3D`} />
            {show3d ? <button type="button" className="pm-chip ps-3d-btn" aria-pressed={want3d} onClick={() => { setWant3d(!want3d); }}>{want3d ? "Hide 3D" : "See in 3D"}</button> : null}
          </>
        )}
      </div>

      {compare === undefined || c.after === undefined ? null : (
        <section className="ps-sheet-compare" aria-label="Before and after">
          <h4 className="ps-h">Before and after</h4>
          <CompareSlider a={compare.a} b={compare.b} label={label} aWords="Now" bWords={c.afterWords ?? "After the next step"}
            aBadge={<RecordBadge />} bBadge={<IllustrationBadge>Illustration of the planned step</IllustrationBadge>} />
        </section>
      )}

      {c.recorded.length === 0 ? null : (
        <section className="ps-sheet-steps" aria-label="Recorded steps">
          <h4 className="ps-h">{c.treatment === undefined ? "Recorded steps" : `${c.treatment}: recorded steps`}</h4>
          <ol className="ps-steps">
            {c.recorded.map((s) => (
              <li key={s.key} data-step-state={s.state}><b>{s.heading}</b> <span>{s.words}</span><RecordBadge /></li>
            ))}
          </ol>
        </section>
      )}

      {c.usual.length === 0 ? null : (
        <section className="ps-sheet-usual" aria-label="Usual plan">
          <h4 className="ps-h">Usual plan · general guidance</h4>
          <p className="ps-muted">{`What usually happens for ${c.treatment === undefined ? "this treatment" : `a ${c.treatment.toLowerCase()}`}. Your dentist will confirm the real plan.`}</p>
          <ol className="ps-steps" data-usual="">
            {c.usual.map((s) => <li key={s.key}><span>{s.words}</span></li>)}
          </ol>
          <IllustrationBadge>Illustration · general guidance</IllustrationBadge>
        </section>
      )}
      <ProvenanceFooter recorded={recordedWords} illustration={["Tooth shapes and colours are a painting based on your record, not a photo."]} />
    </section>
  );
}
