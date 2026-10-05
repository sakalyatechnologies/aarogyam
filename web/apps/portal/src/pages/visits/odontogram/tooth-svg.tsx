import type { ChartFinding, ToothSurface } from "@aarogyam/api-client";

import {
  CELL_H,
  CROWN_H,
  FINDING_ORDER,
  FINDING_STYLE,
  ROOT_H,
  archOf,
  crownPath,
  crownZones,
  describeTooth,
  kindOf,
  rootPath,
  surfaceCode,
  surfaceLabel,
  type PatternName,
  type Placed,
  type ToothState,
  type TreatmentMark,
} from "./model.js";

const patternId = (finding: ChartFinding): string => `odo-pat-${finding}`;

/** Fill for a finding: the pattern from the shared defs, or the plain surface colour when there is none. */
export const fillFor = (finding: ChartFinding | undefined): string => (finding === undefined || finding === "sound" ? "var(--odo-surface)" : `url(#${patternId(finding)})`);

function PatternBody({ pattern, colour }: { pattern: PatternName; colour: string }) {
  const stroke = `var(${colour})`;
  const soft = `color-mix(in srgb, var(${colour}) 20%, var(--odo-surface))`;
  const line = { stroke, strokeWidth: 1.4 } as const;
  switch (pattern) {
    case "solid":
      return <rect width="8" height="8" fill={`color-mix(in srgb, var(${colour}) 62%, var(--odo-surface))`} />;
    case "stripes":
      return (
        <>
          <rect width="8" height="8" fill={soft} />
          <path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" {...line} />
        </>
      );
    case "cross":
      return (
        <>
          <rect width="8" height="8" fill={soft} />
          <path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6 M2,10 L-2,6 M0,0 L8,8 M6,-2 L10,2" {...line} />
        </>
      );
    case "dots":
      return (
        <>
          <rect width="8" height="8" fill={soft} />
          <circle cx="4" cy="4" r="1.5" fill={stroke} />
        </>
      );
    case "vertical":
      return (
        <>
          <rect width="6" height="8" fill={soft} />
          <path d="M1.5,0 V8" {...line} />
        </>
      );
    case "grid":
      return (
        <>
          <rect width="7" height="7" fill={soft} />
          <path d="M0.5,0 V7 M0,0.5 H7" {...line} strokeWidth={1} />
        </>
      );
    case "bars":
      return (
        <>
          <rect width="8" height="6" fill={soft} />
          <path d="M0,1.5 H8" {...line} />
        </>
      );
    case "none":
      return <rect width="8" height="8" fill="var(--odo-surface)" />;
  }
}

const PATTERN_SIZE: Readonly<Record<PatternName, readonly [number, number]>> = {
  none: [8, 8],
  solid: [8, 8],
  stripes: [8, 8],
  cross: [8, 8],
  dots: [8, 8],
  vertical: [6, 8],
  grid: [7, 7],
  bars: [8, 6],
};

/** Shared pattern definitions. Rendered once per chart; every tooth and legend swatch points at them. */
export function OdontogramDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="odo-defs">
      <defs>
        {FINDING_ORDER.filter((f) => f !== "sound" && f !== "missing").map((finding) => {
          const style = FINDING_STYLE[finding];
          const [w, h] = PATTERN_SIZE[style.pattern];
          return (
            <pattern key={finding} id={patternId(finding)} width={w} height={h} patternUnits="userSpaceOnUse">
              <PatternBody pattern={style.pattern} colour={style.colour} />
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}

/** A small swatch that uses the same fill and outline as the teeth do. */
export function FindingSwatch({ finding }: { finding: ChartFinding }) {
  const style = FINDING_STYLE[finding];
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="odo-swatch">
      {finding === "missing" ? (
        <rect x="2" y="2" width="18" height="18" rx="5" fill="none" stroke={`var(${style.colour})`} strokeWidth="1.5" strokeDasharray="3 2.5" />
      ) : (
        <rect x="2" y="2" width="18" height="18" rx="5" fill={fillFor(finding)} stroke={`var(${style.colour})`} strokeWidth={finding === "crown" ? 3 : 1.2} />
      )}
      {finding === "missing" ? <path d="M7,7 L15,15 M15,7 L7,15" stroke={`var(${style.colour})`} strokeWidth="1.5" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** Treatment-status glyph, readable without colour: dashed ring + P for planned, solid disc + tick for done, X for a planned extraction. */
export function StatusGlyph({ mark, x, y }: { mark: Pick<TreatmentMark, "state" | "extraction">; x: number; y: number }) {
  if (mark.state === "done") {
    return (
      <g transform={`translate(${String(x)} ${String(y)})`} className="odo-status odo-status-done">
        <circle r="6.5" fill="var(--odo-success)" stroke="var(--odo-surface)" strokeWidth="1.2" />
        <path d="M-3,0.2 L-0.8,2.6 L3.2,-2.4" fill="none" stroke="var(--odo-on-solid)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  return (
    <g transform={`translate(${String(x)} ${String(y)})`} className="odo-status odo-status-planned">
      <circle r="6.5" fill="var(--odo-surface)" stroke={mark.extraction ? "var(--odo-danger)" : "var(--odo-warning)"} strokeWidth="1.6" strokeDasharray="2.6 1.6" />
      {mark.extraction ? (
        <path d="M-2.6,-2.6 L2.6,2.6 M2.6,-2.6 L-2.6,2.6" stroke="var(--odo-danger)" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <text textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="800" fill="var(--odo-text)">
          P
        </text>
      )}
    </g>
  );
}

export interface ToothProps {
  placed: Placed;
  state: ToothState;
  selected: boolean;
  selectedSurface: ToothSurface | null;
  focusable: boolean;
  onSelect: (tooth: number, surface: ToothSurface | null) => void;
  onFocusTooth: (tooth: number) => void;
}

/** One tooth: root, crown with five clickable surfaces, whole-tooth overlay, status badge and FDI number. */
export function ToothSvg({ placed, state, selected, selectedSurface, focusable, onSelect, onFocusTooth }: ToothProps) {
  const { tooth, x, y, w, rotate } = placed;
  const kind = kindOf(tooth);
  const lower = archOf(tooth) === "lower";
  const missing = state.whole === "missing";
  const whole = state.whole;
  const wholeStyle = whole === undefined ? undefined : FINDING_STYLE[whole];
  const clip = `odo-clip-${String(tooth)}`;
  const crown = crownPath(kind, w);
  const zones = crownZones(tooth, w);
  const planned = state.treatments.filter((t) => t.state === "planned");
  const done = state.treatments.filter((t) => t.state === "done");
  const badge = planned.find((t) => t.extraction) ?? planned[0] ?? done[0];
  const outline = missing ? "var(--odo-muted)" : wholeStyle !== undefined && whole !== "sound" ? `var(${wholeStyle.colour})` : "var(--odo-line)";
  const wholeFill = whole === undefined || whole === "sound" || missing ? undefined : fillFor(whole);
  const hasPlanned = planned.length > 0;
  const centre = `${String(w / 2)} ${String(CELL_H / 2)}`;
  const flip = lower ? `translate(0 ${String(CELL_H)}) scale(1 -1)` : undefined;
  const crownTop = ROOT_H;

  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rotate.toFixed(1)} ${centre})`}>
      <g
        className="odo-tooth"
        data-tooth={tooth}
        data-selected={selected ? "true" : "false"}
        data-missing={missing ? "true" : "false"}
        data-planned={hasPlanned ? "true" : "false"}
        role="button"
        tabIndex={focusable ? 0 : -1}
        aria-pressed={selected}
        aria-label={describeTooth(state)}
        onFocus={() => {
          onFocusTooth(tooth);
        }}
        onClick={() => {
          onSelect(tooth, null);
        }}
      >
        <title>{describeTooth(state)}</title>
        {/* hit area keeps thin roots easy to tap */}
        <rect x="-3" y="-3" width={w + 6} height={CELL_H + 6} fill="transparent" />
        <g transform={flip} className="odo-body" opacity={missing ? 0.5 : 1}>
          <g transform={`translate(0 ${String(crownTop)})`}>
            <path
              d={rootPath(kind, w)}
              fill={missing ? "none" : "var(--odo-root)"}
              stroke={outline}
              strokeWidth="1.3"
              strokeDasharray={missing ? "3 3" : undefined}
              className="odo-root"
            />
            {whole === "root_canal" ? <path d={`M${String(w / 2)},-3 V${String(-ROOT_H * 0.7)}`} stroke="var(--odo-warning)" strokeWidth="2" strokeLinecap="round" /> : null}
            {whole === "implant" ? (
              <path
                d={`M${String(w / 2)},-1 V${String(-ROOT_H * 0.9)} M${String(w / 2 - 5)},-5 H${String(w / 2 + 5)} M${String(w / 2 - 5)},-11 H${String(w / 2 + 5)} M${String(w / 2 - 5)},-17 H${String(w / 2 + 5)} M${String(w / 2 - 4)},-23 H${String(w / 2 + 4)}`}
                stroke="var(--odo-primary)"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            ) : null}
          </g>
          <g transform={`translate(0 ${String(crownTop)})`}>
            <clipPath id={clip}>
              <path d={crown} />
            </clipPath>
            <g clipPath={`url(#${clip})`}>
              {missing ? null : (
                <>
                  <rect width={w} height={CROWN_H} fill={wholeFill ?? "var(--odo-surface)"} />
                  {zones.map((zone) => {
                    const finding = state.surfaces[zone.surface];
                    const active = selectedSurface === zone.surface && selected;
                    return (
                      <polygon
                        key={zone.surface}
                        points={zone.points}
                        className="odo-zone"
                        data-surface={zone.surface}
                        data-selected={active ? "true" : "false"}
                        data-finding={finding ?? ""}
                        fill={finding === undefined || finding === "sound" ? (wholeFill ?? "transparent") : fillFor(finding)}
                        stroke="var(--odo-line)"
                        strokeWidth="0.9"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(tooth, zone.surface);
                        }}
                      >
                        <title>{`${surfaceLabel(tooth, zone.surface)} surface of tooth ${String(tooth)}${finding === undefined ? "" : `, ${FINDING_STYLE[finding].label}`}`}</title>
                      </polygon>
                    );
                  })}
                </>
              )}
            </g>
            <path
              d={crown}
              fill="none"
              stroke={outline}
              strokeWidth={whole === "crown" ? 3 : 1.4}
              strokeDasharray={missing ? "3 3" : undefined}
              strokeLinejoin="round"
              className="odo-crown-outline"
              pointerEvents="none"
            />
            {missing ? <path d={`M${String(w * 0.25)},${String(CROWN_H * 0.25)} L${String(w * 0.75)},${String(CROWN_H * 0.75)} M${String(w * 0.75)},${String(CROWN_H * 0.25)} L${String(w * 0.25)},${String(CROWN_H * 0.75)}`} stroke="var(--odo-muted)" strokeWidth="1.6" strokeLinecap="round" pointerEvents="none" /> : null}
            {whole === "bridge" ? <rect x="-3" y={CROWN_H / 2 - 2.5} width={w + 6} height="5" rx="2.5" fill="var(--odo-primary)" stroke="var(--odo-surface)" strokeWidth="1" pointerEvents="none" /> : null}
            {hasPlanned ? <path d={crown} fill="none" stroke="var(--odo-warning)" strokeWidth="1.8" strokeDasharray="4 3" pointerEvents="none" className="odo-planned-ring" /> : null}
            {selected ? <path d={crown} fill="none" strokeWidth="2.6" className="odo-select-ring" pointerEvents="none" /> : null}
          </g>
        </g>
        <g transform={`translate(0 ${String(lower ? 0 : ROOT_H)})`} pointerEvents="none">
          {zones.map((zone) => (
            <text key={zone.surface} x={zone.labelX} y={lower ? CROWN_H - zone.labelY : zone.labelY} textAnchor="middle" dominantBaseline="central" className="odo-zone-code">
              {surfaceCode(tooth, zone.surface)}
            </text>
          ))}
        </g>
        <text x={w / 2} y={lower ? -7 : CELL_H + 14} textAnchor="middle" className="odo-number" pointerEvents="none">
          {tooth}
        </text>
        {badge === undefined ? null : <StatusGlyph mark={badge} x={w + 1} y={lower ? CELL_H - 3 : 3} />}
      </g>
    </g>
  );
}
