// Open wide (present-studio-design §5.3, §6.2): both arches seen from the biting side, where most decay,
// gaps and fillings show. Built from the kit's `top` tooth art placed by `archLayout`, on a neutral palate
// and gum frame. It carries the same numbered dots and numbering as the painted map ("What we found"),
// only on recorded items, and follows the mirror/photo knob. A shared block: the painted style shows it
// one tap from the front map, and other styles can load it with `loadOpenWide()`.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

import { archLayout, type ArchSlot } from "../mouth-art/arch.js";
import { loadShapes, loadToothArt } from "../mouth-art/loaders.js";
import { overlayPart, type Overlay } from "../mouth-art/overlays.js";
import { ArtSvg } from "../mouth-art/react.js";
import { toothScene } from "../mouth-art/scene.js";
import { TOOTH_TYPES, type ShapeSet, type ToothArt, type ToothType } from "../mouth-art/types.js";
import { IllustrationBadge, dotsOf } from "./blocks.js";
import type { FactItem, Orientation, PresentModel, ToothFacts } from "./model.js";
import { spread } from "./painter.js";

/** Layout width in SVG units (the mouth view's arch width). */
export const WIDE_W = 360;
const PAD = 26;
const TYPES: readonly ToothType[] = TOOTH_TYPES;
const DETAIL_ONLY = new Set<Overlay["kind"]>(["infection", "bleeding", "pocket", "mobility"]);

export interface WideTooth {
  fdi: number;
  type: ToothType;
  upper: boolean;
  /** Photo coordinates (the patient's right on the left); `wideX` turns them for the knob. */
  slot: ArchSlot;
  /** Half the drawn size. */
  r: number;
  /** Outward (cheek side) unit normal, photo coordinates. */
  nx: number;
  ny: number;
  missing: boolean;
  /** Nothing recorded at this position: drawn faded. */
  faded: boolean;
  /** Impacted or not through: not seen from the biting side, so only a dashed outline. */
  under: boolean;
  partial: boolean;
  /** A wisdom tooth drawn without an eruption record ("Example, not your tooth"). */
  example: boolean;
  /** The recorded overlays the top view can show (decay on its surface, fillings, crowns…). */
  draw: Overlay[];
}

export interface WideScene {
  teeth: WideTooth[];
  mirror: boolean;
  /** viewBox: x, y, width, height. */
  box: [number, number, number, number];
  /** Between the arches, for the side labels. */
  midY: number;
  /** Where the upper arch's front teeth are (top) and the lower's (bottom), for the arch labels. */
  upperTop: number;
  lowerBottom: number;
}

const wisdom = (t: ToothFacts) => t.index === 8 && t.type.length === 2;

/** The Open wide picture's layout: pure, so a test can check every recorded problem sits in frame. */
export function openWideScene(model: PresentModel, orientation: Orientation): WideScene {
  // an unrecorded wisdom position isn't drawn, as on the front map
  const shown = model.teeth.filter((t) => !(wisdom(t) && t.shown === "not_recorded"));
  const lay = archLayout(shown.map((t) => t.tooth), { width: WIDE_W, between: 30, gapMm: 0.5, depth: 1 });
  const slotOf = new Map(lay.slots.map((s) => [s.fdi, s]));
  const upperSlots = lay.slots.filter((s) => s.type.startsWith("u") || s.type.startsWith("pu"));
  const lowerSlots = lay.slots.filter((s) => !upperSlots.includes(s));
  const upperY = Math.max(...upperSlots.map((s) => s.y), 0);
  const lowerY = Math.min(...lowerSlots.map((s) => s.y), lay.height);
  const teeth: WideTooth[] = [];
  for (const t of shown) {
    const slot = slotOf.get(t.tooth);
    if (slot === undefined) continue;
    const upper = t.quadrant <= 2;
    const cy = upper ? upperY + 14 : lowerY - 14;
    const dx = slot.x - WIDE_W / 2, dy = slot.y - cy, len = Math.hypot(dx, dy) || 1;
    const recorded = t.shown !== "not_recorded";
    teeth.push({
      fdi: t.tooth, type: slot.type, upper, slot, r: Math.max(slot.w, slot.h) / 2, nx: dx / len, ny: dy / len,
      missing: t.missing, faded: !recorded,
      under: !t.missing && (t.eruption === "impacted" || t.eruption === "unerupted"),
      partial: t.eruption === "partial",
      example: wisdom(t) && recorded && !t.missing && t.eruption === undefined,
      draw: t.missing ? [] : t.draw.filter((o) => !DETAIL_ONLY.has(o.kind) && o.kind !== "missing"),
    });
  }
  const top = Math.min(...teeth.map((t) => t.slot.y - t.r), 0);
  const bottom = Math.max(...teeth.map((t) => t.slot.y + t.r), lay.height);
  const upMax = Math.max(...teeth.filter((t) => t.upper).map((t) => t.slot.y + t.slot.h / 2), top);
  const loMin = Math.min(...teeth.filter((t) => !t.upper).map((t) => t.slot.y - t.slot.h / 2), bottom);
  return {
    teeth, mirror: orientation === "mirror",
    box: [-PAD, top - PAD, WIDE_W + 2 * PAD, bottom - top + 2 * PAD],
    midY: (upMax + loMin) / 2, upperTop: top, lowerBottom: bottom,
  };
}

/** Screen x for a photo-coordinate x: mirror (the default) puts the patient's right on the right. */
export const wideX = (scene: WideScene, x: number): number => (scene.mirror ? WIDE_W - x : x);

/** Where a tooth's dot sits: just outside the tooth on the cheek side, so the dot never hides the decay. */
export function wideDotAt(scene: WideScene, fdi: number, dotR = 9): { x: number; y: number } | undefined {
  const t = scene.teeth.find((x) => x.fdi === fdi);
  if (t === undefined) return undefined;
  const k = t.r * .78 + dotR;
  const x = wideX(scene, t.slot.x + t.nx * k), y = t.slot.y + t.ny * k;
  const [bx, by, bw, bh] = scene.box;
  return { x: Math.min(bx + bw - dotR, Math.max(bx + dotR, x)), y: Math.min(by + bh - dotR, Math.max(by + dotR, y)) };
}

/** The recorded problems the front map can't show: decay recorded on the biting surface only. */
export function bitingSideProblems(model: PresentModel): FactItem[] {
  return model.facts.filter((f) => f.kind === "problem" && f.biting_side === true);
}

/** §6.2 degrade: every recorded problem is out of the front map's view, so Show patient opens on Open wide. */
export function frontHidesAllProblems(model: PresentModel): boolean {
  const problems = model.facts.filter((f) => f.kind === "problem");
  return problems.length > 0 && problems.every((f) => f.biting_side === true);
}

/* ---------- art ---------- */

export interface WideArt { teeth: ReadonlyMap<ToothType, ToothArt>; shapes: ShapeSet }

/** Loads the top-view art Open wide draws (the same chunks MouthView prefetches). */
export async function loadWideArt(model: PresentModel): Promise<WideArt> {
  return loadTypes([...new Set(model.teeth.map((t) => t.type))]);
}

async function loadTypes(types: readonly ToothType[]): Promise<WideArt> {
  const [shapes, list] = await Promise.all([loadShapes(), Promise.all(types.map(async (t) => [t, await loadToothArt(t)] as const))]);
  return { teeth: new Map(list), shapes };
}

function useWideArt(model: PresentModel, given: WideArt | undefined): { art: WideArt | undefined; failed: boolean; retry: () => void } {
  const types = [...new Set(model.teeth.map((t) => t.type))];
  const sig = types.join(",");
  const [state, setState] = useState<{ sig: string; art?: WideArt; failed?: boolean; attempt: number }>({ sig: "", attempt: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    const wanted = TYPES.filter((t) => sig.split(",").includes(t));
    loadTypes(wanted).then(
      (art) => { if (live) setState({ sig, art, attempt }); },
      () => { if (live) setState({ sig, failed: true, attempt }); },
    );
    return () => { live = false; };
  }, [sig, attempt, given]);
  if (given !== undefined) return { art: given, failed: false, retry: () => undefined };
  const current = state.sig === sig && state.attempt === attempt ? state : undefined;
  return { art: current?.art, failed: current?.failed === true, retry: () => { setAttempt((n) => n + 1); } };
}

/* ---------- the block ---------- */

export interface OpenWideProps {
  model: PresentModel;
  orientation: Orientation;
  theme: "light" | "dark";
  onOpen: (tooth: number) => void;
  /** Already loaded art (tests, or a style that loaded it); otherwise Open wide loads it. */
  art?: WideArt | undefined;
}

const f2 = (n: number) => n.toFixed(2);
const pts = (list: readonly { x: number; y: number }[]) => list.map((p) => `${f2(p.x)},${f2(p.y)}`).join(" ");

export function OpenWide({ model, orientation, onOpen, art: given }: OpenWideProps): ReactElement {
  const scene = useMemo(() => openWideScene(model, orientation), [model, orientation]);
  const dots = useMemo(() => dotsOf(model), [model]);
  const { art, failed, retry } = useWideArt(model, given);
  const uid = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { setWidth(Math.round(el.clientWidth)); });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  const [bx, by, bw, bh] = scene.box;
  // dots stay at least 26 px across on a phone; words at least 12 px
  const r = Math.max(8.5, width > 0 ? 13 * bw / width : 0);
  const fs = Math.max(8.5, width > 0 ? 13 * bw / width : 0);
  const placed = spread(dots.flatMap((d) => {
    const at = wideDotAt(scene, d.tooth, r);
    const t = scene.teeth.find((x) => x.fdi === d.tooth);
    return at === undefined || t === undefined ? [] : [{ ...d, ...at, upper: t.upper, tx: wideX(scene, t.slot.x), ty: t.slot.y }];
  }), r * 2.5);
  const key = (e: KeyboardEvent, tooth: number) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(tooth); } };
  const flip = scene.mirror ? `translate(${String(WIDE_W)} 0) scale(-1 1)` : undefined;
  const upper = scene.teeth.filter((t) => t.upper), lower = scene.teeth.filter((t) => !t.upper);
  const band = Math.max(...scene.teeth.map((t) => t.r), 10) * 2.35;
  const centre = (list: WideTooth[]) => list.map((t) => ({ x: t.slot.x, y: t.slot.y }));
  const examples = scene.teeth.filter((t) => t.example);
  const right = scene.mirror ? WIDE_W + 4 : -4, left = scene.mirror ? -4 : WIDE_W + 4;
  return (
    <div className="ps-wide-wrap" data-present-block="open-wide">
      <div className="ps-wide" ref={wrap} data-orientation={orientation}>
        <svg className="ps-wide-svg" viewBox={`${f2(bx)} ${f2(by)} ${f2(bw)} ${f2(bh)}`} role="group"
          aria-label={`Both rows of teeth seen from the biting side, based on the record, ${orientation === "mirror" ? "as in a mirror" : "as in a photo"}`}>
          <defs>
            {/* the palate and floor fade out towards the throat, so the open end has no hard edge */}
            <linearGradient id={`${uid}-pal`} x1="0" y1={f2(scene.upperTop)} x2="0" y2={f2(scene.midY)} gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: "var(--ps-palate)" }} /><stop offset=".5" style={{ stopColor: "var(--ps-palate)" }} /><stop offset=".9" style={{ stopColor: "var(--ps-palate)", stopOpacity: 0 }} />
            </linearGradient>
            <linearGradient id={`${uid}-flo`} x1="0" y1={f2(scene.lowerBottom)} x2="0" y2={f2(scene.midY)} gradientUnits="userSpaceOnUse">
              <stop offset="0" style={{ stopColor: "var(--ps-floor)" }} /><stop offset=".5" style={{ stopColor: "var(--ps-floor)" }} /><stop offset=".9" style={{ stopColor: "var(--ps-floor)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <g transform={flip} aria-hidden="true">
            {/* the neutral palate and floor, then one continuous gum along each arch */}
            <polygon points={pts(centre(upper))} fill={`url(#${uid}-pal)`} />
            <polygon points={pts(centre(lower))} fill={`url(#${uid}-flo)`} />
            <polyline className="ps-w-gum" points={pts(centre(upper))} strokeWidth={f2(band)} />
            <polyline className="ps-w-gum" points={pts(centre(lower))} strokeWidth={f2(band)} />
            {scene.teeth.map((t) => <WideToothArt key={t.fdi} t={t} art={art} />)}
            {examples.map((t) => <circle key={`ex${String(t.fdi)}`} className="ps-example-ring ps-w-ring" cx={f2(t.slot.x)} cy={f2(t.slot.y)} r={f2(t.r * .9)} />)}
          </g>
          <g aria-hidden="true">
            {scene.teeth.map((t) => (
              <circle key={t.fdi} className="ps-hit" data-fdi={t.fdi} cx={f2(wideX(scene, t.slot.x))} cy={f2(t.slot.y)} r={f2(t.r)} onClick={() => { onOpen(t.fdi); }} />
            ))}
            <text className="ps-w-label" x={f2(right)} y={f2(scene.midY)} fontSize={f2(fs)} textAnchor={scene.mirror ? "end" : "start"} dominantBaseline="central">Your right</text>
            <text className="ps-w-label" x={f2(left)} y={f2(scene.midY)} fontSize={f2(fs)} textAnchor={scene.mirror ? "start" : "end"} dominantBaseline="central">Your left</text>
            <text className="ps-w-arch" x={f2(WIDE_W / 2)} y={f2(scene.midY - fs * .9)} fontSize={f2(fs * .85)} textAnchor="middle">UPPER TEETH</text>
            <text className="ps-w-arch" x={f2(WIDE_W / 2)} y={f2(scene.midY + fs * 1.5)} fontSize={f2(fs * .85)} textAnchor="middle">LOWER TEETH</text>
          </g>
          {placed.map((d) => (
            <g key={d.tooth} className="ps-dot" data-tone={d.tone} data-tooth={d.tooth} role="button" tabIndex={0} aria-label={d.label}
              onClick={() => { onOpen(d.tooth); }} onKeyDown={(e) => { key(e, d.tooth); }}>
              <circle className="ps-dot-halo" cx={f2(d.x)} cy={f2(d.y)} r={f2(r * 1.3)} />
              <circle className="ps-dot-fill" cx={f2(d.x)} cy={f2(d.y)} r={f2(r)} />
              <text x={f2(d.x)} y={f2(d.y)} fontSize={f2(r * 1.15)} textAnchor="middle" dominantBaseline="central">{d.n}</text>
            </g>
          ))}
        </svg>
        {art === undefined && !failed ? <div className="ps-wide-wait" role="status" aria-label="Loading the picture" /> : null}
        {failed ? (
          <p className="ps-fallback-note ps-wide-failed" role="status">
            The picture didn't load. The list has the same record.
            <button type="button" className="ps-retry" onClick={retry}>Try again</button>
          </p>
        ) : null}
      </div>
      <div className="ps-caption">
        <IllustrationBadge>Painting based on your record</IllustrationBadge>
        {examples.length === 0 ? null : <IllustrationBadge>Wisdom teeth: example, not your tooth</IllustrationBadge>}
        <span className="ps-muted">Seen from the biting side, mouth open wide. Tap a numbered dot or any tooth to look closer.</span>
      </div>
    </div>
  );
}

function WideToothArt({ t, art }: { t: WideTooth; art: WideArt | undefined }): ReactElement {
  const { slot } = t;
  const xf = `translate(${f2(slot.x)} ${f2(slot.y)}) rotate(${f2(slot.angle)})`;
  if (t.missing) {
    // a gap: the healed gum ridge where the tooth was
    return <ellipse className="ps-w-ridge" cx={f2(slot.x)} cy={f2(slot.y)} rx={f2(slot.w * .42)} ry={f2(slot.h * .36)} transform={`rotate(${f2(slot.angle)} ${f2(slot.x)} ${f2(slot.y)})`} />;
  }
  const a = art?.teeth.get(t.type);
  if (a === undefined || art === undefined) {
    return <rect className="ps-w-wait" x={f2(slot.x - slot.w * .45)} y={f2(slot.y - slot.h * .43)} width={f2(slot.w * .9)} height={f2(slot.h * .86)} rx={f2(Math.min(slot.w, slot.h) * .34)} transform={`rotate(${f2(slot.angle)} ${f2(slot.x)} ${f2(slot.y)})`} />;
  }
  // the decay is marked so a test can see it sits on the recorded surface
  const sc = toothScene(a, "top", { fdi: t.fdi, shapes: art.shapes, mark: ["cariesLesion"], parts: t.draw.map((o) => overlayPart(a, "top", o)) });
  const [, , bw, bh] = sc.box;
  const k = slot.w / (bw - 12);
  const cls = t.under ? "ps-w-under" : t.faded ? "ps-w-faded" : t.partial ? "ps-w-partial" : undefined;
  return (
    <g transform={xf} className={cls} data-fdi={t.fdi}>
      <ArtSvg scene={sc} x={(-bw * k) / 2} y={(-bh * k) / 2} width={bw * k} height={bh * k} />
      {t.under ? <ellipse className="ps-w-under-ring" cx="0" cy="0" rx={f2(slot.w * .5)} ry={f2(slot.h * .46)} /> : null}
    </g>
  );
}
