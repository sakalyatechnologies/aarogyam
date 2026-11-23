// Usual options (present-studio-design §8.2, slice 2a): the options compared for a situation the record shows
// (deep decay, a missing tooth, a wisdom tooth not fully out), from the server's studio layer. Every number
// is general guidance ("usually 2-3 visits"), never a visit of this patient: no visit numbers, no dates and, in
// this slice, no prices. Outcome words come from the server only. A card list or a side-by-side compare.
import { createContext, lazy, Suspense, useContext, useState, type ReactElement, type ReactNode } from "react";

import type { PresentOption, PresentSituation, PresentStudio } from "@aarogyam/api-client";

import { IllustrationBadge, RecordBadge } from "./blocks.js";

// The usual-plan steps load on open, so the Show patient route stays within its size budget (§13).
const CaseFor = lazy(() => import("./case.js").then((m) => ({ default: m.CaseForOption })));

const StudioContext = createContext<PresentStudio | undefined>(undefined);

/** Gives every Show patient style the studio layer (`GET /visits/{id}/present`); without it no options show. */
export function StudioProvider({ studio, children }: { studio: PresentStudio | undefined; children: ReactNode }): ReactElement {
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

export const useStudio = (): PresentStudio | undefined => useContext(StudioContext);

/** The situations recorded on one tooth. */
export const situationsOf = (studio: PresentStudio | undefined, tooth: number): PresentSituation[] =>
  studio?.situations.filter((s) => s.tooth === tooth) ?? [];

const span = (min: number, max: number) => (min === max ? String(min) : `${String(min)}–${String(max)}`);

export const visitsWords = (o: PresentOption): string =>
  o.visits.max === 0 ? "No treatment visits" : `Usually ${span(o.visits.min, o.visits.max)} ${o.visits.max === 1 ? "visit" : "visits"}`;
export const finishWords = (o: PresentOption): string =>
  o.finish === undefined ? "Nothing to finish" : `Usually ${span(o.finish.min, o.finish.max)} ${o.finish.max === 1 ? o.finish.unit.replace(/s$/, "") : o.finish.unit}`;

const GUIDANCE = "General guidance, not a promise. Your dentist will advise.";

function Lifespan({ o }: { o: PresentOption }): ReactElement {
  if (o.lifespan === undefined) return <span className="ps-muted">No usual figure</span>;
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

const ROWS: readonly { id: string; label: string; cell: (o: PresentOption) => ReactNode }[] = [
  { id: "what", label: "What is done", cell: (o) => o.summary },
  { id: "visits", label: "Visits", cell: visitsWords },
  { id: "finish", label: "Time to finish", cell: finishWords },
  { id: "look", label: "How it looks", cell: (o) => o.looks_like },
  { id: "life", label: "How long it usually lasts", cell: (o) => <Lifespan o={o} /> },
  { id: "comfort", label: "Comfort", cell: (o) => o.comfort },
];

/** One situation: its options as cards or side by side. */
export function SituationOptions({ situation, titled = true }: { situation: PresentSituation; titled?: boolean }): ReactElement {
  const [mode, setMode] = useState<"cards" | "compare">("cards");
  return (
    <section className="ps-opts" aria-label={`Usual options: ${situation.title}`} data-situation={`${situation.key}:${String(situation.tooth)}`}>
      {titled ? <h3 className="ps-h">{situation.title}<RecordBadge /></h3> : null}
      <h4 className="ps-h">Usual options · general guidance</h4>
      <p className="ps-muted">These are the usual ways to deal with this. Your dentist will advise what suits your tooth.</p>
      <div className="ps-seg" role="group" aria-label="Options view">
        <button type="button" aria-pressed={mode === "cards"} onClick={() => { setMode("cards"); }}>Cards</button>
        <button type="button" aria-pressed={mode === "compare"} onClick={() => { setMode("compare"); }}>Compare</button>
      </div>
      {mode === "cards" ? (
        <ul className="ps-opt-list">
          {situation.options.map((o) => (
            <li key={o.key} className="ps-opt" data-option={o.key}>
              <b className="ps-opt-h">{o.label}</b>
              <dl className="ps-opt-facts">
                {ROWS.map((r) => (
                  <div key={r.id} data-row={r.id}><dt>{r.label}</dt><dd>{r.cell(o)}</dd></div>
                ))}
              </dl>
              <Suspense fallback={null}><CaseFor optionKey={o.key} situationKey={situation.key} /></Suspense>
              <IllustrationBadge>Illustration · general guidance</IllustrationBadge>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ps-opt-scroll">
          <table className="ps-opt-table" aria-label={`Usual options: ${situation.title}`}>
            <thead>
              <tr>
                <td />
                {situation.options.map((o) => <th key={o.key} scope="col" data-option={o.key}>{o.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.id} data-row={r.id}>
                  <th scope="row">{r.label}</th>
                  {situation.options.map((o) => <td key={o.key}>{r.cell(o)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <IllustrationBadge>Illustration · general guidance</IllustrationBadge>
        </div>
      )}
    </section>
  );
}

/** A tooth's options in a tooth sheet: one block per situation recorded on it; nothing when it has none. */
export function ToothOptions({ tooth }: { tooth: number }): ReactElement | null {
  const found = situationsOf(useStudio(), tooth);
  if (found.length === 0) return null;
  return <>{found.map((s) => <SituationOptions key={s.key} situation={s} titled={found.length > 1} />)}</>;
}
