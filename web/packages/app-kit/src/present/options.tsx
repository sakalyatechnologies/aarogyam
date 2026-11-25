// Usual options (present-studio-design §8.2, slice 2a): the options compared for a situation the record shows
// (deep decay, a missing tooth, a wisdom tooth not fully out), from the server's studio layer. Every number
// is general guidance ("usually 2-3 visits"), never a visit of this patient: no visit numbers and no dates. Prices (slice 2b)
// sit behind the doctor's Prices tap and exist only when the server sent them (billing.read and show_prices). Outcome words come from the server only. A card list or a side-by-side compare.
import { createContext, lazy, Suspense, useContext, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";

import type { PresentOption, PresentSituation, PresentStudio } from "@aarogyam/api-client";

import { formatRupees } from "../format.js";
import type { SnapTooth } from "../mouth-view/model.js";
import { IllustrationBadge, RecordBadge } from "./blocks.js";
import { PinButton } from "./pins.js";

// The usual-plan steps load on open, so the Show patient route stays within its size budget (§13).
const GoButton = lazy(() => import("./doctor-bits.js").then((m) => ({ default: m.GoButton })));
const CaseFor = lazy(() => import("./case.js").then((m) => ({ default: m.CaseForOption })));

// What the doctor's own screen adds to Show patient (Edit a tooth, Go with this, a photo from today). The portal sets these from a
// lazy host; the phone bundle and the patient's page never do, so none of it shows there.
/** One option of one situation on one tooth. */
export interface ChooseTarget { tooth: number; situation: string; option: string }

export interface PresentActions {
  /** Edit a tooth without leaving Show patient. Given only to people who may write the chart. */
  onEditTooth?: ((fdi: number) => void) | undefined;
  /** Go with this option: plan it on the tooth. */
  onChoose?: ((target: ChooseTarget) => void) | undefined;
  /** Whether an option can be chosen (it maps to one treatment). */
  canChoose?: ((target: ChooseTarget) => boolean) | undefined;
  /** The tooth's photo from today, drawn under its picture. */
  photo?: ((tooth: number) => ReactNode) | undefined;
  /** An overlay is open over the tooth sheet: Esc belongs to it. */
  overlayOpen?: boolean | undefined;
}

const NONE: PresentActions = {};
let current: PresentActions = NONE;
const listeners = new Set<() => void>();

/** Sets the actions Show patient offers; `undefined` takes them away. */
export function setPresentActions(actions: PresentActions | undefined): void {
  current = actions ?? NONE;
  listeners.forEach((l) => { l(); });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const useActions = (): PresentActions => useSyncExternalStore(subscribe, () => current, () => NONE);

const StudioContext = createContext<PresentStudio | undefined>(undefined);

/** Gives every Show patient style the studio layer (`GET /visits/{id}/present`); without it no options show. */
export function StudioProvider({ studio, children }: { studio: PresentStudio | undefined; children: ReactNode }): ReactElement {
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

export const useStudio = (): PresentStudio | undefined => useContext(StudioContext);

/** The situations recorded on one tooth. */
export const situationsOf = (studio: PresentStudio | undefined, tooth: number): PresentSituation[] =>
  studio?.situations.filter((s) => s.tooth === tooth) ?? [];

/**
 * The situation's words. When only the plan suggested it (`from_plan`), nothing recorded shows the problem, so say what the doctor
 * recommends (the suggested option) and never name a finding.
 */
export const situationTitle = (s: PresentSituation): string => {
  if (s.from_plan !== true) return s.title;
  const pick = s.options.find((o) => o.suggested === true)?.label;
  return pick === undefined ? "Your doctor's plan" : `Your doctor recommends: ${pick.charAt(0).toLowerCase()}${pick.slice(1)}`;
};

const span = (min: number, max: number) => (min === max ? String(min) : `${String(min)}–${String(max)}`);

export const visitsWords = (o: PresentOption): string =>
  o.visits.max === 0 ? "No treatment visits" : `Usually ${span(o.visits.min, o.visits.max)} ${o.visits.max === 1 ? "visit" : "visits"}`;
export const finishWords = (o: PresentOption): string =>
  o.finish === undefined ? "Nothing to finish" : `Usually ${span(o.finish.min, o.finish.max)} ${o.finish.max === 1 ? o.finish.unit.replace(/s$/, "") : o.finish.unit}`;

const GUIDANCE = "General guidance, not a promise. Your dentist will advise.";

function Lifespan({ o }: { o: PresentOption }): ReactElement {
  if (o.lifespan === undefined) return <></>;
  const { words, why, source, source_quote } = o.lifespan;
  return (
    <span className="ps-opt-life">
      <b>{words}</b>
      <small>{GUIDANCE}</small>
      {why === undefined ? null : (
        <details>
          <summary>Why we say this</summary>
          <span>{why}</span>
          {source === undefined ? null : <small>{`Source: ${source}`}</small>}
          {source_quote === undefined ? null : <q>{source_quote}</q>}
        </details>
      )}
    </span>
  );
}

/** The cost cell: a "from" number only when every part of the option is mapped to the clinic's price list. */
function costWords(studio: PresentStudio | undefined, o: PresentOption): string {
  const price = studio?.prices?.find((p) => p.option_key === o.key);
  return price === undefined
    ? "Ask the front desk for the cost"
    : `From ${formatRupees(price.from_paise)} · this clinic's price list · final cost after examination`;
}

export const OPTION_ROWS: readonly { id: string; label: string; cell: (o: PresentOption) => ReactNode }[] = [
  { id: "what", label: "What is done", cell: (o) => o.summary },
  { id: "visits", label: "Visits", cell: visitsWords },
  { id: "finish", label: "Time to finish", cell: finishWords },
  { id: "look", label: "How it looks", cell: (o) => o.looks_like },
  { id: "life", label: "How long it usually lasts", cell: (o) => (o.lifespan === undefined ? null : <Lifespan o={o} />) },
  { id: "comfort", label: "Comfort", cell: (o) => o.comfort },
];

const OptionPicture = lazy(() => import("./option-art.js").then((m) => ({ default: m.OptionPicture })));
const OptionCompare = lazy(() => import("./option-art.js").then((m) => ({ default: m.OptionCompare })));

/** The dentist's suggestion (additive API field `suggested`); absent on older servers. */
export const isSuggested = (o: PresentOption): boolean => o.suggested ?? false;

const filled = (n: ReactNode): boolean => n !== null && n !== undefined && n !== false && n !== "";

/** One situation: its options as cards or side by side, each with a picture; a tap opens now vs that choice. */
export function SituationOptions({ situation, titled = true, record }: { situation: PresentSituation; titled?: boolean; record?: SnapTooth | undefined }): ReactElement {
  const [mode, setMode] = useState<"cards" | "compare">("cards");
  const [open, setOpen] = useState<string | undefined>(undefined);
  const studio = useStudio();
  const actions = useActions();
  // "Go with this": the doctor's own screen only, on an option that is not already the suggestion
  const choose = (o: PresentOption): ReactElement | null => {
    const target = { tooth: situation.tooth, situation: situation.key, option: o.key };
    if (actions.onChoose === undefined || isSuggested(o) || actions.canChoose?.(target) === false) return null;
    return <Suspense fallback={null}><GoButton onGo={() => { actions.onChoose?.(target); }} /></Suspense>;
  };
  // The Prices tap exists only when the server sent prices; nothing shows a rupee amount before it.
  const canPrice = studio?.prices !== undefined;
  const [priced, setPriced] = useState(false);
  // the dentist's suggestion first; the rest keep the server's order
  const options = [...situation.options.filter(isSuggested), ...situation.options.filter((o) => !isSuggested(o))];
  const all = canPrice && priced ? [...OPTION_ROWS, { id: "cost", label: "Cost", cell: (o: PresentOption) => costWords(studio, o) }] : OPTION_ROWS;
  // a row nobody has anything to say in is not shown
  const rows = all.filter((r) => options.some((o) => filled(r.cell(o))));
  const opened = options.find((o) => o.key === open);
  const tooth = `Tooth ${String(situation.tooth)}`;
  const art = (o: PresentOption) => ({ tooth: situation.tooth, look: o.look, situationKey: situation.key, record, label: o.label });
  const pic = (o: PresentOption): ReactElement => (
    <button type="button" className="ps-opt-pic" aria-expanded={open === o.key} aria-label={`See before and after: ${o.label}`} onClick={() => { setOpen(open === o.key ? undefined : o.key); }}>
      <Suspense fallback={null}><OptionPicture {...art(o)} /></Suspense>
      <span>See before and after</span>
    </button>
  );
  return (
    <section className="ps-opts" aria-label={`Usual options: ${situationTitle(situation)}`} data-situation={`${situation.key}:${String(situation.tooth)}`}>
      {titled ? <h3 className="ps-h">{`${tooth}: ${situationTitle(situation)}`}<RecordBadge /></h3> : null}
      <h4 className="ps-h">{`Your choices for ${tooth.toLowerCase()}`}</h4>
      <p className="ps-muted">These are the usual ways to deal with this (general guidance). Your dentist will advise what suits your tooth.</p>
      <div className="ps-seg" role="group" aria-label="Options view">
        <button type="button" aria-pressed={mode === "cards"} onClick={() => { setMode("cards"); }}>Cards</button>
        <button type="button" aria-pressed={mode === "compare"} onClick={() => { setMode("compare"); }}>Compare</button>
        {canPrice ? <button type="button" aria-pressed={priced} onClick={() => { setPriced(!priced); }}>Prices</button> : null}
      </div>
      {mode === "cards" ? (
        <ul className="ps-opt-list">
          {options.map((o) => (
            <li key={o.key} className="ps-opt" data-option={o.key} data-suggested={isSuggested(o) ? "" : undefined}>
              {isSuggested(o) ? <span className="ps-opt-sugg">Your dentist suggests</span> : null}
              <div className="ps-opt-top"><b className="ps-opt-h">{o.label}</b><PinButton situation={situation} option={o} /></div>
              {pic(o)}
              <dl className="ps-opt-facts">
                {rows.filter((r) => filled(r.cell(o))).map((r) => (
                  <div key={r.id} data-row={r.id}><dt>{r.label}</dt><dd>{r.cell(o)}</dd></div>
                ))}
              </dl>
              <Suspense fallback={null}><CaseFor optionKey={o.key} situationKey={situation.key} /></Suspense>
              {choose(o)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="ps-opt-scroll">
          <table className="ps-opt-table" aria-label={`Usual options: ${situationTitle(situation)}`}>
            <thead>
              <tr>
                <td />
                {options.map((o) => (
                  <th key={o.key} scope="col" data-option={o.key}>
                    {isSuggested(o) ? <span className="ps-opt-sugg">Your dentist suggests</span> : null}
                    {o.label}<PinButton situation={situation} option={o} />{pic(o)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-row={r.id}>
                  <th scope="row">{r.label}</th>
                  {options.map((o) => <td key={o.key}>{filled(r.cell(o)) ? r.cell(o) : "–"}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {opened === undefined ? null : (
        <div className="ps-opt-ba" data-compare-for={opened.key}>
          <Suspense fallback={null}><OptionCompare {...art(opened)} /></Suspense>
          <button type="button" className="ps-opt-close" onClick={() => { setOpen(undefined); }}>Close</button>
        </div>
      )}
      <IllustrationBadge>Illustration · general guidance</IllustrationBadge>
    </section>
  );
}

/** A tooth's options in a tooth sheet: one block per situation recorded on it; nothing when it has none. */
export function ToothOptions({ tooth, record }: { tooth: number; record?: SnapTooth | undefined }): ReactElement | null {
  const found = situationsOf(useStudio(), tooth);
  if (found.length === 0) return null;
  return <>{found.map((s) => <SituationOptions key={s.key} situation={s} titled={found.length > 1} record={record} />)}</>;
}
