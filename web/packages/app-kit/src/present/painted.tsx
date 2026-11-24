// The painted style (present-studio-design §6.2), a lazy chunk with the front atlas inside it: the
// painted map with a numbered dot on each recorded tooth, the "What we found" list beside it and the
// provenance footer, plus Open wide one tap away (slice 1b). The orientation and colour knobs and the
// view are session-only and change no recorded fact.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

import { FRONT_ATLAS } from "../mouth-art/gen/front-atlas.js";
import { FactList, IllustrationBadge, ProvenanceFooter, dotsOf } from "./blocks.js";
import type { Orientation, PresentModel } from "./model.js";
import { OpenWide, bitingSideProblems, frontHidesAllProblems } from "./open-wide.js";
import { ToothSheet, type ToothSheetProps } from "./tooth-sheet.js";
import { dotAt, paintSmile, smileScene, spread, toothRect, type Shade } from "./painter.js";

export interface PaintedProps {
  model: PresentModel;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  shade: Shade;
  onShade: (s: Shade) => void;
  /** The colour differs from the one saved for the patient: offers "Save colour" (with `onSaveShade`). */
  shadeDirty?: boolean | undefined;
  onSaveShade?: (() => void) | undefined;
  savingShade?: boolean | undefined;
  theme: "light" | "dark";
  /** Opens the tooth's detail (MouthView's tooth screen). */
  onOpen: (tooth: number) => void;
  /** The front map or Open wide; undefined = the §6.2 rule (Open wide when the front hides every problem). */
  view?: PaintedView | undefined;
  onView?: ((v: PaintedView) => void) | undefined;
  /** Present's tooth sheet: a tap opens it in place of the map, with "Back to the map". Without it, `onOpen` gets the tap. */
  toothSheet?: boolean | undefined;
  load3d?: ToothSheetProps["load3d"];
}

export type PaintedView = "front" | "wide";

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
  // dots stay at least 26 px across on a phone
  const r = Math.max(bw * .02, width > 0 ? 11 * bw / width : 0);
  const key = (e: KeyboardEvent, tooth: number) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(tooth); } };
  const examples = scene.teeth.filter((t) => t.example && !t.hidden);
  const placed = spread(dots.flatMap((d) => {
    const at = dotAt(scene, d.tooth);
    return at === undefined ? [] : [{ ...d, ...at, upper: Math.floor(d.tooth / 10) % 4 === 1 || Math.floor(d.tooth / 10) % 4 === 2 }];
  }), r * 2.8);
  return (
    <>
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
        {placed.map((d) => {
          return (
            <g key={d.tooth} className="ps-dot" data-tone={d.tone} data-tooth={d.tooth} role="button" tabIndex={0} aria-label={d.label}
              onClick={() => { onOpen(d.tooth); }} onKeyDown={(e) => { key(e, d.tooth); }}>
              <circle className="ps-dot-halo" cx={f2(d.x)} cy={f2(d.y)} r={f2(r * 1.35)} />
              <circle className="ps-dot-fill" cx={f2(d.x)} cy={f2(d.y)} r={f2(r)} />
              <text x={f2(d.x)} y={f2(d.y)} fontSize={f2(r * 1.15)} textAnchor="middle" dominantBaseline="central">{d.n}</text>
            </g>
          );
        })}
      </svg>
    </div>
    <div className="ps-caption">
      <IllustrationBadge>Painting based on your record</IllustrationBadge>
      {examples.length === 0 ? null : <IllustrationBadge>Wisdom teeth: example, not your tooth</IllustrationBadge>}
      <span className="ps-muted">{dots.length === 0 ? "Nothing is recorded for this visit yet. Tap any tooth to look closer." : "Tap a numbered dot or any tooth to look closer."}</span>
    </div>
    </>
  );
}

export function PaintedStyle(props: PaintedProps): ReactElement {
  const { model, orientation } = props;
  // §6.2: when the front map would hide every recorded problem, open on Open wide
  const auto: PaintedView = frontHidesAllProblems(model) ? "wide" : "front";
  const [own, setOwn] = useState<PaintedView | undefined>(undefined);
  const view = props.view ?? own ?? auto;
  const setView = (v: PaintedView) => { setOwn(v); props.onView?.(v); };
  const hidden = bitingSideProblems(model);
  const faded = model.teeth.some((t) => t.shown === "not_recorded");
  const illustration = [
    view === "wide"
      ? "Tooth shapes, colours, the gums and the palate are a painting based on your record, seen from the biting side."
      : "Tooth shapes, colours and the grey frame are a painting based on your record, not a photo.",
    ...(faded ? ["Faded teeth have nothing recorded yet."] : []),
  ];
  const openWide = () => { setView("wide"); };
  const [sheet, setSheet] = useState<number | undefined>(undefined);
  const open = props.toothSheet === true ? setSheet : props.onOpen;
  if (sheet !== undefined) return <div className="ps-painted ps-painted-sheet" data-present-style="painted" data-view="sheet"><ToothSheet model={model} tooth={sheet} load3d={props.load3d} onBack={() => { setSheet(undefined); }} /></div>;
  return (
    <div className="ps-painted" data-present-style="painted" data-view={view}>
      <div className="ps-stage">
        <div className="ps-knobs">
          <div className="ps-seg" role="group" aria-label="Picture">
            <button type="button" aria-pressed={view === "front"} onClick={() => { setView("front"); }}>Front</button>
            <button type="button" aria-pressed={view === "wide"} onClick={openWide}>Open wide</button>
          </div>
        </div>
        {view === "front" && hidden.length > 0 ? (
          <button type="button" className="ps-prompt" onClick={openWide}>
            <span>{hidden.length === 1 ? "1 problem is on the biting side, out of sight from the front." : `${String(hidden.length)} problems are on the biting side, out of sight from the front.`}</span>
            <b>Open wide to see {hidden.length === 1 ? "it" : "them"}</b>
          </button>
        ) : null}
        {view === "wide" ? <OpenWide model={model} orientation={orientation} theme={props.theme} onOpen={open} /> : <PaintedMap {...props} onOpen={open} />}
      </div>
      <div className="ps-side">
        <FactList model={model} onOpen={open} onBitingSide={view === "front" ? openWide : undefined} />
        <ProvenanceFooter recorded={["The dots and this list come from this visit's record."]} illustration={illustration} />
      </div>
    </div>
  );
}

/** The style module's shape (§6): id, label and what it draws. */
export const paintedStyle = { id: "painted" as const, label: "Painted smile", Component: PaintedStyle };
