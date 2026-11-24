// An X-ray the doctor can pin teeth on (present-studio-design slice 2g), for hosts that bring the picture
// and keep the pins themselves: the phone's WebView page gets a signed link and saves through the app, so
// nothing here calls an API. A tap puts a pin at that spot as fractions of the image in its own orientation
// (never flipped); the doctor then picks the FDI tooth and may add a short label. One pin per tooth.
// Loaded on demand (`@aarogyam/app-kit/present/xray-pins`).
import { useState, type MouseEvent, type ReactElement } from "react";

import { XrayEdges } from "./xray.js";

/** One pin: a tooth (FDI) and where it sits, as fractions (0 to 1) of the image. */
export interface XrayPin {
  tooth: number;
  x: number;
  y: number;
  label?: string | null | undefined;
}

/** Quadrants 1 to 4 have teeth 1 to 8; the child quadrants 5 to 8 have 1 to 5. */
export function isFdiTooth(tooth: number): boolean {
  const quadrant = Math.floor(tooth / 10);
  const position = tooth % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  return quadrant >= 5 && quadrant <= 8 && position >= 1 && position <= 5;
}

const LABEL_MAX = 40;
const pct = (n: number) => `${String(Math.round(Math.min(1, Math.max(0, n)) * 1000) / 10)}%`;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export interface PinnableXrayProps {
  /** The picture's signed link; never logged. */
  src: string;
  alt: string;
  caption?: string | undefined;
  pins: readonly XrayPin[];
  /** The whole set after a change: the host saves it. Without it the pins are shown and cannot be changed. */
  onChange?: ((pins: readonly XrayPin[]) => void) | undefined;
}

export function PinnableXray({ src, alt, caption, pins, onChange }: PinnableXrayProps): ReactElement {
  const [pending, setPending] = useState<{ x: number; y: number } | undefined>(undefined);
  const [quadrant, setQuadrant] = useState<number | undefined>(undefined);
  const [label, setLabel] = useState("");
  const [active, setActive] = useState<number | undefined>(undefined);
  const close = () => { setPending(undefined); setQuadrant(undefined); setLabel(""); };
  const drop = (event: MouseEvent<HTMLDivElement>) => {
    if (onChange === undefined || (event.target instanceof Element && event.target.closest(".ps-pinx-pin") !== null)) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    setPending({ x: clamp01((event.clientX - box.left) / box.width), y: clamp01((event.clientY - box.top) / box.height) });
    setQuadrant(undefined);
  };
  const place = (position: number) => {
    if (pending === undefined || quadrant === undefined || onChange === undefined) return;
    const tooth = quadrant * 10 + position;
    if (!isFdiTooth(tooth)) return;
    const name = label.trim();
    onChange([...pins.filter((p) => p.tooth !== tooth), { tooth, x: pending.x, y: pending.y, ...(name === "" ? {} : { label: name }) }]);
    setActive(tooth);
    close();
  };
  const positions = quadrant === undefined ? [] : Array.from({ length: quadrant <= 4 ? 8 : 5 }, (_, i) => i + 1);
  return (
    <figure className="ps-xr-fig ps-pinx">
      <div className="ps-xr-stage" data-xray-stage="">
        <div className="ps-pinx-wrap" data-testid="pinnable-xray" onClick={drop}>
          <img className="ps-xr-img" src={src} alt={alt} draggable={false} />
          {pins.map((p, i) => (
            <button
              key={p.tooth}
              type="button"
              className="ps-pinx-pin"
              data-active={active === p.tooth || undefined}
              style={{ left: pct(p.x), top: pct(p.y) }}
              aria-pressed={active === p.tooth}
              aria-label={`Pin ${String(i + 1)}: tooth ${String(p.tooth)}${p.label == null ? "" : `, ${p.label}`}`}
              onClick={() => { setActive(active === p.tooth ? undefined : p.tooth); }}
            >
              {i + 1}
              {p.label == null ? null : <span className="ps-pinx-label" aria-hidden="true">{p.label}</span>}
            </button>
          ))}
          {pending === undefined ? null : <span className="ps-pinx-pin" data-pending="" aria-hidden="true" style={{ left: pct(pending.x), top: pct(pending.y) }}>{pins.length + 1}</span>}
        </div>
        <XrayEdges />
      </div>
      {onChange !== undefined && pending === undefined ? <p className="ps-muted ps-pinx-hint">Tap the image to pin a tooth.</p> : null}
      {pending === undefined ? null : (
        <div className="ps-pinx-pick" role="group" aria-label="Which tooth is this?">
          <b>Which tooth is this?</b>
          <div className="ps-seg" role="group" aria-label="Quadrant">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((q) => (
              <button key={q} type="button" aria-pressed={quadrant === q} onClick={() => { setQuadrant(q); }}>{String(q)}</button>
            ))}
          </div>
          {quadrant === undefined ? null : (
            <div className="ps-seg" role="group" aria-label="Tooth">
              {positions.map((n) => (
                <button key={n} type="button" onClick={() => { place(n); }}>{String(quadrant * 10 + n)}</button>
              ))}
            </div>
          )}
          <label className="ps-pinx-name">
            {"Label (optional) "}
            <input type="text" value={label} maxLength={LABEL_MAX} onChange={(event) => { setLabel(event.target.value); }} />
          </label>
          <button type="button" className="pm-chip" onClick={close}>Cancel</button>
        </div>
      )}
      {onChange !== undefined && pins.length > 0 && pending === undefined ? (
        <button type="button" className="pm-chip ps-pinx-clear" onClick={() => { setActive(undefined); onChange([]); }}>Clear pins</button>
      ) : null}
      {caption === undefined ? null : <figcaption className="ps-muted">{caption}</figcaption>}
    </figure>
  );
}
