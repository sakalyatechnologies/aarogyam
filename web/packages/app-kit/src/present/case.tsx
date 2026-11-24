// A usual case (present-studio-design §8.5, slice 2d-1): the steps of one common treatment, from
// specialties/dental/present/cases/*.json. General guidance, never this patient: no visit numbers, no dates, no prices.
import { lazy, Suspense, type ReactElement } from "react";

import implant from "../../../../../specialties/dental/present/cases/implant.json" with { type: "json" };
import wisdom from "../../../../../specialties/dental/present/cases/wisdom.json" with { type: "json" };
import bridge from "../../../../../specialties/dental/present/cases/bridge.json" with { type: "json" };
import scaling from "../../../../../specialties/dental/present/cases/scaling.json" with { type: "json" };
import veneer from "../../../../../specialties/dental/present/cases/veneer.json" with { type: "json" };
import braces from "../../../../../specialties/dental/present/cases/braces.json" with { type: "json" };
import aligners from "../../../../../specialties/dental/present/cases/aligners.json" with { type: "json" };

// the example-arch picture lives in its own lazy chunk (it carries the front atlas)
const Straighter = lazy(() => import("./straighter-teeth.js").then((m) => ({ default: m.StraighterTeeth })));


export interface CaseData {
  key: string;
  title: string;
  lead: string;
  steps: { key: string; label: string; words: string; art: string; usual?: { min: number; max: number; unit: string } }[];
}

export const IMPLANT_CASE: CaseData = implant;
export const WISDOM_CASE: CaseData = wisdom;
export const BRIDGE_CASE: CaseData = bridge;
export const SCALING_CASE: CaseData = scaling;
export const VENEER_CASE: CaseData = veneer;
export const BRACES_CASE: CaseData = braces;
export const ALIGNERS_CASE: CaseData = aligners;

/** Option keys whose card offers the implant case. */
export const IMPLANT_OPTION_KEYS: readonly string[] = ["implant", "extract_implant"];

/** Situation keys whose "remove" card offers the wisdom case. */
export const WISDOM_SITUATION_KEYS: readonly string[] = ["impacted_wisdom"];

const usuallyWords = (u: { min: number; max: number; unit: string }): string =>
  `Usually ${u.min === u.max ? String(u.min) : `${String(u.min)}–${String(u.max)}`} ${u.unit}`;

export function UsualCase({ data }: { data: CaseData }): ReactElement {
  return (
    <details className="ps-case" data-case={data.key}>
      <summary>{data.title}</summary>
      <p className="ps-muted">{data.lead}</p>
      <ol>
        {data.steps.map((s) => (
          <li key={s.key} data-step={s.key} data-art={s.art}>
            <b>{s.label}</b> {s.words}
            {s.usual === undefined ? null : <small>{` ${usuallyWords(s.usual)}.`}</small>}
          </li>
        ))}
      </ol>
      <small>Usual plan · general guidance</small>
    </details>
  );
}

/** The usual plan for an option, if it has one: implant options, a bridge for a missing tooth, and removing a wisdom tooth.
 * Scaling and veneers have no recorded situation to hang from yet; their cases are exported for the cards that will. */
export function CaseForOption({ optionKey, situationKey }: { optionKey: string; situationKey: string }): ReactElement | null {
  if (IMPLANT_OPTION_KEYS.includes(optionKey)) return <UsualCase data={IMPLANT_CASE} />;
  if (optionKey === "bridge" && situationKey === "missing") return <UsualCase data={BRIDGE_CASE} />;
  if (optionKey === "remove" && WISDOM_SITUATION_KEYS.includes(situationKey)) return <UsualCase data={WISDOM_CASE} />;
  if (optionKey === "orthodontic_fixed" || optionKey === "braces") return <Suspense fallback={null}><Straighter data={BRACES_CASE} /></Suspense>;
  if (optionKey === "aligners") return <Suspense fallback={null}><Straighter data={ALIGNERS_CASE} /></Suspense>;
  return null;
}
