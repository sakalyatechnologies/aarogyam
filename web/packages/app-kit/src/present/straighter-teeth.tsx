// "Straighter teeth" (present-studio-design §8.5, slice 3c): the usual braces or aligners case drawn on the example
// arch, one picture with a chip per step. Example teeth, never the patient's. A lazy chunk: it carries the front atlas.
import { useEffect, useRef, useState, type ReactElement } from "react";

import { IllustrationBadge, ProvenanceFooter } from "./blocks.js";
import type { CaseData } from "./case.js";
import { exampleScene, paintExampleArch, type Appliance } from "./example-arch.js";

/** How far along each step is: the teeth start crowded and finish straight. */
export const STEP_PROGRESS: Readonly<Record<string, number>> = { today: 0, month3: .35, month9: .75, finish: 1, retainer: 1 };
/** The appliance on show: braces or aligners until the finish, then nothing, then the retainer wire. */
export const applianceOf = (caseKey: string, step: string): Appliance =>
  step === "retainer" ? "retainer" : step === "finish" ? "none" : caseKey === "aligners" ? "aligners" : "braces";

const reduced = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const [, , BW, BH] = exampleScene(0).box;

export function StraighterTeeth({ data }: { data: CaseData }): ReactElement {
  const [step, setStep] = useState(data.steps[0]?.key ?? "today");
  const target = STEP_PROGRESS[step] ?? 0;
  const [progress, setProgress] = useState(target);
  const now = useRef(progress);
  useEffect(() => {
    // reduced motion: jump in one frame; otherwise glide for a third of a second
    const dur = reduced() ? 0 : 350;
    const start = performance.now(), a = now.current;
    let id = 0;
    const tick = (t: number) => {
      const u = dur === 0 ? 1 : Math.min(1, (t - start) / dur);
      now.current = a + (target - a) * u;
      setProgress(now.current);
      if (u < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); };
  }, [target]);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { setWidth(Math.round(el.clientWidth)); });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  const appliance = applianceOf(data.key, step);
  useEffect(() => {
    const c = canvas.current;
    if (c === null || width === 0 || typeof Path2D === "undefined") return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(width * dpr * BH / BW);
    const theme = wrap.current?.closest("[data-mv-theme]")?.getAttribute("data-mv-theme") === "dark" ? "dark" : "light";
    paintExampleArch(c, { progress, appliance, theme });
    c.dataset["painted"] = "";
  }, [progress, appliance, width]);
  const current = data.steps.find((s) => s.key === step);
  return (
    <section className="ps-straight" data-case={data.key} data-step={step} aria-label={data.title}>
      <h4 className="ps-h">{data.title}</h4>
      <p className="ps-muted">{data.lead}</p>
      <div className="ps-seg" role="group" aria-label="Steps">
        {data.steps.map((s) => (
          <button key={s.key} type="button" data-step-chip={s.key} aria-pressed={s.key === step} onClick={() => { setStep(s.key); }}>{s.label}</button>
        ))}
      </div>
      <div className="ps-map" ref={wrap} style={{ aspectRatio: `${BW.toFixed(2)} / ${BH.toFixed(2)}` }}>
        <canvas ref={canvas} className="ps-canvas" role="img" aria-label={`Example teeth, ${current?.label ?? ""}: ${current?.words ?? ""}`} />
      </div>
      <p className="ps-straight-words" aria-live="polite">{current?.words}</p>
      <IllustrationBadge>Example teeth, not yours</IllustrationBadge>
      <ProvenanceFooter recorded={[]} illustration={["Illustration · general guidance. How long it takes depends on the person."]} />
    </section>
  );
}
