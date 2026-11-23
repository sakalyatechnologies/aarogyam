// A usual case (present-studio-design §8.5, slice 2d-1): the steps of one common treatment, from
// specialties/dental/present/cases/*.json. General guidance, never this patient: no visit numbers, no dates, no prices.
import type { ReactElement } from "react";

import implant from "../../../../../specialties/dental/present/cases/implant.json" with { type: "json" };
import wisdom from "../../../../../specialties/dental/present/cases/wisdom.json" with { type: "json" };

export interface CaseData {
  key: string;
  title: string;
  lead: string;
  steps: { key: string; label: string; words: string; art: string; usual?: { min: number; max: number; unit: string } }[];
}

export const IMPLANT_CASE: CaseData = implant;
export const WISDOM_CASE: CaseData = wisdom;

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

/** The usual plan for an option, if it has one: implant options, and removing a wisdom tooth. */
export function CaseForOption({ optionKey, situationKey }: { optionKey: string; situationKey: string }): ReactElement | null {
  if (IMPLANT_OPTION_KEYS.includes(optionKey)) return <UsualCase data={IMPLANT_CASE} />;
  if (optionKey === "remove" && WISDOM_SITUATION_KEYS.includes(situationKey)) return <UsualCase data={WISDOM_CASE} />;
  return null;
}
