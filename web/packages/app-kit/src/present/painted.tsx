// The painted style (present-studio-design §6.2), a lazy chunk with the front atlas inside it: the
// painted map with a numbered dot on each recorded tooth, the "What we found" list beside it and the
// provenance footer. The orientation and colour knobs are session-only and change no recorded fact.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

import { FRONT_ATLAS } from "../mouth-art/gen/front-atlas.js";
import { FactList, IllustrationBadge, ProvenanceFooter, dotsOf } from "./blocks.js";
import type { Orientation, PresentModel } from "./model.js";
import { SHADE_KNOBS, dotAt, paintSmile, smileScene, toothRect, type ShadeKnob } from "./painter.js";

export interface PaintedProps {
  model: PresentModel;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  shade: ShadeKnob;
  onShade: (s: ShadeKnob) => void;
  theme: "light" | "dark";
  /** Opens the tooth's detail (MouthView's tooth screen). */
  onOpen: (tooth: number) => void;
}

const f2 = (n: number) => n.toFixed(2);

export function PaintedMap({ model, orientation, shade, theme, onOpen }: Pick<PaintedProps, "model" | "orientation" | "shade" | "theme" | "onOpen">): ReactElement {
  const scene = useMemo(() => smileScene(model, FRONT_ATLAS, orientation), [model, orientation]);
  const dots = useMemo(() => dotsOf(model), [model]);
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
  useEffect(() => {
    const c = canvas.current;
    if (c === null || width === 0 || typeof Path2D === "undefined") return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(width * dpr * scene.box[3] / scene.box[2]);
    paintSmile(c, scene, FRONT_ATLAS, { shade, theme });
    c.dataset["painted"] = "";
  }, [scene, shade, theme, width]);
  const [bx, by, bw, bh] = scene.box;
  const r = bw * .021;
  const key = (e: KeyboardEvent, tooth: number) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(tooth); } };
  const examples = scene.teeth.filter((t) => t.example && !t.hidden);
  return (
    <div className="ps-map" ref={wrap} style={{ aspectRatio: `${f2(bw)} / ${f2(bh)}` }} data-orientation={orientation}>
      <canvas ref={canvas} className="ps-canvas" role="img" aria-label={`Painting of the teeth based on the record, ${orientation === "mirror" ? "as in a mirror" : "as in a photo"}`} />
      <svg className="ps-ov" viewBox={`${f2(bx)} ${f2(by)} ${f2(bw)} ${f2(bh)}`} preserveAspectRatio="none">
        <g aria-hidden="true">
          {scene.teeth.filter((t) => !t.hidden).map((t) => {
            const b = toothRect(scene, t);
            return <rect key={t.fdi} className="ps-hit" data-fdi={t.fdi} x={f2(b.x)} y={f2(b.y)} width={f2(b.w)} height={f2(b.h)} onClick={() => { onOpen(t.fdi); }} />;
          })}
          {examples.map((t) => {
            const b = toothRect(scene, t);
            return <rect key={`ex${String(t.fdi)}`} className="ps-example-ring" x={f2(b.x + .2)} y={f2(b.y + (t.arch === "u" ? 2 : 0))} width={f2(b.w - .4)} height={f2(b.h - 2)} rx="1.2" />;
          })}
        </g>
        {dots.map((d) => {
          const at = dotAt(scene, d.tooth);
          if (at === undefined) return null;
          return (
            <g key={d.tooth} className="ps-dot" data-tone={d.tone} data-tooth={d.tooth} role="button" tabIndex={0} aria-label={d.label}
              onClick={() => { onOpen(d.tooth); }} onKeyDown={(e) => { key(e, d.tooth); }}>
              <circle className="ps-dot-halo" cx={f2(at.x)} cy={f2(at.y)} r={f2(r * 1.35)} />
              <circle className="ps-dot-fill" cx={f2(at.x)} cy={f2(at.y)} r={f2(r)} />
              <text x={f2(at.x)} y={f2(at.y)} fontSize={f2(r * 1.15)} textAnchor="middle" dominantBaseline="central">{d.n}</text>
            </g>
          );
        })}
      </svg>
      <IllustrationBadge className="ps-on-art">Painting based on your record</IllustrationBadge>
      {examples.length === 0 ? null : <IllustrationBadge className="ps-on-art ps-on-art-end">Wisdom teeth: example, not your tooth</IllustrationBadge>}
    </div>
  );
}

export function PaintedStyle(props: PaintedProps): ReactElement {
  const { model, orientation, onOrientation, shade, onShade } = props;
  const faded = model.teeth.some((t) => t.shown === "not_recorded");
  const dots = dotsOf(model);
  const illustration = [
    "Tooth shapes, colours and the grey frame are a painting based on your record, not a photo.",
    ...(faded ? ["Faded teeth have nothing recorded yet."] : []),
  ];
  return (
    <div className="ps-painted" data-present-style="painted">
      <div className="ps-stage">
        <div className="ps-knobs">
          <div className="ps-seg" role="group" aria-label="Which way round">
            {(["mirror", "photo"] as const).map((o) => (
              <button key={o} type="button" aria-pressed={orientation === o} onClick={() => { onOrientation(o); }}>{o === "mirror" ? "As in your mirror" : "As in a photo"}</button>
            ))}
          </div>
          <div className="ps-shades" role="group" aria-label="Tooth colour">
            {SHADE_KNOBS.map((s) => (
              <button key={s.key} type="button" className="ps-swatch" style={{ background: s.swatch }} aria-pressed={shade === s.key} aria-label={s.label} title={s.label} onClick={() => { onShade(s.key); }} />
            ))}
            <IllustrationBadge>Colour chosen to look like you</IllustrationBadge>
          </div>
        </div>
        <PaintedMap {...props} />
        <p className="ps-muted ps-hint">{dots.length === 0 ? "Nothing is recorded for this visit yet. Tap any tooth to look closer." : "Tap a numbered dot or any tooth to look closer."}</p>
      </div>
      <div className="ps-side">
        <FactList model={model} onOpen={props.onOpen} />
        <ProvenanceFooter recorded={["The dots and this list come from this visit's record."]} illustration={illustration} />
      </div>
    </div>
  );
}

/** The style module's shape (§6): id, label and what it draws. */
export const paintedStyle = { id: "painted" as const, label: "Painted smile", Component: PaintedStyle };
