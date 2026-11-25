// The story cards style (present-studio-design §6.1, slice 1d), the default Show patient style. One card at
// a time, in a fixed order, built only from the visit's facts: your mouth (painted map), what we found, one
// card per recorded problem tooth (tooth sheet and slider) each followed by its choices, then "Your plan".
// No card is invented: choices arrive with the studio data, the plan with the plan items the host passes.
// Navigation: swipe, the arrow keys, progress dots and an "All cards" index. Prices sit behind the Prices tap.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";

import { formatRupees } from "../format.js";
import { dayLabel } from "../mouth-view/model.js";
import { FactList, ProvenanceFooter, RecordBadge } from "./blocks.js";
import type { FactItem, Orientation, PresentModel } from "./model.js";
import { OpenWide, bitingSideProblems, frontHidesAllProblems } from "./open-wide.js";
import { PaintedMap, type PaintedView } from "./painted.js";
import { DEFAULT_SHADE, type Shade } from "./painter.js";
import { ToothSheet, yourTreatment, type ToothSheetProps } from "./tooth-sheet.js";
import { SituationOptions, situationTitle, useStudio } from "./options.js";
import type { PresentStudio } from "@aarogyam/api-client";
import type { SnapTooth } from "../mouth-view/model.js";

export type StoryCardKind = "mouth" | "found" | "tooth" | "options" | "plan" | "xray";
export interface StoryCard {
  id: string; kind: StoryCardKind; title: string; tooth?: number; situation?: string;
  /** The tooth already has a planned or started treatment: its other choices fold under "Other ways". */
  midTreatment?: boolean;
}

/** One step of the patient's plan (a treatment plan item), as the host passes it. */
export interface PlanLine { id: string; name: string; phase: number; status: string; estimate_paise: number; tooth?: number | null | undefined }

const PLAN_KINDS = new Set<FactItem["kind"]>(["recommended", "plan", "in_progress"]);
export const planFacts = (m: PresentModel): FactItem[] => m.facts.filter((f) => PLAN_KINDS.has(f.kind));
const problemTeeth = (m: PresentModel): number[] => [...new Set(m.facts.flatMap((f) => (f.kind === "problem" && f.tooth !== undefined ? [f.tooth] : [])))];

/** The cards, from the facts only. Pure: no fact, no card. Each problem tooth is followed by its choices. */
export function storyCards(m: PresentModel, hasXray = false, studio?: PresentStudio, plans: readonly PlanLine[] = []): StoryCard[] {
  const cards: StoryCard[] = [{ id: "mouth", kind: "mouth", title: "Here is your mouth" }];
  if (m.facts.length > 0) cards.push({ id: "found", kind: "found", title: "What we found" });
  if (hasXray) cards.push({ id: "xray", kind: "xray", title: "Your X-ray" });
  const situations = studio?.situations ?? [];
  const addOptions = (t: number) => {
    const mid = yourTreatment(m, t) !== undefined;
    for (const s of situations) if (s.tooth === t) cards.push({ id: `options:${String(s.tooth)}:${s.key}`, kind: "options", tooth: s.tooth, situation: s.key, title: `Usual options · ${situationTitle(s)}`, ...(mid ? { midTreatment: true } : {}) });
  };
  const teeth = problemTeeth(m);
  for (const t of teeth) {
    const where = m.facts.find((f) => f.tooth === t)?.where;
    cards.push({ id: `tooth:${String(t)}`, kind: "tooth", tooth: t, title: `${where ?? "Tooth"} · ${String(t)}` });
    addOptions(t);
  }
  // choices for a tooth with no problem card of its own (a missing or a wisdom tooth) follow the rest
  for (const t of [...new Set(situations.map((s) => s.tooth))]) if (!teeth.includes(t)) addOptions(t);
  if (planFacts(m).length > 0 || openPlanLines(plans).length > 0) cards.push({ id: "plan", kind: "plan", title: "Your plan" });
  return cards;
}

/** The plan steps, in order (phase, then the order given). Cancelled steps are not the patient's plan. */
export const openPlanLines = (plans: readonly PlanLine[]): PlanLine[] =>
  plans.filter((p) => p.status !== "cancelled").map((p, i) => ({ p, i })).sort((a, b) => a.p.phase - b.p.phase || a.i - b.i).map((x) => x.p);

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
  /** The tooth colour (0 to 100), the patient's saved one when the host has it. */
  shade?: Shade | undefined;
  /** The patient's treatment plan steps, when the host has them. Without them the plan card lists the recorded plan facts only. */
  plans?: readonly PlanLine[] | undefined;
}

const SWIPE = 60;
/** Keys and swipes that belong to a control (the slider, a field, a list) are not card navigation. */
const owned = (el: EventTarget | null): boolean => el instanceof Element && el.closest("[role=slider],[role=listbox],input,select,textarea,.ps-cmp-stage") !== null;

export function StoryStyle(props: StoryProps): ReactElement {
  const { model, onOrientation, stacked = false } = props;
  const hasXray = props.xray !== undefined;
  const studio = useStudio();
  const cards = useMemo(() => storyCards(model, hasXray, studio, props.plans), [model, hasXray, studio, props.plans]);
  const [at, setAt] = useState(0);
  const [index, setIndex] = useState(false);
  const [sheet, setSheet] = useState<number | undefined>(undefined);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set([0]));
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
            {c.kind === "found" ? <FactList model={model} pastBehindToggle={!stacked} onOpen={open} onBitingSide={view === "front" ? () => { setView("wide"); go(0); } : undefined} /> : null}
            {c.kind === "xray" ? <div className="ps-xr-card">{props.xray}<ProvenanceFooter recorded={["The image is your own X-ray, as it was taken."]} illustration={[]} /></div> : null}
            {c.kind === "tooth" && c.tooth !== undefined ? <ToothSheet embedded model={model} tooth={c.tooth} load3d={props.load3d} /> : null}
            {c.kind === "options" ? <OptionsCard studio={studio} card={c} record={model.teeth.find((t) => t.tooth === c.tooth)?.record} /> : null}
            {c.kind === "plan" ? <PlanCard model={model} plans={props.plans} studio={studio} /> : null}
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

function MouthCard({ model, orientation, theme, view, setView, open, shade }: StoryProps & { view: PaintedView; setView: (v: PaintedView) => void; open: (t: number) => void }): ReactElement {
  const hidden = bitingSideProblems(model);
  return (
    <>
      <div className="ps-knobs">
        <div className="ps-seg" role="group" aria-label="Picture">
          <button type="button" aria-pressed={view === "front"} onClick={() => { setView("front"); }}>Front</button>
          <button type="button" aria-pressed={view === "wide"} onClick={() => { setView("wide"); }}>Open wide</button>
        </div>
      </div>
      {view === "front" && hidden.length > 0 ? (
        <button type="button" className="ps-prompt" onClick={() => { setView("wide"); }}>
          <span>{hidden.length === 1 ? "1 problem is on the biting side, out of sight from the front." : `${String(hidden.length)} problems are on the biting side, out of sight from the front.`}</span>
          <b>Open wide to see {hidden.length === 1 ? "it" : "them"}</b>
        </button>
      ) : null}
      {view === "wide" ? <OpenWide model={model} orientation={orientation} theme={theme} onOpen={open} /> : <PaintedMap model={model} orientation={orientation} shade={shade ?? DEFAULT_SHADE} theme={theme} onOpen={open} />}
      <ProvenanceFooter recorded={["The dots come from this visit's record."]} illustration={["Tooth shapes and colours are a painting based on your record, not a photo."]} />
    </>
  );
}

function PlanCard({ model, plans = [], studio }: { model: PresentModel; plans?: readonly PlanLine[] | undefined; studio: PresentStudio | undefined }): ReactElement {
  const lines = openPlanLines(plans);
  const facts = planFacts(model);
  // the Prices tap (F3): the server sends prices only with billing.read and show_prices; nothing shows a rupee amount before the tap
  const canPrice = studio?.prices !== undefined && lines.length > 0;
  const [priced, setPriced] = useState(false);
  const left = lines.filter((l) => l.status !== "done");
  const visits = new Set(left.map((l) => l.phase)).size;
  const total = left.reduce((n, l) => n + l.estimate_paise, 0);
  const where = (t: number | null | undefined) => (t === undefined || t === null ? "" : ` · tooth ${String(t)}`);
  return (
    <>
      {lines.length > 0 ? (
        <>
          <ol className="ps-plan ps-plan-steps">
            {lines.map((l) => (
              <li key={l.id} className="ps-fact" data-plan-line={l.id} data-done={l.status === "done" ? "" : undefined}>
                <b>{`${l.name}${where(l.tooth)}`}</b>
                {l.status === "done" ? <span className="ps-note">Done</span> : null}
              </li>
            ))}
          </ol>
          {visits > 0 ? <p className="ps-muted ps-plan-count">{`${String(left.length)} ${left.length === 1 ? "step" : "steps"} still to do, over ${String(visits)} ${visits === 1 ? "visit" : "visits"}.`}</p> : null}
        </>
      ) : (
        <ul className="ps-plan">
          {facts.map((f) => (
            <li key={f.id} className="ps-fact" data-kind={f.kind} data-plan={f.id}>
              <span className="ps-where">{f.where}{f.tooth === undefined ? null : <span className="ps-fdi">{` · ${String(f.tooth)}`}</span>}</span>
              <b>{f.words}</b>
              <RecordBadge on={f.recorded_on} />
            </li>
          ))}
        </ul>
      )}
      {canPrice ? (
        <div className="ps-seg" role="group" aria-label="Plan cost">
          <button type="button" aria-pressed={priced} onClick={() => { setPriced(!priced); }}>Prices</button>
        </div>
      ) : null}
      {canPrice && priced && total > 0 ? (
        <p className="ps-plan-total" data-plan-total="">
          <b>{`About ${formatRupees(total)} in all`}</b>
          <small>Final cost after examination</small>
        </p>
      ) : null}
      {model.next_visit === undefined ? null : <p className="ps-next">{`Next visit: ${dayLabel(model.next_visit)}`}</p>}
      <p className="ps-next-step" data-next-step="">{model.next_visit === undefined ? "Ask the front desk to book your next visit" : "Come to your next visit on that day"}</p>
      <ProvenanceFooter recorded={["This list comes from this visit's record."]} illustration={[]} />
    </>
  );
}

/** The style module's shape (§6). */
export const storyStyle = { id: "story" as const, label: "Story cards", Component: StoryStyle };

function OptionsCard({ studio, card, record }: { studio: PresentStudio | undefined; card: StoryCard; record?: SnapTooth | undefined }): ReactElement | null {
  const situation = studio?.situations.find((s) => s.tooth === card.tooth && s.key === card.situation);
  if (situation === undefined) return null;
  const options = <SituationOptions situation={situation} titled={false} record={record} />;
  // a tooth already in treatment keeps its plan up front; the other choices wait one tap away
  if (card.midTreatment !== true) return options;
  return (
    <>
      <p className="ps-muted">{`Tooth ${String(card.tooth ?? "")} already has a treatment under way. Other ways are here if you want to compare.`}</p>
      <details className="ps-other"><summary>{`Other ways to treat it (${String(situation.options.length)})`}</summary>{options}</details>
    </>
  );
}
