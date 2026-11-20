// Tiny React wrappers over the framework-free scenes.
import { useEffect, useId, useRef, useState, type ReactElement } from "react";

import { BAND_INFO, LOOP_MS, PHASE_CAPTION, brushingPose, brushingScene, type BrushPhase } from "./brushing.js";
import { pathAttrs } from "./render.js";
import type { BrushingBand } from "./stage-steps.js";
import type { BrushingArt, Matrix, Scene } from "./types.js";

const mat = (m: Matrix) => `matrix(${m.map((v) => String(Math.round(v * 1000) / 1000)).join(" ")})`;
const toProps = (a: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out;
};

export interface ArtSvgProps {
  scene: Scene;
  /** Accessible name; omit for decorative art inside a labelled control. */
  label?: string;
  className?: string;
  labelColor?: string;
}

/** Renders a resolved Scene as inline SVG. */
export function ArtSvg({ scene, label, className, labelColor = "currentColor" }: ArtSvgProps): ReactElement {
  const pre = useId().replace(/:/g, "") + "-";
  const [x, y, w, h] = scene.box;
  return (
    <svg viewBox={`${String(x)} ${String(y)} ${String(w)} ${String(h)}`} className={className} role={label === undefined ? "presentation" : "img"} aria-label={label} aria-hidden={label === undefined ? true : undefined}>
      <defs>
        {scene.gradients.map((g) => {
          const id = pre + g.id;
          const stops = g.spec.s.map((s, i) => <stop key={i} offset={s[0]} stopColor={g.colors[i]} />);
          if (g.spec.t === "l") return <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={g.spec.x1} y1={g.spec.y1} x2={g.spec.x2} y2={g.spec.y2}>{stops}</linearGradient>;
          const { cx, cy, r, sy } = g.spec;
          const tf = sy !== undefined && sy !== 1 ? `translate(${String(cx)} ${String(cy)}) scale(1 ${String(sy)}) translate(${String(-cx)} ${String(-cy)})` : undefined;
          return <radialGradient key={id} id={id} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r} gradientTransform={tf}>{stops}</radialGradient>;
        })}
        {Object.entries(scene.clips).map(([id, c]) => <clipPath key={id} id={pre + id} clipPathUnits="userSpaceOnUse"><path d={c.d} /></clipPath>)}
      </defs>
      <g transform={scene.outer ? mat(scene.outer) : undefined}>
        {scene.nodes.map((node, i) => {
          let el = <path key={i} {...toProps(pathAttrs(node, pre))} />;
          if (node.clip !== undefined) el = <g key={i} clipPath={`url(#${pre}${node.clip})`}>{el}</g>;
          if (node.group) el = <g key={i} transform={mat(node.group)}>{el}</g>;
          return el;
        })}
      </g>
      {scene.labels.map((l, i) => (
        <text key={i} x={l.x} y={l.y} textAnchor={l.anchor ?? "middle"} fontSize={Math.max(5, w * 0.075)} fontWeight={700} fill={labelColor} stroke="var(--ma-label-halo, #fff)" strokeWidth={w * 0.018} paintOrder="stroke" fontFamily="system-ui, sans-serif">{l.text}</text>
      ))}
    </svg>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => { setReduced(mq.matches); };
    mq.addEventListener("change", on);
    return () => { mq.removeEventListener("change", on); };
  }, []);
  return reduced;
}

export interface BrushingAnimationProps {
  art: BrushingArt;
  band: BrushingBand;
  /** FDI of a tooth to highlight softly. */
  highlight?: number;
  /** Force stills (otherwise follows prefers-reduced-motion). */
  reducedMotion?: boolean;
  className?: string;
}

const STILLS: BrushPhase[] = ["outer", "inner", "chewing"];

/**
 * The care-at-home brushing loop with a Pause/Play toggle (WCAG 2.2.2), or three captioned stills
 * under reduced motion.
 */
export function BrushingAnimation({ art, band, highlight, reducedMotion, className }: BrushingAnimationProps): ReactElement {
  const prefersReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? prefersReduced;
  const [paused, setPaused] = useState(false);
  const [t, setT] = useState(0);
  const start = useRef<number | undefined>(undefined);
  const info = BAND_INFO[band];
  const hl = highlight === undefined ? {} : { highlight };

  useEffect(() => {
    if (reduced || paused) return;
    let raf = 0;
    const base = performance.now() - t;
    start.current = base;
    const tick = (now: number) => {
      setT((now - base) % LOOP_MS);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); };
    // t is read once when (re)starting so Play resumes where Pause stopped
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, paused]);

  if (reduced) {
    const phases = STILLS;
    return (
      <div className={className} data-brushing-stills="">
        {phases.map((phase, i) => {
          const per = LOOP_MS / info.phases.length;
          const idx = info.phases.indexOf(phase);
          const pose = brushingPose(band, idx * per + per / 2, true);
          const cap = PHASE_CAPTION[phase];
          const floss = phase === "chewing" && info.phases.includes("floss") ? " Then floss once a day." : "";
          return (
            <figure key={phase}>
              <ArtSvg scene={brushingScene(art, band, pose, hl)} label={`${cap.title}: ${cap.text}`} />
              <figcaption><strong>{`${String(i + 1)} · ${cap.title}`}</strong> {cap.text + floss}</figcaption>
            </figure>
          );
        })}
      </div>
    );
  }
  const pose = brushingPose(band, t);
  const cap = PHASE_CAPTION[pose.phase];
  return (
    <div className={className} data-brushing-animation="">
      <ArtSvg scene={brushingScene(art, band, pose, hl)} label={info.title} />
      <p aria-live={paused ? "polite" : "off"}><strong>{cap.title}</strong> {cap.text}</p>
      <button type="button" aria-pressed={paused} onClick={() => { setPaused((p) => !p); }}>
        Pause
      </button>
    </div>
  );
}
