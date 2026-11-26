import { useMemo, useRef, useState } from "react";

import type { ChartEntry, PlanItem } from "@aarogyam/api-client";

import { ARCHES, FINDING_ORDER, FINDING_STYLE, describeTooth, EMPTY_STATE, headline, kindOf, toothStates, treatmentsByTooth } from "./odontogram-model.js";
import { HEALTHS, elsewhereTeeth, healthByTooth, healthLabel, inProgressTeeth, type Health, type StatusLike, type ToothHealthView } from "./health-model.js";
import type { ChartDentition, ChartLook, ChartView } from "./types.js";
import { useLongPress } from "./long-press.js";


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

/** Where the hover card sits: centred on the tooth, below an upper tooth and above a lower one. */
interface HoverSpot {
  tooth: number;
  x: number;
  y: number;
  below: boolean;
}

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
  onSelect: (tooth: number, how?: { shift: boolean }) => void;
  /** Teeth picked together (select several): each shows as pressed. */
  multi?: ReadonlySet<number> | undefined;
  /** A long press (touch or mouse) on a tooth: select it and dictate its note. */
  onLongPress?: (tooth: number) => void;
  /** Keys 1, 2 and 3 on a focused tooth: healthy, watch, needs treatment. */
  onHealthKey?: ((tooth: number, health: Health) => void) | undefined;
  /** Teeth to ring, such as those with a pin in Explain mode. */
  marked?: ReadonlySet<number> | undefined;
  /** The pointer entered a tooth (or left it, with undefined). */
  onHover?: ((tooth: number | undefined) => void) | undefined;
  /** Present mode: marks drawn over a tooth (today, planned, found), the words said for it, and whether it is dimmed. */
  marks?: ((tooth: number) => ToothMarks | undefined) | undefined;
}

export interface ToothMarks {
  node: React.ReactNode;
  label?: string | undefined;
  dim?: boolean | undefined;
}

/** The chart: rows or a 3D arch, adult or child teeth. Tapping a tooth selects it; recording happens in the panel beside it. */
export function ToothChart({ look, dentition, view = "treatment", current, statuses = [], planItems, selected, onSelect, multi, onLongPress, onHealthKey, marked, onHover, marks }: Props) {
  const states = useMemo(() => toothStates(current, treatmentsByTooth(planItems)), [current, planItems]);
  const progress = useMemo(() => inProgressTeeth(current), [current]);
  const healths = useMemo(() => healthByTooth(current, statuses), [current, statuses]);
  const away = useMemo(() => elsewhereTeeth(current), [current]);
  const arches = ARCHES[dentition];
  const press = useLongPress(onLongPress);
  const health = view === "health";
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverSpot | undefined>(undefined);
  const statusOf = useMemo(() => new Map(statuses.map((s) => [s.tooth, s])), [statuses]);

  const tooth = (n: number, style?: React.CSSProperties, className = "tc-tooth") => {
    const state = states.get(n) ?? EMPTY_STATE(n);
    const finding = headline(state);
    const planned = state.treatments.some((t) => t.state === "planned");
    const busy = progress.has(n);
    const level = healths.get(n) ?? "unassessed";
    const elsewhere = !health && away.has(n);
    const mark = marks?.(n);
    const said = health ? `${describeTooth(state)}, ${healthLabel(level)}${marked?.has(n) === true ? ", pinned" : ""}` :`${describeTooth(state)}${busy ? ", treatment in progress" : ""}${elsewhere ? ", done elsewhere" : ""}`;
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
        data-tooth={n}
        data-dim={mark?.dim === true || undefined}
        aria-pressed={selected === n || multi?.has(n) === true}
        aria-label={mark?.label ?? said}
        onPointerEnter={(event) => {
          onHover?.(n);
          // A mouse resting on a tooth shows its card; touch has tap and long press instead.
          const box = root.current?.getBoundingClientRect();
          if (event.pointerType !== "mouse" || box === undefined) return;
          const at = event.currentTarget.getBoundingClientRect();
          const below = n < 30 || (n >= 50 && n < 70);
          setHover({ tooth: n, x: at.left - box.left + at.width / 2, y: (below ? at.bottom : at.top) - box.top, below });
        }}
        onPointerDown={() => {
          setHover(undefined);
          press.start(n);
        }}
        onPointerUp={press.end}
        onPointerLeave={() => {
          press.end();
          onHover?.(undefined);
          setHover(undefined);
        }}
        onPointerCancel={press.end}
        onContextMenu={(event) => {
          // A long press on a phone opens the browser's menu; the press already did its job.
          if (press.fired()) event.preventDefault();
          // A right-click (desktop) is the same gesture as a long press.
          else if (onLongPress !== undefined && event.button === 2) {
            event.preventDefault();
            onLongPress(n);
          }
        }}
        onKeyDown={(event) => {
          const picked = HEALTHS.find((h) => h.key === event.key);
          if (picked === undefined || onHealthKey === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
          event.preventDefault();
          onHealthKey(n, picked.value);
        }}
        onClick={(event) => {
          // A long press already selected the tooth and started dictation; its release is not a second tap.
          if (press.consumed()) return;
          onSelect(n, { shift: event.shiftKey });
        }}
      >
        <span className="tc-num">{n}</span>
        {className === "tc-tooth" ? <ToothShape finding={state.whole === "missing" ? "missing" : finding} planned={!health && planned} busy={!health && busy} upper={n < 30 || (n >= 50 && n < 70)} /> : null}
        {mark?.node}
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

  const card = () => {
    if (hover === undefined) return null;
    const state = states.get(hover.tooth) ?? EMPTY_STATE(hover.tooth);
    const status = statusOf.get(hover.tooth);
    const level = healths.get(hover.tooth) ?? "unassessed";
    const [title = "", ...rest] = describeTooth(state).split(", ");
    return (
      <div role="tooltip" className="tc-hovercard" data-below={hover.below || undefined} style={{ left: hover.x, top: hover.y }}>
        <strong>{title}</strong>
        <span>{rest.join(", ")}</span>
        <span data-health={level}>
          {healthLabel(level)}
          {status === undefined && level !== "unassessed" && level !== "none" ? " (from the chart)" : ""}
        </span>
        {status?.note == null ? null : <span className="tc-hovernote">{status.note}</span>}
        {status?.treat_within_months == null ? null : <span>Advise treatment within {status.treat_within_months} {status.treat_within_months === 1 ? "month" : "months"}</span>}
        {away.has(hover.tooth) ? <span>Done elsewhere</span> : null}
        {progress.has(hover.tooth) ? <span>Treatment in progress</span> : null}
        <span className="tc-hoverhint">{onLongPress === undefined ? "Click to open" : "Click to open · hold to select several"}</span>
      </div>
    );
  };

  return (
    <div className="odo tc" data-view={view} ref={root}>
      {card()}
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
