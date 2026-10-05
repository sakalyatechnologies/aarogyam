import { useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { Minus, Plus } from "lucide-react";

import type { DentalChart, PatientId, PlanItem, ToothSurface } from "@aarogyam/api-client";

import "./odontogram.css";
import {
  ARCHES,
  EMPTY_STATE,
  FINDING_ORDER,
  FINDING_STYLE,
  LABEL_H,
  archOf,
  dentitionOf,
  layoutArch,
  summarise,
  toothStates,
  treatmentsByTooth,
  type ArchName,
  type Dentition,
} from "./model.js";
import { FindingSwatch, OdontogramDefs, StatusGlyph, ToothSvg } from "./tooth-svg.js";
import { ToothPanel } from "./tooth-panel.js";

const ZOOMS = [1, 1.25, 1.5, 2] as const;
const KEY_SURFACE: Readonly<Record<string, ToothSurface>> = { m: "M", d: "D", o: "O", i: "O", b: "B", f: "B", l: "L", p: "L" };

export interface OdontogramProps {
  patientId: PatientId;
  chart: DentalChart;
  planItems: readonly PlanItem[];
  /** Undefined when the caller may not record findings: the chart then reads but does not offer the dialog. */
  onRecord: ((tooth: number, surface: ToothSurface | null) => void) | undefined;
}

/** Both arches of one dentition, selectable by mouse, touch and keyboard, with a legend, summary strip and tooth panel. */
export function Odontogram({ patientId, chart, planItems, onRecord }: OdontogramProps) {
  const [dentition, setDentition] = useState<Dentition>(() => {
    const teeth = chart.current.map((e) => e.tooth);
    return teeth.length > 0 && teeth.every((t) => dentitionOf(t) === "child") ? "child" : "adult";
  });
  const [selected, setSelected] = useState<{ tooth: number; surface: ToothSurface | null } | undefined>(undefined);
  const [focusTooth, setFocusTooth] = useState<number | undefined>(undefined);
  const [phoneArch, setPhoneArch] = useState<ArchName>("upper");
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | undefined>(undefined);

  const states = toothStates(chart.current, treatmentsByTooth(planItems));
  const arches = ARCHES[dentition];
  const layouts = { upper: layoutArch(arches.upper, "upper"), lower: layoutArch(arches.lower, "lower") };
  const summary = summarise([...arches.upper, ...arches.lower], states);
  const order = [...arches.upper, ...arches.lower];
  const tabStop = focusTooth !== undefined && order.includes(focusTooth) ? focusTooth : order[0];

  const select = (tooth: number, surface: ToothSurface | null) => {
    setSelected({ tooth, surface });
    setFocusTooth(tooth);
  };
  const focusOn = (tooth: number | undefined) => {
    if (tooth === undefined) return;
    setFocusTooth(tooth);
    setPhoneArch(archOf(tooth));
    const focus = () => stage.current?.querySelector<SVGElement>(`[data-tooth="${String(tooth)}"]`)?.focus();
    focus();
    // On a phone the other arch only appears after the re-render above, so try once more then.
    requestAnimationFrame(() => {
      if (stage.current?.contains(document.activeElement) !== true) focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tooth]") : null;
    if (target === null) return;
    const tooth = Number(target.getAttribute("data-tooth"));
    const arch = archOf(tooth);
    const row = arches[arch];
    const index = row.indexOf(tooth);
    const other = arches[arch === "upper" ? "lower" : "upper"];
    switch (event.key) {
      case "ArrowRight":
        focusOn(row[Math.min(index + 1, row.length - 1)]);
        break;
      case "ArrowLeft":
        focusOn(row[Math.max(index - 1, 0)]);
        break;
      case "ArrowDown":
      case "ArrowUp":
        focusOn(other[Math.min(index, other.length - 1)]);
        break;
      case "Home":
        focusOn(row[0]);
        break;
      case "End":
        focusOn(row[row.length - 1]);
        break;
      case "Enter":
      case " ":
        select(tooth, null);
        break;
      case "Escape":
        setSelected(undefined);
        break;
      default: {
        const surface = event.ctrlKey || event.metaKey || event.altKey ? undefined : KEY_SURFACE[event.key.toLowerCase()];
        if (surface === undefined) return;
        select(tooth, surface);
      }
    }
    event.preventDefault();
  };

  const onTouchStart = (event: TouchEvent) => {
    const point = event.touches[0];
    touch.current = point === undefined ? undefined : { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    const end = event.changedTouches[0];
    touch.current = undefined;
    if (start === undefined || end === undefined) return;
    const dx = end.clientX - start.x;
    if (Math.abs(dx) < 60 || Math.abs(end.clientY - start.y) > 50) return;
    const el = stage.current;
    // Let a zoomed chart scroll sideways first; only a swipe from the scroll edge changes arch.
    if (el !== null && el.scrollWidth > el.clientWidth + 4) {
      const atEdge = dx > 0 ? el.scrollLeft <= 0 : el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if (!atEdge) return;
    }
    setPhoneArch(dx < 0 ? "lower" : "upper");
  };

  const zoomIndex = ZOOMS.indexOf(zoom);

  return (
    <div className="odo">
      <OdontogramDefs />
      <ul className="odo-summary" aria-label="Chart summary">
        <li>
          <b>{`${String(summary.present)}/${String(summary.total)}`}</b>
          <span>teeth present</span>
        </li>
        <li>
          <b>{summary.caries}</b>
          <span>with caries</span>
        </li>
        <li>
          <b>{summary.restored}</b>
          <span>restored</span>
        </li>
        <li>
          <b>{summary.missing}</b>
          <span>missing</span>
        </li>
        <li>
          <b>{summary.planned}</b>
          <span>planned treatments</span>
        </li>
      </ul>

      <div className="odo-toolbar">
        <div className="odo-seg" role="group" aria-label="Dentition">
          {(["adult", "child"] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={dentition === d}
              onClick={() => {
                setDentition(d);
                setSelected(undefined);
                setFocusTooth(undefined);
              }}
            >
              {d === "adult" ? "Adult" : "Child (primary)"}
            </button>
          ))}
        </div>
        <div className="odo-seg odo-arch-tabs" role="group" aria-label="Arch">
          {(["upper", "lower"] as const).map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={phoneArch === a}
              onClick={() => {
                setPhoneArch(a);
              }}
            >
              {a === "upper" ? "Upper" : "Lower"}
            </button>
          ))}
        </div>
        <div className="odo-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={zoomIndex <= 0}
            onClick={() => {
              setZoom(ZOOMS[Math.max(zoomIndex - 1, 0)] ?? 1);
            }}
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <output aria-live="polite">{`${String(Math.round(zoom * 100))}%`}</output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() => {
              setZoom(ZOOMS[Math.min(zoomIndex + 1, ZOOMS.length - 1)] ?? 1);
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>

      <div className="odo-layout">
        <div>
          <div
            ref={stage}
            className="odo-stage"
            data-active={phoneArch}
            onKeyDown={onKeyDown}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            role="group"
            aria-label={`${dentition === "adult" ? "Adult" : "Primary"} teeth. Arrow keys move between teeth, Enter selects, M D O B L pick a surface.`}
          >
            <div className="odo-stage-inner" style={{ width: `${String(zoom * 100)}%` }}>
              {(["upper", "lower"] as const).map((arch) => {
                const layout = layouts[arch];
                return (
                  <svg key={`${dentition}-${arch}`} className="odo-arch" data-arch={arch} viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`} role="group" aria-label={`${arch === "upper" ? "Upper" : "Lower"} arch`}>
                    <line className="odo-midline" x1={layout.width / 2} x2={layout.width / 2} y1={LABEL_H / 2} y2={layout.height - LABEL_H / 2} />
                    <text className="odo-side" x="6" y={layout.height / 2} dominantBaseline="central">
                      R
                    </text>
                    <text className="odo-side" x={layout.width - 6} y={layout.height / 2} dominantBaseline="central" textAnchor="end">
                      L
                    </text>
                    {layout.teeth.map((placed) => (
                      <ToothSvg
                        key={placed.tooth}
                        placed={placed}
                        state={states.get(placed.tooth) ?? EMPTY_STATE(placed.tooth)}
                        selected={selected?.tooth === placed.tooth}
                        selectedSurface={selected?.surface ?? null}
                        focusable={placed.tooth === tabStop}
                        onSelect={select}
                        onFocusTooth={setFocusTooth}
                      />
                    ))}
                  </svg>
                );
              })}
            </div>
          </div>
          <p className="odo-hint">Tap a surface to select it, or the tooth for all five. Swipe on a phone for the other arch.</p>
        </div>
        <ToothPanel
          patientId={patientId}
          tooth={selected?.tooth}
          surface={selected?.surface ?? null}
          state={selected === undefined ? undefined : states.get(selected.tooth)}
          onSurface={(surface) => {
            if (selected !== undefined) setSelected({ tooth: selected.tooth, surface });
          }}
          onRecord={onRecord}
        />
      </div>

      <div>
        <p className="odo-legend-title">Findings</p>
        <ul className="odo-legend" aria-label="Findings legend">
          {FINDING_ORDER.map((finding) => (
            <li key={finding}>
              <FindingSwatch finding={finding} />
              <span>{FINDING_STYLE[finding].label}</span>
              <small>{FINDING_STYLE[finding].description}</small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="odo-legend-title">Treatment</p>
        <ul className="odo-legend" aria-label="Treatment legend">
          <li>
            <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
              <StatusGlyph mark={{ state: "planned", extraction: false }} x={0} y={0} />
            </svg>
            <span>Planned</span>
            <small>Dashed ring around the tooth, P badge</small>
          </li>
          <li>
            <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
              <StatusGlyph mark={{ state: "planned", extraction: true }} x={0} y={0} />
            </svg>
            <span>Extraction planned</span>
            <small>Dashed ring, X badge</small>
          </li>
          <li>
            <svg width="22" height="22" viewBox="-11 -11 22 22" aria-hidden="true">
              <StatusGlyph mark={{ state: "done", extraction: false }} x={0} y={0} />
            </svg>
            <span>Done</span>
            <small>Solid tick badge, no ring</small>
          </li>
        </ul>
      </div>
    </div>
  );
}
