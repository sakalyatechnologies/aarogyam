/**
 * Show patient in the doctor's chart look (Rows, 3D arch or Classic): the same teeth, numbers and dentition as the chart,
 * with the mouth view's marks over them (TODAY ring, "!" found today, dashed ring planned, RECOMMENDED, done here,
 * elsewhere or before). A tap opens the mouth view's tooth detail; Back returns here with the tooth focused.
 */
import { useEffect, useRef, type ReactElement } from "react";

import type { DentalChart, PlanItem } from "@aarogyam/api-client";
import { BadgeIcon, isRecommended, isToday, spokenLabel, type OverviewSlot, type PositionState } from "../../mouth-view/index.js";

import { ToothChart, type ToothMarks } from "./tooth-chart.js";
import type { ChartDentition, ChartLook } from "./types.js";
import { ARCHES, CELL_H, EMPTY_STATE, layoutArch, toothStates, treatmentsByTooth, type Placed } from "./odontogram-model.js";
import { OdontogramDefs, ToothSvg } from "./tooth-svg.js";

/** The words on a tooth's tag: TODAY wins over RECOMMENDED, and a planned tooth has its ring instead. */
function tagOf(s: PositionState): "TODAY" | "RECOMMENDED" | undefined {
  if (s.today) return "TODAY";
  if (!s.planned && isRecommended(s.tooth)) return "RECOMMENDED";
  return undefined;
}

function ringOf(s: PositionState): "today" | "plan" | "rec" | undefined {
  if (s.today) return "today";
  if (s.planned) return "plan";
  return isRecommended(s.tooth) ? "rec" : undefined;
}

function htmlMarks(s: PositionState): ReactElement | null {
  const ring = ringOf(s);
  const tag = tagOf(s);
  if (ring === undefined && tag === undefined && s.badge === undefined && !s.planned) return null;
  return (
    <span className="pc-marks" data-arch={s.arch} aria-hidden="true">
      {ring === undefined ? null : <span className="pc-ring" data-kind={ring} />}
      {s.planned && s.today ? <span className="pc-ring pc-ring-outer" data-kind="plan" /> : null}
      {tag === undefined ? null : <span className="pc-tag" data-kind={tag === "TODAY" ? "today" : "rec"}>{tag}</span>}
      {s.badge === undefined ? null : <span className="pc-badge" data-kind={s.badge}><BadgeIcon kind={s.badge} /></span>}
    </span>
  );
}

/** The marks over one Classic tooth, in the tooth's own frame (the same translate and tilt as the odontogram draws it). */
function svgMarks(s: PositionState, placed: Placed, upper: boolean): ReactElement | null {
  const ring = ringOf(s);
  const tag = tagOf(s);
  if (ring === undefined && tag === undefined && s.badge === undefined) return null;
  const { x, y, w, rotate } = placed;
  const cls = { today: "mv-ring-today", plan: "mv-ring-plan", rec: "mv-ring-rec" } as const;
  // The tag sits at the root end, away from the number: above an upper tooth, below a lower one; the badge by the crown.
  const ty = upper ? -12 : CELL_H + 12;
  const by = upper ? CELL_H - 18 : 18;
  return (
    <g className="pc-svg-marks" pointerEvents="none" aria-hidden="true" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rotate.toFixed(1)} ${String(w / 2)} ${String(CELL_H / 2)})`}>
      {ring === undefined ? null : <rect className={cls[ring]} x={-5} y={-5} width={w + 10} height={CELL_H + 10} rx={14} />}
      {s.planned && s.today ? <rect className="mv-ring-plan" x={-9} y={-9} width={w + 18} height={CELL_H + 18} rx={17} /> : null}
      {tag === undefined ? null : tag === "TODAY" ? (
        <g className="mv-tag-today" transform={`translate(${String(w / 2)} ${String(ty)})`}><rect x={-19} y={-7} width={38} height={14} rx={7} /><text y={0.6}>TODAY</text></g>
      ) : (
        <g className="mv-tag-rec" transform={`translate(${String(w / 2)} ${String(ty)})`}><rect x={-28} y={-6.5} width={56} height={13} rx={6.5} /><text y={0.6}>RECOMMENDED</text></g>
      )}
      {s.badge === undefined ? null : (
        <svg x={w - 8} y={by - 8} width={16} height={16} viewBox="-8 -8 16 16" overflow="visible">
          <BadgeIcon kind={s.badge} />
        </svg>
      )}
    </g>
  );
}

/** The odontogram's two arches, read only: the same layout and numbers as the doctor's Classic chart. */
function ClassicChart({ dentition, chart, planItems, slot }: { dentition: ChartDentition; chart: DentalChart; planItems: readonly PlanItem[]; slot: OverviewSlot }) {
  const states = toothStates(chart.current, treatmentsByTooth(planItems));
  const arches = ARCHES[dentition];
  return (
    <div className="odo pc-classic">
      <OdontogramDefs />
      <div className="odo-stage" role="group" aria-label={`${dentition === "adult" ? "Adult" : "Primary"} teeth`}>
        <div className="odo-stage-inner">
          {(["upper", "lower"] as const).map((arch) => {
            const layout = layoutArch(arches[arch], arch);
            return (
              <svg key={`${dentition}-${arch}`} className="odo-arch" data-arch={arch} viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`} role="group" aria-label={`${arch === "upper" ? "Upper" : "Lower"} arch`} overflow="visible">
                <line className="odo-midline" x1={layout.width / 2} x2={layout.width / 2} y1={11} y2={layout.height - 11} />
                {layout.teeth.map((placed) => {
                  const s = slot.stateOf(placed.tooth);
                  return (
                    <g key={placed.tooth} className="pc-classic-tooth" data-dim={(slot.filter === "today" && !isToday(s)) || undefined}>
                      <ToothSvg
                        placed={placed}
                        state={states.get(placed.tooth) ?? EMPTY_STATE(placed.tooth)}
                        selected={false}
                        selectedSurface={null}
                        focusable
                        onSelect={(tooth) => {
                          slot.open(tooth);
                        }}
                        onFocusTooth={() => undefined}
                      />
                    </g>
                  );
                })}
                {/* marks after every tooth, so a neighbour never covers a badge */}
                {layout.teeth.map((placed) => {
                  const s = slot.stateOf(placed.tooth);
                  const marks = svgMarks(s, placed, arch === "upper");
                  return marks === null ? null : <g key={placed.tooth} data-dim={(slot.filter === "today" && !isToday(s)) || undefined} className="pc-classic-tooth">{marks}</g>;
                })}
              </svg>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PresentChart({ look, dentition, chart, planItems, slot }: { look: ChartLook; dentition: ChartDentition; chart: DentalChart; planItems: readonly PlanItem[]; slot: OverviewSlot }) {
  const root = useRef<HTMLDivElement>(null);
  const was = slot.was;
  // Back from a tooth: focus it again in this look.
  useEffect(() => {
    if (was === undefined) return;
    root.current?.querySelector<HTMLElement | SVGElement>(`[data-tooth="${String(was.fdi)}"]`)?.focus({ preventScroll: true });
  }, [was]);
  const marks = (tooth: number): ToothMarks => {
    const s = slot.stateOf(tooth);
    return { node: htmlMarks(s), label: spokenLabel(s, true), dim: slot.filter === "today" && !isToday(s) };
  };
  return (
    <div ref={root} className="pc" data-look={look} data-dentition={dentition}>
      {look === "classic" ? (
        <ClassicChart dentition={dentition} chart={chart} planItems={planItems} slot={slot} />
      ) : (
        <ToothChart look={look} dentition={dentition} current={chart.current} statuses={chart.statuses ?? []} planItems={planItems} selected={undefined} onSelect={slot.open} marks={marks} />
      )}
    </div>
  );
}
