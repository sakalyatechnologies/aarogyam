// MouthView (design §1.12): one component for the patient's visit page and the doctor's Present
// mode. Overview (every position, history, today's findings, planned work, legend) -> tap -> tooth
// detail (2D stage art, stepper, "What to expect") -> "Back to all teeth". It renders the server's
// MouthSnapshot as is; art loads lazily per tooth type and treatment model.
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from "react";

import { archLayout, type ArchSlot } from "../mouth-art/arch.js";
import { eruptionScene } from "../mouth-art/eruption.js";
import { loadShapes, loadStageArt, loadToothArt, neighborOf, toothTypeOf } from "../mouth-art/loaders.js";
import { overlayPart } from "../mouth-art/overlays.js";
import { ArtSvg } from "../mouth-art/react.js";
import { stagePart, toothScene } from "../mouth-art/scene.js";
import { STAGE_CALLOUTS, sceneArt, type StageModel } from "../mouth-art/stage-steps.js";
import type { Scene, ShapeSet, StageSet, ToothArt, ToothType, ViewName } from "../mouth-art/types.js";
import type { Tooth3dHandle, Tooth3dOptions } from "../real-teeth-3d/index.js";
import {
  FOUND_STEP, details3d, isAngulation, isEruption, archStates, dayLabel, isRecommended, isToday, todayLine, detailChips, detailOverlays, detailTitle, ifWaitFrames, mainTreatment, materialWords, originWords, overlaysFor, spokenLabel,
  stageParams, stateFor, stepLabels, stepOverlays, summaryCounts, toothInfo, usuallyText, withFoundStep, type Badge, type Chip, type PositionState, type Snapshot,
} from "./model.js";
import { waitScenes } from "./wait-scenes.js";

// ---------- lazy art, cached for the page's life ----------

type Req = { k: "tooth"; t: ToothType } | { k: "stage"; m: StageModel } | { k: "shapes" };
const teeth = new Map<ToothType, ToothArt>();
const stages = new Map<StageModel, StageSet>();
let shapesSet: ShapeSet | undefined;
const pending = new Map<string, Promise<void>>();
const keyOf = (r: Req) => (r.k === "tooth" ? `t:${r.t}` : r.k === "stage" ? `s:${r.m}` : "shapes");
const has = (r: Req) => (r.k === "tooth" ? teeth.has(r.t) : r.k === "stage" ? stages.has(r.m) : shapesSet !== undefined);
function fetchArt(r: Req): Promise<void> {
  if (r.k === "tooth") return loadToothArt(r.t).then((a) => { teeth.set(r.t, a); });
  if (r.k === "stage") return loadStageArt(r.m).then((s) => { stages.set(r.m, s); });
  return loadShapes().then((s) => { shapesSet = s; });
}
function ensure(r: Req): Promise<void> | undefined {
  if (has(r)) return undefined;
  const key = keyOf(r);
  let p = pending.get(key);
  if (p === undefined) {
    p = fetchArt(r).catch(() => { pending.delete(key); });
    pending.set(key, p);
  }
  return p;
}
function useAssets(reqs: readonly Req[]): void {
  const [, bump] = useState(0);
  const sig = reqs.map(keyOf).join("|");
  // the request list changes identity every render; its signature is what matters
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => reqs, [sig]);
  useEffect(() => {
    let live = true;
    const waits = list.map(ensure).filter((p): p is Promise<void> => p !== undefined);
    if (waits.length > 0) void Promise.all(waits).then(() => { if (live) bump((n) => n + 1); });
    return () => { live = false; };
  }, [list]);
}
/**
 * Starts every art chunk the overview needs, in parallel, as soon as a snapshot is known (Show patient
 * calls it before the route renders). Never the 3D or brushing chunks.
 */
export function preloadArt(snap: Snapshot): void {
  void ensure({ k: "shapes" });
  for (const p of snap.positions) {
    const t = p.shown === "not_recorded" ? undefined : toothTypeOf(p.tooth);
    if (t !== undefined) void ensure({ k: "tooth", t });
  }
}
const peekTooth = (t: ToothType | undefined) => (t === undefined ? undefined : teeth.get(t));
const peekStage = (m: StageModel | undefined) => (m === undefined ? undefined : stages.get(m));
const peekShapes = () => shapesSet;

function usePrefersReduced(force: boolean | undefined): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => { setReduced(mq.matches); };
    mq.addEventListener("change", on);
    return () => { mq.removeEventListener("change", on); };
  }, []);
  return force ?? reduced;
}

// ---------- glyphs ----------

const G = {
  check: "M-0.95 0.05L-0.25 0.75L1 -0.65",
  out: "M-0.7 0.7L0.75 -0.75M-0.15 -0.8H0.8V0.15",
  clock: "M0 -0.75V0L0.55 0.35",
  found: "M0 -0.8V0.25M0 0.75V0.8",
};
function BadgeGlyph({ kind, x, y, r }: { kind: Badge; x: number; y: number; r: number }): ReactElement {
  const t = `translate(${String(x)} ${String(y)})`;
  if (kind === "found") return <g transform={t}><rect className="mv-b-found" x={-r} y={-r} width={2 * r} height={2 * r} rx={r * 0.42} /><path className="mv-g-white" d={G.found} transform={`scale(${String(r / 1.2)})`} strokeWidth={0.38 * 1.2} /></g>;
  if (kind === "here") return <g transform={t}><circle className="mv-b-here" r={r} /><path className="mv-g-white" d={G.check} transform={`scale(${String(r / 1.45)})`} /></g>;
  if (kind === "elsewhere") return <g transform={t}><circle className="mv-b-else" r={r} /><path className="mv-g-slate" d={G.out} transform={`scale(${String(r / 1.5)})`} /></g>;
  return <g transform={t}><circle className="mv-b-before" r={r} /><path className="mv-g-muted" d={G.clock} transform={`scale(${String(r / 1.4)})`} /></g>;
}
/** A badge glyph on its own (found today, done here, elsewhere, before), for overlays drawn outside the arch. */
export function BadgeIcon({ kind }: { kind: Badge }): ReactElement {
  return <svg className="mv-badge-icon" viewBox="-8 -8 16 16" aria-hidden="true"><BadgeGlyph kind={kind} x={0} y={0} r={7} /></svg>;
}
type LegendKind = "today" | "planned" | Badge | "nr";
function LegendGlyph({ kind }: { kind: LegendKind }): ReactElement {
  const dot = <circle r="2.6" className="mv-l-dot" />;
  let inner: ReactElement;
  if (kind === "today") inner = <>{dot}<circle r="3.6" className="mv-l-today" /></>;
  else if (kind === "planned") inner = <>{dot}<circle r="3.8" className="mv-l-plan" /></>;
  else if (kind === "nr") inner = <circle r="3" className="mv-l-nr" />;
  else inner = <BadgeGlyph kind={kind} x={0} y={0} r={3} />;
  return <svg viewBox="-5 -5 10 10" aria-hidden="true">{inner}</svg>;
}
const LEGEND: readonly [LegendKind, string][] = [["today", "Treated today"], ["planned", "Planned"], ["found", "Found today"], ["here", "Done here"], ["elsewhere", "Done elsewhere"], ["before", "Done before"], ["nr", "Not recorded"]];

const CalendarIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
const ChevronLeft = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>;

function ChipList({ chips, extra }: { chips: readonly Chip[]; extra?: ReactNode }): ReactElement | null {
  if (chips.length === 0 && extra === undefined) return null;
  return <div className="mv-chips">{chips.map((c) => <span key={c.text} className={`mv-chip mv-chip-${c.tone}`}>{c.text}</span>)}{extra}</div>;
}

// ---------- the view ----------

export interface MouthViewProps {
  snapshot: Snapshot;
  /** The patient's first name ("Aarav's teeth"); omit for "Your teeth". */
  name?: string | undefined;
  mode?: "page" | "present";
  /** Force stills (otherwise follows prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Ask the view to open a tooth (a row on the page); a new `nonce` opens it again. */
  open?: { tooth: number; nonce: number } | undefined;
  /** Lazy 3D module (`import("@aarogyam/app-kit/real-teeth-3d")`); without it there is no "See in 3D". */
  load3d?: (() => Promise<{ mountTooth3d: (canvas: HTMLCanvasElement, opts: Tooth3dOptions) => Tooth3dHandle }>) | undefined;
  /** Extra controls in tooth detail (Present's "Add depth" chip). */
  toothExtras?: ((tooth: number) => ReactNode) | undefined;
  /** Present's "Today" chip: highlight only teeth with today's findings or treatment. */
  filter?: "today" | undefined;
  /** Present: show the doctor's "Today: …" line and the key. Only the chart view wants them (default off in present). */
  doctorLines?: boolean | undefined;
  /**
   * Draws the overview's teeth instead of the arch (Present draws the doctor's chart look: rows, 3D arch or classic).
   * The header, legend and tooth detail stay the view's own.
   */
  overview?: ((slot: OverviewSlot) => ReactNode) | undefined;
  /** Called when the screen changes (the page scrolls the hero into view). */
  onScreen?: ((screen: "overview" | "detail", tooth: number | undefined) => void) | undefined;
  className?: string | undefined;
}

/** What a custom overview gets: each tooth's state, a way to open its detail, and the tooth to return focus to after Back. */
export interface OverviewSlot {
  stateOf: (fdi: number) => PositionState;
  open: (fdi: number) => void;
  /** The tooth the view came back from; a new `n` each time. */
  was: { fdi: number; n: number } | undefined;
  filter: "today" | undefined;
}

export function MouthView(props: MouthViewProps): ReactElement {
  const { snapshot, name, mode = "page", open, onScreen } = props;
  const present = mode === "present";
  const reduced = usePrefersReduced(props.reducedMotion);
  const states = useMemo(() => archStates(snapshot), [snapshot]);
  const [detail, setDetail] = useState<number | undefined>(undefined);
  const [last, setLast] = useState<number | undefined>(undefined);
  const [was, setWas] = useState<{ fdi: number; n: number } | undefined>(undefined);
  const backRef = useRef<HTMLButtonElement>(null);
  const [backing, setBacking] = useState(false);

  const openTooth = (fdi: number) => {
    setDetail(fdi);
    setLast(fdi);
    setBacking(false);
  };
  const back = () => {
    if (detail === undefined) return;
    setWas({ fdi: detail, n: (was?.n ?? 0) + 1 });
    setDetail(undefined);
    setBacking(true);
  };
  const onEsc = useEffectEvent(back);
  const tellScreen = useEffectEvent((fdi: number | undefined) => { onScreen?.(fdi === undefined ? "overview" : "detail", fdi); });
  const [screenSeen, setScreenSeen] = useState(false);
  useEffect(() => {
    if (detail !== undefined) backRef.current?.focus({ preventScroll: true });
    if (detail !== undefined || screenSeen) tellScreen(detail);
  }, [detail, screenSeen]);
  if (detail !== undefined && !screenSeen) setScreenSeen(true);
  // Esc (and Present's Esc) goes back to the overview; it never leaves Present (m4).
  useEffect(() => {
    if (detail === undefined) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onEsc();
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, [detail]);
  // a row on the page asks to open a tooth: each new nonce opens it once
  const [nonceSeen, setNonceSeen] = useState<number | undefined>(undefined);
  if (open !== undefined && open.nonce !== nonceSeen) {
    setNonceSeen(open.nonce);
    openTooth(open.tooth);
  }

  const shown = last === undefined ? undefined : stateFor(snapshot, states, last);
  return (
    <div className={["mv-theme", "mv", present ? "mv-present" : "", props.className ?? ""].filter(Boolean).join(" ")} data-screen={detail === undefined ? "overview" : "detail"} data-back={backing ? "" : undefined} data-reduced={reduced ? "" : undefined}>
      <div className="mv-overview" hidden={detail !== undefined}>
        <Overview snapshot={snapshot} states={states} name={name} present={present} doctorLines={!present || props.doctorLines === true} was={was} onOpen={openTooth} filter={props.filter}
          custom={props.overview?.({ stateOf: (fdi) => stateFor(snapshot, states, fdi), open: openTooth, was, filter: props.filter })} />
      </div>
      {shown === undefined ? null : (
        <div className="mv-detail" hidden={detail === undefined}>
          <Detail
            key={present ? "present" : "page"}
            state={shown}
            visible={detail !== undefined}
            snapshot={snapshot}
            name={name}
            present={present}
            reduced={reduced}
            load3d={props.load3d}
            extras={props.toothExtras?.(shown.fdi)}
            backRef={backRef}
            onBack={back}
          />
        </div>
      )}
    </div>
  );
}

// ---------- overview ----------

const W = 360;

interface Placed { s: PositionState; slot: ArchSlot; nx: number; ny: number; r: number }

function Overview({ snapshot, states, name, present, doctorLines, was, onOpen, filter, custom }: {
  snapshot: Snapshot; states: { upper: PositionState[]; lower: PositionState[] }; name: string | undefined; present: boolean; doctorLines: boolean;
  was: { fdi: number; n: number } | undefined; onOpen: (fdi: number) => void; filter?: "today" | undefined; custom?: ReactNode;
}): ReactElement {
  const all = useMemo(() => [...states.upper, ...states.lower], [states]);
  const sig = all.map((s) => s.fdi).join(",");
  const lay = useMemo(() => archLayout(all.map((s) => s.fdi), { width: W, between: 44, gapMm: 0.9, depth: 1.02 }), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawn = all.filter((s) => s.shown !== "not_recorded");
  const types = [...new Set(drawn.map((s) => toothTypeOf(s.fdi)).filter((t): t is ToothType => t !== undefined))];
  useAssets([{ k: "shapes" }, ...types.map((t): Req => ({ k: "tooth", t }))]);
  const shapes = peekShapes();

  const placed = useMemo(() => {
    const bySlot = new Map(lay.slots.map((s) => [s.fdi, s]));
    const upperY = Math.max(...lay.slots.filter((s) => toothInfo(s.fdi).upper).map((s) => s.y), 0);
    const lowerY = Math.min(...lay.slots.filter((s) => !toothInfo(s.fdi).upper).map((s) => s.y), lay.height);
    const out: Placed[] = [];
    for (const s of all) {
      const slot = bySlot.get(s.fdi);
      if (slot === undefined) continue;
      const cy = s.arch === "upper" ? upperY + 14 : lowerY - 14;
      const dx = slot.x - W / 2, dy = slot.y - cy, len = Math.hypot(dx, dy) || 1;
      out.push({ s, slot, nx: dx / len, ny: dy / len, r: Math.max(slot.w, slot.h) / 2 });
    }
    return out;
  }, [lay, all]);

  // roving tabindex: one tab stop, arrows along and between arches (m4)
  const firstFocus = snapshot.focus.find((f) => all.some((s) => s.fdi === f)) ?? all.find((s) => s.tooth !== undefined)?.fdi ?? all[0]?.fdi;
  const [active, setActive] = useState<number | undefined>(firstFocus);
  const refs = useRef(new Map<number, SVGGElement>());
  const [flash, setFlash] = useState<number | undefined>(undefined);
  const [wasSeen, setWasSeen] = useState(was);
  if (was !== wasSeen) {
    setWasSeen(was);
    if (was !== undefined) {
      setActive(was.fdi);
      setFlash(was.fdi);
    }
  }
  useEffect(() => {
    if (was === undefined) return;
    refs.current.get(was.fdi)?.focus({ preventScroll: true });
    const t = setTimeout(() => { setFlash(undefined); }, 1600);
    return () => { clearTimeout(t); };
  }, [was]);
  const tabStop = all.some((s) => s.fdi === active) ? active : firstFocus;

  const move = (to: number | undefined) => {
    if (to === undefined) return;
    setActive(to);
    refs.current.get(to)?.focus();
  };
  const onKey = (e: KeyboardEvent<SVGGElement>, s: PositionState) => {
    const row = s.arch === "upper" ? states.upper : states.lower;
    const i = row.findIndex((x) => x.fdi === s.fdi);
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(s.fdi); return; }
    let to: number | undefined;
    if (e.key === "ArrowRight") to = row[Math.min(row.length - 1, i + 1)]?.fdi;
    else if (e.key === "ArrowLeft") to = row[Math.max(0, i - 1)]?.fdi;
    else if (e.key === "Home") to = row[0]?.fdi;
    else if (e.key === "End") to = row.at(-1)?.fdi;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const other = e.key === "ArrowUp" ? states.upper : states.lower;
      if (other === row) return;
      const x = placed.find((p) => p.s.fdi === s.fdi)?.slot.x ?? 0;
      to = other.map((o) => ({ o, d: Math.abs((placed.find((p) => p.s.fdi === o.fdi)?.slot.x ?? 0) - x) })).sort((a, b) => a.d - b.d)[0]?.o.fdi;
    } else return;
    e.preventDefault();
    move(to);
  };

  const { need, today } = summaryCounts(snapshot);
  const who = name === undefined ? "Your" : `${name}'s`;
  const ys = placed.map((p) => p.slot.y);
  const upperRows = placed.filter((p) => p.s.arch === "upper");
  const lowerRows = placed.filter((p) => p.s.arch === "lower");
  const upMax = Math.max(...upperRows.map((p) => p.slot.y + p.slot.h / 2), 0);
  const loMin = Math.min(...lowerRows.map((p) => p.slot.y - p.slot.h / 2), lay.height);
  const midY = (upMax + loMin) / 2;
  const minY = Math.min(...ys, 0) - 52, maxY = Math.max(...ys, lay.height) + 34;
  const band = (rows: Placed[]) => rows.map((p) => `${p.slot.x.toFixed(1)},${p.slot.y.toFixed(1)}`).join(" ");
  const bandW = Math.max(...placed.map((p) => p.r), 10) * 2.2;

  return (
    <section className="mv-card" aria-label={`${who} teeth`}>
      <div className="mv-head">
        <h2 className="mv-title">{`${who} teeth`}</h2>
        <p className="mv-sum"><b>{`${String(need)} ${need === 1 ? "tooth needs" : "teeth need"} attention`}</b>{` · ${String(today)} treated today`}</p>
        {present && doctorLines && todayLine(all) !== undefined ? <p className="mv-today">{todayLine(all)}</p> : null}
        {snapshot.next_visit === undefined ? null : <p className="mv-next"><CalendarIcon />{`Next visit: ${dayLabel(snapshot.next_visit)}`}</p>}
      </div>
      {custom !== undefined ? <div className="mv-custom">{custom}</div> : <div className="mv-arch-wrap">
        <svg className={`mv-arch${filter === "today" ? " mv-only-today" : ""}`} viewBox={`-20 ${minY.toFixed(1)} ${String(W + 40)} ${(maxY - minY).toFixed(1)}`} role="group" aria-label={`${who} teeth: ${String(need)} need attention, ${String(today)} treated today. Use the arrow keys to move between teeth.`}>
          <polyline className="mv-gum" points={band(upperRows)} strokeWidth={bandW} />
          <polyline className="mv-gum" points={band(lowerRows)} strokeWidth={bandW} />
          <text className="mv-side" x={-14} y={midY} dominantBaseline="central">{`${name ?? "Your"}${name === undefined ? " right" : "'s right"}`}</text>
          <text className="mv-side" x={W + 14} y={midY} textAnchor="end" dominantBaseline="central">{`${name ?? "Your"}${name === undefined ? " left" : "'s left"}`}</text>
          <text className="mv-jaw" x={W / 2} y={midY - 10} textAnchor="middle">UPPER</text>
          <text className="mv-jaw" x={W / 2} y={midY + 17} textAnchor="middle">LOWER</text>
          <g>
            {placed.map((p) => (
              <ToothButton key={p.s.fdi} p={p} shapes={shapes} present={present} tabIndex={tabStop === p.s.fdi ? 0 : -1} flash={flash === p.s.fdi} dim={filter === "today" && !isToday(p.s)}
                gref={(el) => { if (el === null) refs.current.delete(p.s.fdi); else refs.current.set(p.s.fdi, el); }}
                onOpen={() => { setActive(p.s.fdi); onOpen(p.s.fdi); }} onKey={(e) => { onKey(e, p.s); }} />
            ))}
          </g>
          <g pointerEvents="none">
            {placed.map((p) => <Marks key={p.s.fdi} p={p} dim={filter === "today" && !isToday(p.s)} />)}
          </g>
        </svg>
      </div>}
      <ul className="mv-sr">{all.filter((s) => s.tooth !== undefined).map((s) => <li key={s.fdi}>{spokenLabel(s, present)}</li>)}</ul>
      {doctorLines ? (
        <ul className="mv-legend" aria-label="Key">
          {LEGEND.map(([k, l]) => <li key={k}><LegendGlyph kind={k} /><span>{l}</span></li>)}
        </ul>
      ) : null}
      <p className="mv-hint">Tap any tooth to see what we did and what comes next.</p>
    </section>
  );
}

function ToothButton({ p, shapes, present, tabIndex, flash, dim, gref, onOpen, onKey }: {
  p: Placed; shapes: ShapeSet | undefined; present: boolean; tabIndex: number; flash: boolean; dim: boolean;
  gref: (el: SVGGElement | null) => void; onOpen: () => void; onKey: (e: KeyboardEvent<SVGGElement>) => void;
}): ReactElement {
  const { s, slot, r } = p;
  const art = s.shown === "not_recorded" ? undefined : peekTooth(slot.type);
  let body: ReactElement;
  if (art !== undefined && shapes !== undefined) {
    const sc = toothScene(art, "top", { fdi: s.fdi, shapes, parts: overlaysFor(s.tooth, false).map((o) => overlayPart(art, "top", o)) });
    const [, , bw, bh] = sc.box;
    const k = slot.w / (bw - 12);
    body = (
      <g transform={`translate(${slot.x.toFixed(2)} ${slot.y.toFixed(2)}) rotate(${slot.angle.toFixed(2)})`}>
        <ArtSvg scene={sc} x={(-bw * k) / 2} y={(-bh * k) / 2} width={bw * k} height={bh * k} />
      </g>
    );
  } else {
    const w = slot.w * 0.9, h = slot.h * 0.86;
    body = <rect className={s.shown === "not_recorded" ? "mv-nr" : "mv-loading"} x={slot.x - w / 2} y={slot.y - h / 2} width={w} height={h} rx={Math.min(w, h) * 0.34} transform={`rotate(${slot.angle.toFixed(2)} ${slot.x.toFixed(2)} ${slot.y.toFixed(2)})`} />;
  }
  const ringT = r + 3.2, ringP = r + (s.today ? 7 : 3.4);
  return (
    <g ref={gref} className={`mv-tooth${flash ? " mv-was" : ""}${dim ? " mv-dim" : ""}`} role="button" tabIndex={tabIndex} aria-label={spokenLabel(s, present)} data-fdi={s.fdi} data-state={s.shown}
      onClick={onOpen} onKeyDown={onKey}>
      <circle className="mv-hit" cx={slot.x} cy={slot.y} r={Math.max(r + 6, 22)} />
      <circle className="mv-hover" cx={slot.x} cy={slot.y} r={r + 2.5} />
      {body}
      {s.today ? <><circle className="mv-pulse" cx={slot.x} cy={slot.y} r={ringT} /><circle className="mv-ring-today" cx={slot.x} cy={slot.y} r={ringT} /></> : null}
      {s.planned ? <circle className="mv-ring-plan" cx={slot.x} cy={slot.y} r={ringP} /> : !s.today && isRecommended(s.tooth) ? <circle className="mv-ring-rec" cx={slot.x} cy={slot.y} r={ringP} /> : null}
      <circle className="mv-focus" cx={slot.x} cy={slot.y} r={(s.planned ? ringP : s.today ? ringT : r) + 4.5} />
    </g>
  );
}

function Marks({ p, dim }: { p: Placed; dim: boolean }): ReactElement {
  const { s, slot, nx, ny, r } = p;
  const ring = s.planned ? (s.today ? r + 7 : r + 3.4) : s.today ? r + 3.2 : r;
  const out: ReactElement[] = [];
  if (s.badge !== undefined) {
    // beside the TODAY tag when both show
    const a = s.today ? 0.95 : 0;
    const bx = nx * Math.cos(a) - ny * Math.sin(a), by = nx * Math.sin(a) + ny * Math.cos(a);
    out.push(<BadgeGlyph key="b" kind={s.badge} x={slot.x + bx * (ring + 8)} y={slot.y + by * (ring + 8)} r={6.8} />);
  }
  if (s.today) {
    const tx = slot.x + nx * (ring + 12), ty = slot.y + ny * (ring + 12);
    out.push(<g key="t" className="mv-tag-today" transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)})`}><rect x={-19} y={-7} width={38} height={14} rx={7} /><text y={0.6}>TODAY</text></g>);
  }
  if (!s.planned && !s.today && isRecommended(s.tooth)) {
    const tx = slot.x + nx * (ring + 13), ty = slot.y + ny * (ring + 13);
    out.push(<g key="r" className="mv-tag-rec" transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)})`}><rect x={-28} y={-6.5} width={56} height={13} rx={6.5} /><text y={0.6}>RECOMMENDED</text></g>);
  }
  const lo = ring + 7.5;
  out.push(<text key="n" className={`mv-num${s.shown === "not_recorded" ? "" : " mv-on"}`} x={(slot.x - nx * lo).toFixed(1)} y={(slot.y - ny * lo).toFixed(1)}>{s.fdi}</text>);
  return dim ? <g opacity={0.3}>{out}</g> : <>{out}</>;
}

// ---------- tooth detail ----------

const VIEW_LABEL: Readonly<Record<ViewName, string>> = { section: "Inside", front: "Outside", top: "Chewing side" };
const NOTE_WORDS: Readonly<Record<string, string>> = { depth_not_recorded: "Illustration: depth not recorded" };

function slowLink(): boolean {
  const n: { userAgent: string; connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number } = navigator;
  return n.connection?.saveData === true || n.connection?.effectiveType === "2g" || n.connection?.effectiveType === "slow-2g" || (n.deviceMemory !== undefined && n.deviceMemory <= 1);
}
function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return c.getContext("webgl2") !== null || c.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

interface Layer { id: number; scene: Scene; anim: string; out: boolean }

function Detail({ state, visible, snapshot, name, present, reduced, load3d, extras, backRef, onBack }: {
  state: PositionState; visible: boolean; snapshot: Snapshot; name: string | undefined; present: boolean; reduced: boolean;
  load3d: MouthViewProps["load3d"]; extras: ReactNode; backRef: React.RefObject<HTMLButtonElement | null>; onBack: () => void;
}): ReactElement {
  const fdi = state.fdi;
  const t = state.tooth;
  const info = toothInfo(fdi);
  const main = withFoundStep(mainTreatment(t), t);
  const labels = main === undefined ? [] : stepLabels(main, t);
  const currentIdx = Math.max(0, main?.steps.findIndex((s) => s.state === "current" || s.state === "next") ?? 0);
  const [stepIdx, setStepIdx] = useState(currentIdx);
  const [forward, setForward] = useState(true);
  const [view, setView] = useState<ViewName | "3d" | undefined>(undefined);
  const [no3d, setNo3d] = useState(false);
  const [webgl] = useState(() => load3d !== undefined && hasWebGL());
  const toothKey = `${String(fdi)}|${main?.model ?? ""}`;
  const [seen, setSeen] = useState(toothKey);
  if (seen !== toothKey) {
    setSeen(toothKey);
    setStepIdx(currentIdx);
    setView((v) => (v === "3d" ? v : undefined));
  }
  const step = main?.steps[Math.min(stepIdx, main.steps.length - 1)];
  const art = step === undefined ? undefined : sceneArt(step.scene);
  const type = toothTypeOf(fdi);
  const eruption = t?.details?.eruption;
  const wisdom = main === undefined && isEruption(eruption) && eruption !== "erupted" && !info.primary;
  const neighbour = wisdom ? toothTypeOf(neighborOf(fdi) ?? 0) : undefined;
  const reqs: Req[] = [{ k: "shapes" }];
  if (type !== undefined) reqs.push({ k: "tooth", t: type });
  if (art !== undefined) reqs.push({ k: "stage", m: art.model });
  if (wisdom) reqs.push({ k: "stage", m: "wisdom_extraction" });
  if (wisdom && neighbour !== undefined) reqs.push({ k: "tooth", t: neighbour });
  useAssets(reqs);
  const toothArt = peekTooth(type);
  const shapes = peekShapes();
  const stageSet = peekStage(art?.model);
  const stageScene = art === undefined ? undefined : stageSet?.scenes[art.step];
  const backTooth = info.pos >= 4;
  const autoView: ViewName = stageScene?.view ?? (wisdom ? "section" : backTooth ? "top" : "front");
  const artKey = art === undefined ? undefined : `${art.model}.${art.step}`;
  const elsewhere = artKey === undefined ? undefined : stepOverlays(artKey, t);
  // a stage step shows in another view only when the kit can draw that step there (§1.12)
  const drawsIn = (v: ViewName): boolean => {
    if (stageScene === undefined || v === stageScene.view) return true;
    if (elsewhere === undefined || toothArt === undefined) return false;
    return elsewhere.some((o) => { const p = overlayPart(toothArt, v, o); return p.add.length > 0 || (p.hide ?? []).length > 0; });
  };
  const baseViews: ViewName[] = backTooth ? ["top", "section"] : ["section", "front"];
  const views = baseViews.filter((v) => v === autoView || drawsIn(v));
  if (!views.includes(autoView)) views.unshift(autoView);
  const shownView: ViewName = view === undefined || view === "3d" || !views.includes(view) ? autoView : view;
  const loaded = toothArt !== undefined && shapes !== undefined && (art === undefined || stageSet !== undefined) && (!wisdom || peekStage("wisdom_extraction") !== undefined);
  const callouts = stageScene !== undefined && stageScene.view === shownView && artKey !== undefined ? STAGE_CALLOUTS[artKey] : undefined;
  const sceneKey = `${toothKey}|${String(stepIdx)}|${shownView}|${loaded ? "1" : "0"}`;

  const scene = useMemo((): Scene | undefined => {
    if (!loaded) return undefined;
    const params = stageParams(t);
    if (wisdom && shownView === "section" && isEruption(eruption)) {
      const ws = peekStage("wisdom_extraction");
      if (ws !== undefined) return eruptionScene(toothArt, peekTooth(neighbour), ws, eruption, isAngulation(t?.details?.angulation) ? t.details.angulation : undefined, { fdi, shapes });
    }
    if (stageScene !== undefined && stageScene.view === shownView) {
      const extra = t === undefined ? [] : detailOverlays(t).map((o) => overlayPart(toothArt, shownView, o));
      return toothScene(toothArt, shownView, { fdi, shapes, parts: [stagePart(stageScene, params), ...extra], mark: (callouts ?? []).map((c) => c[0]) });
    }
    if (stageScene !== undefined && elsewhere !== undefined) return toothScene(toothArt, shownView, { fdi, shapes, parts: elsewhere.map((o) => overlayPart(toothArt, shownView, o)) });
    return toothScene(toothArt, shownView, { fdi, shapes, parts: overlaysFor(t).map((o) => overlayPart(toothArt, shownView, o)) });
  }, [sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // wipe between stages (cross-fade under the new picture); stills under reduced motion
  const [layers, setLayers] = useState<Layer[]>([]);
  const [layerKey, setLayerKey] = useState("");
  const [seq, setSeq] = useState(1);
  if (scene !== undefined && layerKey !== sceneKey) {
    setLayerKey(sceneKey);
    const id = seq;
    setSeq(seq + 1);
    const sameTooth = layerKey.split("|").slice(0, 2).join("|") === toothKey;
    if (reduced || !sameTooth || layers.length === 0) setLayers([{ id, scene, anim: "", out: false }]);
    else {
      const down = !(forward ? info.upper : !info.upper);
      setLayers((prev) => [...prev.filter((l) => !l.out).map((l) => ({ ...l, out: true })), { id, scene, anim: down ? "mv-in mv-down" : "mv-in", out: false }]);
    }
  }
  useEffect(() => {
    if (!layers.some((l) => l.out)) return;
    const timer = setTimeout(() => { setLayers((prev) => prev.filter((l) => !l.out)); }, 760);
    return () => { clearTimeout(timer); };
  }, [layers]);

  // 3D: mounted once, then update() per tap; lazy chunk on the first "See in 3D" only
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const handle = useRef<Tooth3dHandle | undefined>(undefined);
  const want3d = view === "3d" && visible && !no3d;
  const opts3d: Tooth3dOptions = {
    fdi, view: "inside", labels: true, reducedMotion: reduced, details: details3d(t),
    stage: art === undefined ? null : { model: art.model, step: art.step, ...(t?.material === undefined ? {} : { material: t.material }) },
  };
  const optsSig = JSON.stringify(opts3d);
  const currentOpts = useEffectEvent(() => opts3d);
  useEffect(() => {
    if (!want3d || load3d === undefined) return;
    const opts = currentOpts();
    if (handle.current !== undefined) { handle.current.update(opts); return; }
    let live = true;
    void load3d().then((mod) => {
      const canvas = canvasRef.current;
      if (!live || canvas === null || handle.current !== undefined) return;
      handle.current = mod.mountTooth3d(canvas, opts);
      if (!handle.current.ok) setNo3d(true);
    }, () => { setNo3d(true); });
    return () => { live = false; };
  }, [want3d, optsSig, load3d]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const off = () => { setNo3d(true); setView(undefined); };
    canvas.addEventListener("webglunavailable", off);
    return () => { canvas.removeEventListener("webglunavailable", off); };
  });
  useEffect(() => () => { handle.current?.dispose(); handle.current = undefined; }, []);

  const go = (k: number) => {
    if (main === undefined) return;
    const to = Math.max(0, Math.min(main.steps.length - 1, k));
    if (to === stepIdx) return;
    setForward(to > stepIdx);
    setStepIdx(to);
  };
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const stepKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (main === undefined) return;
    let k = stepIdx;
    if (e.key === "ArrowRight") k += 1; else if (e.key === "ArrowLeft") k -= 1; else if (e.key === "Home") k = 0; else if (e.key === "End") k = main.steps.length - 1; else return;
    e.preventDefault();
    k = Math.max(0, Math.min(main.steps.length - 1, k));
    go(k);
    tabs.current[k]?.focus();
  };

  const chips = detailChips(state);
  const who = name ?? "you";
  const notes = [...new Set((scene?.notes ?? []).map((n) => NOTE_WORDS[n] ?? n.replace(/_/g, " ")))];
  const show3dButton = webgl && !no3d && (t !== undefined);
  const others = (t?.treatments ?? []).filter((x) => x.model !== main?.model && x.state !== "done");
  const label = labels[Math.min(stepIdx, labels.length - 1)];
  const hasHere = main?.steps.some((s) => s.state === "current") === true;
  // DT4: a planned or found decay with a recorded depth; on the step that shows the decay, else the panel below
  const waitAll = ifWaitFrames(t);
  const wait = waitAll !== undefined && (main === undefined || step?.key === FOUND_STEP || stepIdx === 0) ? waitAll : undefined;

  return (
    <section className="mv-card mv-detail-card" aria-label={`${info.name}, ${String(fdi)}`}>
      <button ref={backRef} type="button" className="mv-btn mv-backbtn" onClick={onBack}><ChevronLeft />Back to all teeth</button>
      <div className="mv-d-body">
      <div className="mv-d-head">
        <p className="mv-d-eyebrow">{`${info.name} · ${String(fdi)} · ${info.kind}`}</p>
        <h3 className="mv-d-title">{detailTitle(state)}</h3>
        <ChipList chips={chips} extra={extras} />
        {state.shown === "not_recorded" || t === undefined ? <p className="mv-d-note">Nothing was recorded for this tooth at this visit. That doesn't mean it is healthy or unhealthy.</p> : null}
      </div>
      <div className="mv-stagebox">
        <div className="mv-art" ref={artRef} data-view={want3d ? "3d" : shownView}>
          {layers.map((l) => (
            <div key={l.id} className={`mv-layer ${l.out ? "mv-out" : l.anim}`} data-live={l.out ? undefined : ""}>
              <ArtSvg scene={l.scene} label={`${info.name}${step === undefined ? "" : `, ${step.words}`}`} {...(state.shown === "not_recorded" ? { className: "mv-ghost" } : {})} />
            </div>
          ))}
          {scene === undefined ? <div className="mv-layer mv-art-wait" aria-hidden="true" /> : null}
          {callouts === undefined || want3d || scene === undefined ? null : (
            <Callouts boxRef={artRef} sceneKey={layerKey} items={callouts.map(([n, l, sub]): Callout => [n, l, sub === "{material}" ? materialWords(t?.material) : sub])} />
          )}
          {load3d === undefined ? null : <canvas ref={canvasRef} className="mv-3d" hidden={!want3d} aria-label={`${info.name} in 3D`} />}
        </div>
        {notes.length === 0 ? null : <p className="mv-illus">{notes.join(" · ")}</p>}
        <div className="mv-viewtabs" role="group" aria-label="View">
          {views.map((v) => <button key={v} type="button" aria-pressed={!want3d && shownView === v} onClick={() => { setView(v); }}>{VIEW_LABEL[v]}</button>)}
          {show3dButton ? <button type="button" aria-pressed={want3d} onClick={() => { setView("3d"); }}>{slowLink() ? "See in 3D (0.3 MB)" : "See in 3D"}</button> : null}
        </div>
      </div>

      <div className="mv-d-info">
      {main === undefined || step === undefined || label === undefined ? null : (
        <div className="mv-stepper">
          {main.steps.every((s) => s.state === "usual" || s.key === FOUND_STEP) ? <p className="mv-fine">{`These are the usual steps, not a record of ${name === undefined ? "your" : `${name}'s`} visits.`}</p> : null}
          <div className={`mv-steps${hasHere ? " mv-has-here" : ""}`} role="tablist" aria-label="Treatment steps">
            {main.steps.map((s, k) => (
              <button key={s.key} ref={(el) => { tabs.current[k] = el; }} type="button" role="tab" className="mv-step" data-state={s.state} aria-selected={k === stepIdx} tabIndex={k === stepIdx ? 0 : -1}
                onClick={() => { go(k); }} onKeyDown={stepKey}>
                {s.state === "current" ? <span className="mv-here">You are here</span> : null}
                <span className="mv-bar" />
                <span className="mv-lbl">{labels[k]?.short}</span>
              </button>
            ))}
          </div>
          <div className="mv-steppanel" role="tabpanel" aria-live="polite">
            <div className="mv-st-k">{label.heading}</div>
            <p className="mv-st-w">{step.words}</p>
            {label.tag === undefined ? null : <span className={`mv-chip mv-chip-${label.tag.tone}`}>{label.tag.text}</span>}
            {step.after_words === "" ? null : <p className="mv-usually"><b>{step.state === "usual" ? "Usually:" : "Usually, after this step:"}</b> {usuallyText(step.after_words)}</p>}
            {wait === undefined || toothArt === undefined || shapes === undefined ? null : <IfYouWait wait={wait} art={toothArt} shapes={shapes} fdi={fdi} name={name} />}
          </div>
          <div className="mv-stepnav">
            <button type="button" className="mv-btn mv-btn-ghost" aria-label="Previous step" disabled={stepIdx === 0} onClick={() => { go(stepIdx - 1); }}>Back</button>
            <div className="mv-dots" aria-hidden="true">{main.steps.map((s, k) => <i key={s.key} className={k === stepIdx ? "mv-on" : undefined} />)}</div>
            <button type="button" className="mv-btn mv-btn-soft" aria-label="Next step" disabled={stepIdx === main.steps.length - 1} onClick={() => { go(stepIdx + 1); }}>Next</button>
          </div>
        </div>
      )}

      {main === undefined || main.recovery.length === 0 ? null : (
        <div className="mv-generic">
          <h4>What to expect</h4>
          <p className="mv-gl">{`General notes for this treatment, not specific to ${who}.`}</p>
          <ul>{main.recovery.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {others.map((o) => (
        <div key={o.model} className="mv-generic">
          <h4>{`Usual steps for ${o.model === "crown" ? "a crown" : `the ${(modelWord(o.model))}`}`}</h4>
          <p className="mv-gl">What usually happens. Your dentist will confirm.</p>
          <ul>{o.steps.map((s) => <li key={s.key}>{s.words}</li>)}</ul>
        </div>
      ))}
      {(t?.work ?? []).filter((w) => main === undefined || w.origin !== "here").map((w, i) => (
        <div key={i} className="mv-originbox">
          <LegendGlyph kind={w.origin === "elsewhere" ? "elsewhere" : w.origin === "before" ? "before" : "here"} />
          <div>
            <b>{originWords(w.origin, w.done_on, present, w.today === true)}</b>
            <span>{w.origin === "elsewhere" ? `${workWord(w.finding)}, done before ${name ?? "you"} came here.` : w.origin === "before" ? `${workWord(w.finding)}, recorded as already there.` : workWord(w.finding)}</span>
          </div>
        </div>
      ))}
      {snapshot.next_visit !== undefined && main?.steps.every((s) => s.state !== "next") === true && main.state === "in_progress" ? (
        <p className="mv-next">{`Next visit: ${dayLabel(snapshot.next_visit)}`}</p>
      ) : null}
      {main === undefined && wait !== undefined && toothArt !== undefined && shapes !== undefined ? (
        <div className="mv-steppanel"><IfYouWait wait={wait} art={toothArt} shapes={shapes} fdi={fdi} name={name} /></div>
      ) : null}
      </div>
      </div>
    </section>
  );
}

// ---------- callouts on stage art ----------

/** [layer name, label, sub-label]. */
type Callout = readonly [string, string, string | undefined];
interface Placed2 { label: string; sub: string | undefined; x: number; y: number; ly: number; right: boolean; edge: number; inside: boolean }

/**
 * Labels pointing at parts of the stage art ("Medicine inside", "Crown"). Measured from the live
 * layer's marked paths after layout; HTML text so it stays readable at 390 px. Beside the tooth when
 * there is room, else over the art's edge with a halo, as in the mock-up.
 */
function Callouts({ boxRef, items, sceneKey }: { boxRef: RefObject<HTMLDivElement | null>; items: readonly Callout[]; sceneKey: string }): ReactElement {
  const [placed, setPlaced] = useState<Placed2[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sig = items.map((c) => c.join("|")).join(";");
  const measure = useEffectEvent(() => {
    const box = boxRef.current;
    const live = box?.querySelector(".mv-layer[data-live] svg");
    if (box === null || live === null || live === undefined) return;
    const b = box.getBoundingClientRect();
    const tooth = live.querySelector(":scope > g")?.getBoundingClientRect();
    const out: Placed2[] = [];
    items.forEach(([n, label, sub], i) => {
      const r = live.querySelector(`[data-n="${n}"]`)?.getBoundingClientRect();
      if (r === undefined || tooth === undefined) return;
      const x = r.left + r.width / 2 - b.left, y = r.top + r.height / 2 - b.top;
      const right = i % 2 === 0;
      const room = right ? b.right - tooth.right : tooth.left - b.left;
      const inside = room < 150;
      const edge = inside ? (right ? b.width - 10 : 10) : right ? tooth.right - b.left + 14 : tooth.left - b.left - 14;
      out.push({ label, sub, x, y, ly: Math.max(26, Math.min(b.height - 22, y)), right, edge, inside });
    });
    // keep two labels on one side apart
    out.sort((a, c) => a.ly - c.ly).forEach((p, k, all) => { const prev = all.slice(0, k).reverse().find((q) => q.right === p.right); if (prev !== undefined && p.ly - prev.ly < 40) p.ly = prev.ly + 40; });
    setSize({ w: b.width, h: b.height });
    setPlaced(out);
  });
  useLayoutEffect(() => {
    measure();
    const box = boxRef.current;
    if (box === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { measure(); });
    ro.observe(box);
    return () => { ro.disconnect(); };
  }, [sceneKey, sig, boxRef]);
  return (
    <div className="mv-callouts">
      <svg className="mv-co-lines" width={size.w} height={size.h} aria-hidden="true">
        {placed.map((p) => (
          <g key={p.label}>
            <polyline points={`${String(p.x)},${String(p.y)} ${String(p.x + (p.edge - p.x) * 0.25)},${String(p.ly)} ${String(p.edge)},${String(p.ly)}`} />
            <circle cx={p.x} cy={p.y} r={3.2} />
          </g>
        ))}
      </svg>
      <ul className="mv-sr">{items.map(([n, label, sub]) => <li key={n}>{sub === undefined ? label : `${label} (${sub})`}</li>)}</ul>
      {placed.map((p) => (
        <span key={p.label} className="mv-co" aria-hidden="true" data-side={p.right === p.inside ? "end" : "start"}
          style={p.right === p.inside ? { right: size.w - p.edge, top: p.ly } : { left: p.edge, top: p.ly }}>
          <b>{p.label}</b>
          {p.sub === undefined ? null : <small>{p.sub}</small>}
        </span>
      ))}
    </div>
  );
}

// ---------- "If you wait" (DT4) ----------

function IfYouWait({ wait, art, shapes, fdi, name }: { wait: NonNullable<ReturnType<typeof ifWaitFrames>>; art: ToothArt; shapes: ShapeSet; fdi: number; name: string | undefined }): ReactElement {
  const scenes = useMemo(() => waitScenes(wait, art, shapes, fdi), [wait, art, shapes, fdi]);
  return (
    <div className="mv-wait">
      <p className="mv-wait-k">If you wait</p>
      <p className="mv-gl">{`Only the first picture is ${name === undefined ? "your" : `${name}'s`} recorded tooth. The others show what usually happens to decay that is left; they are not a prediction.`}</p>
      <ol className="mv-wait-row">
        {wait.frames.map((f, i) => (
          <li key={i} className="mv-wait-f" data-when={f.when}>
            <span className="mv-wait-tag">{f.when === "now" ? "Recorded" : "Usually"}</span>
            <div className="mv-wait-art">{scenes[i] === undefined ? null : <ArtSvg scene={scenes[i]} label={`${f.when === "now" ? "Now" : "Usually, later"}: ${f.caption}`} />}</div>
            <span className="mv-wait-c">{f.caption}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const MODEL_WORD: Readonly<Record<string, string>> = { root_canal: "root canal", filling: "filling", extraction: "removal", wisdom_extraction: "wisdom tooth removal", scaling: "cleaning", implant: "implant", sealant: "sealant" };
const WORK_WORD: Readonly<Record<string, string>> = { filled: "Filling", crown: "Crown", root_canal: "Root canal", implant: "Implant", bridge: "Bridge", missing: "Missing tooth" };
const modelWord = (m: string) => MODEL_WORD[m] ?? "treatment";
const workWord = (f: string) => WORK_WORD[f] ?? "Work";
