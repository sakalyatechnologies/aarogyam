// The Face to tooth style (present-studio-design §6.5, Beta): a neutral example face with a dot on each
// recorded item in the smile zone, then the painted map, then the tooth sheet. Everything not seen when
// smiling lists under "Further back". The face is an illustration, never the patient.
import { useMemo, useState, type ReactElement } from "react";

import { IllustrationBadge, ProvenanceFooter, RecordBadge, dotsOf } from "./blocks.js";
import { screenOrder, type FactItem, type PresentModel } from "./model.js";
import { PaintedStyle, type PaintedProps } from "./painted.js";
import { inSmileZone } from "./smile-zone.js";

export interface FaceProps extends Omit<PaintedProps, "onOpen" | "toothSheet"> {
  /** Where it opens: the face, or the painted map. Unset: the face, unless the smile zone holds no recorded item. */
  start?: "face" | "map" | undefined;
}

/** The facts split by the smile-zone rule: what people notice, then what lies further back. */
export function splitFacts(model: PresentModel, wide: boolean): { zone: FactItem[]; back: FactItem[] } {
  const zone = model.facts.filter((f) => f.tooth !== undefined && inSmileZone(f.tooth, wide));
  return { zone, back: model.facts.filter((f) => !zone.includes(f)) };
}

const MOUTH = { cx: 100, w: 92, up: 158, low: 174, r: 4.4 };

function FacePicture({ model, orientation, wide, onOpen }: { model: PresentModel; orientation: PaintedProps["orientation"]; wide: boolean; onOpen: (tooth: number) => void }): ReactElement {
  const dots = dotsOf(model).filter((d) => inSmileZone(d.tooth, wide));
  const at = (tooth: number): { x: number; y: number } | undefined => {
    const upper = (model.teeth.find((t) => t.tooth === tooth)?.quadrant ?? 1) <= 2;
    const row = screenOrder(model, upper ? "upper" : "lower", orientation).filter((t) => inSmileZone(t, wide));
    const i = row.indexOf(tooth);
    if (i < 0) return undefined;
    const x = MOUTH.cx - MOUTH.w / 2 + (MOUTH.w * (i + .5)) / row.length;
    return { x, y: upper ? MOUTH.up : MOUTH.low };
  };
  return (
    <svg className="ps-face-svg" viewBox="0 0 200 240" role="img" aria-label="Example face with a dot on each recorded tooth you would notice when smiling">
      <g className="ps-face-shape" aria-hidden="true">
        <path d="M36 240c4-34 28-46 64-46s60 12 64 46z" />
        <rect x="84" y="176" width="32" height="34" rx="12" />
        <ellipse cx="100" cy="104" rx="60" ry="76" />
        <path className="ps-face-lips" d="M54 166c14-14 30-16 46-12 16-4 32-2 46 12-12 22-28 28-46 28s-34-6-46-28z" />
        <path className="ps-face-line" d="M82 96c4-3 10-3 14 0M104 96c4-3 10-3 14 0M100 112v18" />
      </g>
      {dots.map((d) => {
        const p = at(d.tooth);
        if (p === undefined) return null;
        return (
          <g key={d.tooth} className="ps-dot" data-tone={d.tone} data-tooth={d.tooth} role="button" tabIndex={0} aria-label={d.label}
            onClick={() => { onOpen(d.tooth); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(d.tooth); } }}>
            <circle className="ps-dot-halo" cx={p.x} cy={p.y} r={MOUTH.r * 1.35} />
            <circle className="ps-dot-fill" cx={p.x} cy={p.y} r={MOUTH.r} />
            <text x={p.x} y={p.y} fontSize={MOUTH.r * 1.2} textAnchor="middle" dominantBaseline="central">{d.n}</text>
          </g>
        );
      })}
    </svg>
  );
}

function FactRow({ f }: { f: FactItem }): ReactElement {
  return (
    <li className="ps-fact ps-face-fact" data-kind={f.kind} data-fact={f.id}>
      <span className="ps-where">{f.where}{f.tooth === undefined ? "" : ` · ${String(f.tooth)}`}</span>
      <b>{f.words}</b>
      <RecordBadge on={f.recorded_on} />
    </li>
  );
}

export function FaceStyle(props: FaceProps): ReactElement {
  const { model, orientation } = props;
  const [wide, setWide] = useState(false);
  const { zone, back } = useMemo(() => splitFacts(model, wide), [model, wide]);
  // §6.5 degrade: nothing recorded in the smile zone (even drawn wide) opens at the painted map
  const nothingNoticed = useMemo(() => splitFacts(model, true).zone.length === 0, [model]);
  const [step, setStep] = useState<"face" | "map" | undefined>(props.start);
  const view = step ?? (nothingNoticed ? "map" : "face");
  if (view === "map") {
    return (
      <div className="ps-face-map" data-present-style="face" data-view="map">
        <div className="ps-face-bar">
          {nothingNoticed && step === undefined ? <p className="ps-muted">Your findings are further back (general guidance).</p> : null}
          {nothingNoticed ? null : <button type="button" className="ps-chip-btn" onClick={() => { setStep("face"); }}>Back to the face</button>}
        </div>
        <PaintedStyle {...props} onOpen={() => undefined} toothSheet />
      </div>
    );
  }
  return (
    <div className="ps-painted ps-face" data-present-style="face" data-view="face">
      <div className="ps-stage">
        <div className="ps-knobs">
          <div className="ps-seg" role="group" aria-label="How wide the smile is">
            <button type="button" aria-pressed={!wide} onClick={() => { setWide(false); }}>Front teeth</button>
            <button type="button" aria-pressed={wide} onClick={() => { setWide(true); }}>Wide smile</button>
          </div>
          <button type="button" className="ps-chip-btn" onClick={() => { setStep("map"); }}>Look closer: painted map</button>
        </div>
        <FacePicture model={model} orientation={orientation} wide={wide} onOpen={() => { setStep("map"); }} />
        <div className="ps-caption">
          <IllustrationBadge>Example face, not you</IllustrationBadge>
          <span className="ps-muted">Tap a numbered dot to look closer.</span>
        </div>
      </div>
      <div className="ps-side">
        <section className="ps-found" aria-label="What we found">
          <h3 className="ps-h">What we found</h3>
          {zone.length === 0 ? <p className="ps-muted">Nothing is recorded on the teeth people notice when you smile.</p> : <ol className="ps-found-list">{zone.map((f) => <FactRow key={f.id} f={f} />)}</ol>}
          {back.length === 0 ? null : (
            <div className="ps-face-back">
              <h4 className="ps-h2">Further back: not usually seen when smiling (general guidance)</h4>
              <ul className="ps-found-list">{back.map((f) => <FactRow key={f.id} f={f} />)}</ul>
            </div>
          )}
        </section>
        <ProvenanceFooter
          recorded={["The dots and this list come from this visit's record."]}
          illustration={["The face is a plain example and is not you; it only shows where the teeth sit."]}
        />
      </div>
    </div>
  );
}

export const faceStyle = { id: "face" as const, label: "Face to tooth", Component: FaceStyle };
