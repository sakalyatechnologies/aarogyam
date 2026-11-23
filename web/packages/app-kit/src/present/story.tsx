// The story cards style (present-studio-design §6.1, slice 1d), the default Show patient style. One card at
// a time, in a fixed order, built only from the visit's facts: your mouth (painted map), what we found, one
// card per recorded problem tooth (tooth sheet and slider), what is planned or recommended, and what we
// discussed (session-only ticks). No card is invented: case cards and options arrive with the studio data.
// Navigation: swipe, the arrow keys, progress dots and an "All cards" index. Prices are not in this slice.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";

import { dayLabel } from "../mouth-view/model.js";
import { FactList, ProvenanceFooter, RecordBadge } from "./blocks.js";
import type { FactItem, Orientation, PresentModel } from "./model.js";
import { OpenWide, bitingSideProblems, frontHidesAllProblems } from "./open-wide.js";
import { PaintedMap, type PaintedView } from "./painted.js";
import { ToothSheet, type ToothSheetProps } from "./tooth-sheet.js";
import { SituationOptions, useStudio } from "./options.js";
import type { PresentStudio } from "@aarogyam/api-client";

export type StoryCardKind = "mouth" | "found" | "tooth" | "options" | "plan" | "discussed" | "xray";
export interface StoryCard { id: string; kind: StoryCardKind; title: string; tooth?: number; situation?: string }

const PLAN_KINDS = new Set<FactItem["kind"]>(["recommended", "plan", "in_progress"]);
export const planFacts = (m: PresentModel): FactItem[] => m.facts.filter((f) => PLAN_KINDS.has(f.kind));
/** The rows "What we discussed" can tick: each problem tooth and each planned or recommended item. */
export const discussRows = (m: PresentModel): { id: string; words: string; where?: string | undefined }[] => [
  ...problemTeeth(m).map((t) => ({ id: `tooth:${String(t)}`, words: m.facts.filter((f) => f.tooth === t && f.kind === "problem").map((f) => f.words).join("; "), where: m.facts.find((f) => f.tooth === t)?.where })),
  ...planFacts(m).map((f) => ({ id: f.id, words: f.words, where: f.where })),
];
const problemTeeth = (m: PresentModel): number[] => [...new Set(m.facts.flatMap((f) => (f.kind === "problem" && f.tooth !== undefined ? [f.tooth] : [])))];

/** The cards, from the facts only. Pure: no fact, no card. */
export function storyCards(m: PresentModel, hasXray = false, studio?: PresentStudio): StoryCard[] {
  const cards: StoryCard[] = [{ id: "mouth", kind: "mouth", title: "Here is your mouth" }];
  if (m.facts.length > 0) cards.push({ id: "found", kind: "found", title: "What we found" });
  if (hasXray) cards.push({ id: "xray", kind: "xray", title: "Your X-ray" });
  for (const t of problemTeeth(m)) {
    const where = m.facts.find((f) => f.tooth === t)?.where;
    cards.push({ id: `tooth:${String(t)}`, kind: "tooth", tooth: t, title: `${where ?? "Tooth"} · ${String(t)}` });
  }
  for (const s of studio?.situations ?? []) cards.push({ id: `options:${String(s.tooth)}:${s.key}`, kind: "options", tooth: s.tooth, situation: s.key, title: `Usual options · ${s.title}` });
  if (planFacts(m).length > 0) cards.push({ id: "plan", kind: "plan", title: "What is planned" });
  if (discussRows(m).length > 0) cards.push({ id: "discussed", kind: "discussed", title: "What we discussed" });
  return cards;
}

export interface StoryProps {
  model: PresentModel;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  theme: "light" | "dark";
  view?: PaintedView | undefined;
  onView?: ((v: PaintedView) => void) | undefined;
  load3d?: ToothSheetProps["load3d"];
  /** Draws every card one under the other (the conformance suite and print); navigation is hidden. */
  stacked?: boolean | undefined;
  /** The patient's own X-ray, drawn by the host (it needs the signed link). The "Your X-ray" card exists only when this is given. */
  xray?: ReactNode;
}

const SWIPE = 60;
/** Keys and swipes that belong to a control (the slider, a field, a list) are not card navigation. */
const owned = (el: EventTarget | null): boolean => el instanceof Element && el.closest("[role=slider],[role=listbox],input,select,textarea,.ps-cmp-stage") !== null;

export function StoryStyle(props: StoryProps): ReactElement {
  const { model, onOrientation, stacked = false } = props;
  const hasXray = props.xray !== undefined;
  const studio = useStudio();
  const cards = useMemo(() => storyCards(model, hasXray, studio), [model, hasXray, studio]);
  const [at, setAt] = useState(0);
  const [index, setIndex] = useState(false);
  const [sheet, setSheet] = useState<number | undefined>(undefined);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set([0]));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [own, setOwn] = useState<PaintedView | undefined>(undefined);
  const view = props.view ?? own ?? (frontHidesAllProblems(model) ? "wide" : "front");
  const setView = (v: PaintedView) => { setOwn(v); props.onView?.(v); };
  const last = cards.length - 1;
  const go = (i: number) => {
    const n = Math.max(0, Math.min(last, i));
    setAt(n); setSheet(undefined); setIndex(false); setSeen((s) => new Set(s).add(n));
  };
  const step = useEffectEvent((d: number) => { go(at + d); });
  const closeLayer = useEffectEvent((e: KeyboardEvent): boolean => {
    if (index) { e.preventDefault(); e.stopPropagation(); setIndex(false); return true; }
    if (sheet !== undefined) { e.preventDefault(); e.stopPropagation(); setSheet(undefined); return true; }
    return false;
  });
  useEffect(() => {
    if (stacked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { closeLayer(e); return; }
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || owned(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); };
  }, [stacked]);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const down = (e: ReactPointerEvent) => { start.current = owned(e.target) ? undefined : { x: e.clientX, y: e.clientY }; };
  const up = (e: ReactPointerEvent) => {
    const s = start.current; start.current = undefined;
    if (s === undefined || sheet !== undefined) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > 1.5 * Math.abs(e.clientY - s.y)) go(at + (dx < 0 ? 1 : -1));
  };
  const open = (tooth: number) => {
    const i = cards.findIndex((c) => c.kind === "tooth" && c.tooth === tooth);
    if (!stacked && i >= 0) go(i); else setSheet(tooth);
  };
  const toggle = (id: string) => { setTicked((t) => { const n = new Set(t); if (!n.delete(id)) n.add(id); return n; }); };
  const shown = stacked ? cards : cards.slice(at, at + 1);
  const card = cards[at];
  return (
    <div className="ps-story" data-present-style="story" data-card={card?.id} data-stacked={stacked ? "" : undefined}>
      <div className="ps-deck" onPointerDown={down} onPointerUp={up}>
        {sheet !== undefined && !stacked ? (
          <ToothSheet model={model} tooth={sheet} load3d={props.load3d} onBack={() => { setSheet(undefined); }} />
        ) : shown.map((c) => (
          <article key={c.id} className="ps-card" data-story-card={c.id} aria-label={c.title}>
            <p className="ps-eyebrow">{c.kind === "tooth" ? "A tooth to look at" : `Card ${String(cards.indexOf(c) + 1)} of ${String(cards.length)}`}</p>
            <h2 className="ps-card-h">{c.title}</h2>
            {c.kind === "mouth" ? <MouthCard {...props} view={view} setView={setView} onOrientation={onOrientation} open={open} /> : null}
            {c.kind === "found" ? <FactList model={model} onOpen={open} onBitingSide={view === "front" ? () => { setView("wide"); go(0); } : undefined} /> : null}
            {c.kind === "xray" ? <div className="ps-xr-card">{props.xray}<ProvenanceFooter recorded={["The image is your own X-ray, as it was taken."]} illustration={[]} /></div> : null}
            {c.kind === "tooth" && c.tooth !== undefined ? <ToothSheet embedded model={model} tooth={c.tooth} load3d={props.load3d} /> : null}
            {c.kind === "options" ? <OptionsCard studio={studio} card={c} /> : null}
            {c.kind === "plan" ? <PlanCard model={model} /> : null}
            {c.kind === "discussed" ? (
              <ul className="ps-discuss" aria-label="Tick what we talked about">
                {discussRows(model).map((r) => (
                  <li key={r.id}>
                    <button type="button" className="ps-tick" aria-pressed={ticked.has(r.id)} onClick={() => { toggle(r.id); }}>
                      <span className="ps-tickbox" aria-hidden="true">{ticked.has(r.id) ? "✓" : ""}</span>
                      <span><b>{r.words}</b>{r.where === undefined ? null : <small>{r.where}</small>}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {c.kind === "discussed" ? <p className="ps-muted">Ticks are for this showing only. Nothing is saved.</p> : null}
          </article>
        ))}
      </div>
      {stacked || cards.length < 2 ? null : (
        <nav className="ps-story-bar" aria-label="Cards">
          <button type="button" className="pm-chip ps-nav" aria-label="Previous card" disabled={at === 0} onClick={() => { go(at - 1); }}>←</button>
          <div className="ps-dots" role="group" aria-label="Progress">
            {cards.map((c, i) => (
              <button key={c.id} type="button" className="ps-pdot" data-seen={seen.has(i) ? "" : undefined} aria-current={i === at ? "step" : undefined} aria-label={`Card ${String(i + 1)} of ${String(cards.length)}: ${c.title}`} onClick={() => { go(i); }}><i /></button>
            ))}
          </div>
          <button type="button" className="pm-chip" aria-expanded={index} onClick={() => { setIndex(!index); }}>All cards</button>
          <button type="button" className="pm-chip ps-nav" aria-label="Next card" disabled={at === last} onClick={() => { go(at + 1); }}>→</button>
        </nav>
      )}
      {index && !stacked ? (
        <div className="ps-index" role="dialog" aria-label="All cards">
          <ol>
            {cards.map((c, i) => (
              <li key={c.id}><button type="button" className="ps-jump" aria-current={i === at ? "step" : undefined} onClick={() => { go(i); }}><b>{i + 1}</b><span>{c.title}</span></button></li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function MouthCard({ model, orientation, onOrientation, theme, view, setView, open }: StoryProps & { view: PaintedView; setView: (v: PaintedView) => void; open: (t: number) => void }): ReactElement {
  const hidden = bitingSideProblems(model);
  return (
    <>
      <div className="ps-knobs">
        <div className="ps-seg" role="group" aria-label="Picture">
          <button type="button" aria-pressed={view === "front"} onClick={() => { setView("front"); }}>Front</button>
          <button type="button" aria-pressed={view === "wide"} onClick={() => { setView("wide"); }}>Open wide</button>
        </div>
        <div className="ps-seg" role="group" aria-label="Which way round">
          {(["mirror", "photo"] as const).map((o) => (
            <button key={o} type="button" aria-pressed={orientation === o} onClick={() => { onOrientation(o); }}>{o === "mirror" ? "As in your mirror" : "As in a photo"}</button>
          ))}
        </div>
      </div>
      {view === "front" && hidden.length > 0 ? (
        <button type="button" className="ps-prompt" onClick={() => { setView("wide"); }}>
          <span>{hidden.length === 1 ? "1 problem is on the biting side, out of sight from the front." : `${String(hidden.length)} problems are on the biting side, out of sight from the front.`}</span>
          <b>Open wide to see {hidden.length === 1 ? "it" : "them"}</b>
        </button>
      ) : null}
      {view === "wide" ? <OpenWide model={model} orientation={orientation} theme={theme} onOpen={open} /> : <PaintedMap model={model} orientation={orientation} shade="natural" theme={theme} onOpen={open} />}
      <ProvenanceFooter recorded={["The dots come from this visit's record."]} illustration={["Tooth shapes and colours are a painting based on your record, not a photo."]} />
    </>
  );
}

function PlanCard({ model }: { model: PresentModel }): ReactElement {
  const items = planFacts(model);
  return (
    <>
      <ul className="ps-plan">
        {items.map((f) => (
          <li key={f.id} className="ps-fact" data-kind={f.kind} data-plan={f.id}>
            <span className="ps-where">{f.where}{f.tooth === undefined ? null : <span className="ps-fdi">{` · ${String(f.tooth)}`}</span>}</span>
            <b>{f.words}</b>
            <RecordBadge on={f.recorded_on} />
          </li>
        ))}
      </ul>
      {model.next_visit === undefined ? null : <p className="ps-next">{`Next visit: ${dayLabel(model.next_visit)}`}</p>}
      <ProvenanceFooter recorded={["This list comes from this visit's record."]} illustration={[]} />
    </>
  );
}

/** The style module's shape (§6). */
export const storyStyle = { id: "story" as const, label: "Story cards", Component: StoryStyle };

function OptionsCard({ studio, card }: { studio: PresentStudio | undefined; card: StoryCard }): ReactElement | null {
  const situation = studio?.situations.find((s) => s.tooth === card.tooth && s.key === card.situation);
  return situation === undefined ? null : <SituationOptions situation={situation} titled={false} />;
}
