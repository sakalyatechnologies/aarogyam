import { useMemo } from "react";

import type { ChartEntry, PlanItem } from "@aarogyam/api-client";

import { ARCHES, FINDING_ORDER, FINDING_STYLE, describeTooth, EMPTY_STATE, headline, kindOf, toothStates, treatmentsByTooth } from "../../../visits/odontogram/model.js";
import { inProgressTeeth } from "./model.js";
import type { ChartDentition, ChartLook } from "./use-chart-prefs.js";
import "./tooth-chart.css";

export const LOOKS = [
  { value: "rows", label: "Rows" },
  { value: "arch", label: "3D arch" },
  { value: "classic", label: "Classic" },
] as const satisfies readonly { value: ChartLook; label: string }[];
export const DENTITIONS = [
  { value: "adult", label: "Adult" },
  { value: "child", label: "Child" },
] as const satisfies readonly { value: ChartDentition; label: string }[];

interface Props {
  look: ChartLook;
  dentition: ChartDentition;
  current: readonly ChartEntry[];
  planItems: readonly PlanItem[];
  selected: number | undefined;
  onSelect: (tooth: number) => void;
}

/** The chart: rows or a 3D arch, adult or child teeth. Tapping a tooth selects it; recording happens in the panel beside it. */
export function ToothChart({ look, dentition, current, planItems, selected, onSelect }: Props) {
  const states = useMemo(() => toothStates(current, treatmentsByTooth(planItems)), [current, planItems]);
  const progress = useMemo(() => inProgressTeeth(current), [current]);
  const arches = ARCHES[dentition];

  const tooth = (n: number, style?: React.CSSProperties, className = "tc-tooth") => {
    const state = states.get(n) ?? EMPTY_STATE(n);
    const finding = headline(state);
    const planned = state.treatments.some((t) => t.state === "planned");
    const busy = progress.has(n);
    return (
      <button
        key={n}
        type="button"
        className={className}
        style={style}
        data-finding={state.whole === "missing" ? "missing" : finding}
        data-planned={planned || undefined}
        data-progress={busy || undefined}
        data-kind={kindOf(n)}
        aria-pressed={selected === n}
        aria-label={`${describeTooth(state)}${busy ? ", treatment in progress" : ""}`}
        onClick={() => {
          onSelect(n);
        }}
      >
        <span className="tc-num">{n}</span>
        {className === "tc-tooth" ? <ToothShape finding={state.whole === "missing" ? "missing" : finding} planned={planned} busy={busy} upper={n < 30 || (n >= 50 && n < 70)} /> : null}
      </button>
    );
  };

  const row = (teeth: readonly number[]) => <div className="tc-row">{teeth.map((n) => tooth(n))}</div>;

  const arch = () => {
    const place = (teeth: readonly number[], top: boolean) =>
      teeth.map((n, i) => {
        const angle = Math.PI * (1 - (i + 0.5) / teeth.length);
        return tooth(n, { left: `${String(50 + 44 * Math.cos(angle))}%`, top: `${String(top ? 50 - 41 * Math.sin(angle) : 50 + 41 * Math.sin(angle))}%` }, "tc-bead");
      });
    return (
      <div className="tc-arch-stage">
        <div className="tc-arch">
          <div className="tc-gum" aria-hidden="true" />
          {place(arches.upper, true)}
          {place(arches.lower, false)}
          <p className="tc-centre" aria-hidden="true">
            {states.size} teeth with history
            <br />
            <span>tap one</span>
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="odo tc">
      {look === "arch" ? (
        arch()
      ) : (
        <div className="tc-rows">
          <div className="tc-rows-inner">
            {row(arches.upper)}
            <hr />
            {row(arches.lower)}
          </div>
        </div>
      )}
    </div>
  );
}

/** What the colours and marks mean. It sits behind a "Key" button, so the chart itself stays clear. */
export function ChartKey() {
  return (
    <div className="odo tc">
      <ul className="tc-legend" aria-label="Legend">
        {FINDING_ORDER.filter((finding) => finding !== "sound").map((finding) => (
          <li key={finding}>
            <i data-finding={finding} />
            {FINDING_STYLE[finding].label}
          </li>
        ))}
        <li>
          <i data-planned />
          Planned
        </li>
        <li>
          <i data-progress />
          In progress
        </li>
      </ul>
    </div>
  );
}

/** The tooth drawing. Beyond colour, root canals show lines in the root, missing is dashed, planned has a dashed ring and in progress a dot. */
function ToothShape({ finding, planned, busy, upper }: { finding: string; planned: boolean; busy: boolean; upper: boolean }) {
  return (
    <svg viewBox="0 0 30 40" className="tc-shape" data-upper={upper || undefined} aria-hidden="true" focusable="false">
      <path d="M4 6 Q15 0 26 6 L24 22 Q22 38 18 38 Q15 30 12 38 Q8 38 6 22 Z" />
      {finding === "root_canal" ? <path className="tc-ink" d="M13 14 L12 34 M17 14 L18 34" /> : null}
      {finding === "implant" ? <path className="tc-ink" d="M9 18 H21 M10 24 H20 M11 30 H19" /> : null}
      {planned ? <circle className="tc-plan" cx="15" cy="12" r="4" /> : null}
      {busy ? <circle className="tc-busy" cx="24" cy="7" r="4.5" /> : null}
    </svg>
  );
}
