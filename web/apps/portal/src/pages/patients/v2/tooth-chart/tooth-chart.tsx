import { useMemo, useRef } from "react";

import type { ChartEntry, PlanItem } from "@aarogyam/api-client";

import { ARCHES, FINDING_ORDER, FINDING_STYLE, describeTooth, EMPTY_STATE, headline, kindOf, toothStates, treatmentsByTooth } from "../../../visits/odontogram/model.js";
import { HEALTHS, elsewhereTeeth, healthByTooth, healthLabel, inProgressTeeth, type Health, type StatusLike, type ToothHealthView } from "./model.js";
import type { ChartDentition, ChartLook, ChartView } from "./use-chart-prefs.js";
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
export const VIEWS = [
  { value: "treatment", label: "Treatment" },
  { value: "health", label: "Health" },
] as const satisfies readonly { value: ChartView; label: string }[];

/** How long a press on a tooth lasts before it starts dictating a note. */
export const LONG_PRESS_MS = 500;

const GLYPH: Readonly<Record<ToothHealthView, string>> = { healthy: "✓", watch: "!", needs_treatment: "✕", none: "", unassessed: "" };

interface Props {
  look: ChartLook;
  dentition: ChartDentition;
  /** Treatment paints findings (work done elsewhere dashed); Health paints three colours with a glyph each. */
  view?: ChartView;
  current: readonly ChartEntry[];
  statuses?: readonly StatusLike[];
  planItems: readonly PlanItem[];
  selected: number | undefined;
  onSelect: (tooth: number) => void;
  /** A long press (touch or mouse) on a tooth: select it and dictate its note. */
  onLongPress?: (tooth: number) => void;
  /** Keys 1, 2 and 3 on a focused tooth: healthy, watch, needs treatment. */
  onHealthKey?: ((tooth: number, health: Health) => void) | undefined;
  /** Teeth to ring, such as those with a pin in Explain mode. */
  marked?: ReadonlySet<number> | undefined;
  /** The pointer entered a tooth (or left it, with undefined). */
  onHover?: ((tooth: number | undefined) => void) | undefined;
}

/** The chart: rows or a 3D arch, adult or child teeth. Tapping a tooth selects it; recording happens in the panel beside it. */
export function ToothChart({ look, dentition, view = "treatment", current, statuses = [], planItems, selected, onSelect, onLongPress, onHealthKey, marked, onHover }: Props) {
  const states = useMemo(() => toothStates(current, treatmentsByTooth(planItems)), [current, planItems]);
  const progress = useMemo(() => inProgressTeeth(current), [current]);
  const healths = useMemo(() => healthByTooth(current, statuses), [current, statuses]);
  const away = useMemo(() => elsewhereTeeth(current), [current]);
  const arches = ARCHES[dentition];
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; fired: boolean }>({ timer: undefined, fired: false });
  const endPress = () => {
    clearTimeout(press.current.timer);
    press.current.timer = undefined;
  };
  const health = view === "health";

  const tooth = (n: number, style?: React.CSSProperties, className = "tc-tooth") => {
    const state = states.get(n) ?? EMPTY_STATE(n);
    const finding = headline(state);
    const planned = state.treatments.some((t) => t.state === "planned");
    const busy = progress.has(n);
    const level = healths.get(n) ?? "unassessed";
    const elsewhere = !health && away.has(n);
    const label = health ? `${describeTooth(state)}, ${healthLabel(level)}${marked?.has(n) === true ? ", pinned" : ""}` :`${describeTooth(state)}${busy ? ", treatment in progress" : ""}${elsewhere ? ", done elsewhere" : ""}`;
    return (
      <button
        key={n}
        type="button"
        className={className}
        style={style}
        data-finding={state.whole === "missing" ? "missing" : finding}
        data-planned={(!health && planned) || undefined}
        data-progress={(!health && busy) || undefined}
        data-elsewhere={elsewhere || undefined}
        data-health={health ? level : undefined}
        data-kind={kindOf(n)}
        data-marked={marked?.has(n) === true || undefined}
        aria-pressed={selected === n}
        aria-label={label}
        onPointerEnter={() => {
          onHover?.(n);
        }}
        onPointerDown={() => {
          if (onLongPress === undefined) return;
          endPress();
          press.current.fired = false;
          press.current.timer = setTimeout(() => {
            press.current.fired = true;
            press.current.timer = undefined;
            onLongPress(n);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={endPress}
        onPointerLeave={() => {
          endPress();
          onHover?.(undefined);
        }}
        onPointerCancel={endPress}
        onContextMenu={(event) => {
          // A long press on a phone opens the browser's menu; the press already did its job.
          if (press.current.fired) event.preventDefault();
        }}
        onKeyDown={(event) => {
          const picked = HEALTHS.find((h) => h.key === event.key);
          if (picked === undefined || onHealthKey === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
          event.preventDefault();
          onHealthKey(n, picked.value);
        }}
        onClick={() => {
          // A long press already selected the tooth and started dictation; its release is not a second tap.
          if (press.current.fired) {
            press.current.fired = false;
            return;
          }
          onSelect(n);
        }}
      >
        <span className="tc-num">{n}</span>
        {className === "tc-tooth" ? <ToothShape finding={state.whole === "missing" ? "missing" : finding} planned={!health && planned} busy={!health && busy} upper={n < 30 || (n >= 50 && n < 70)} /> : null}
        {health && GLYPH[level] !== "" ? (
          <span className="tc-glyph" aria-hidden="true">
            {GLYPH[level]}
          </span>
        ) : null}
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
    <div className="odo tc" data-view={view}>
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
export function ChartKey({ view = "treatment" }: { view?: ChartView }) {
  if (view === "health") {
    return (
      <div className="odo tc" data-view="health">
        <ul className="tc-legend" aria-label="Legend">
          {HEALTHS.map((h) => (
            <li key={h.value}>
              <i data-health={h.value}>{h.glyph}</i>
              {h.label}
            </li>
          ))}
          <li>
            <i data-health="unassessed" />
            Not assessed
          </li>
        </ul>
      </div>
    );
  }
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
        <li>
          <i data-elsewhere />
          dashed = done elsewhere
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
