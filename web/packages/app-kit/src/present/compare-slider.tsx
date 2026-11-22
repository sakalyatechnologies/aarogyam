// CompareSlider (present-studio-design §5.3): ONE scene with two states in the same viewBox. The left of the
// divider is state A, the right is state B; both pictures are drawn at the same size over each other and the
// divider only clips the top one, so the two halves always line up (never two different crops, review M9).
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";

import { ArtSvg } from "../mouth-art/react.js";
import type { Box, Scene } from "../mouth-art/types.js";

/** The smallest box holding both: the one viewBox the two states share. */
export function sharedBox(a: Box, b: Box): Box {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0] + a[2], b[0] + b[2]), y1 = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x0, y0, x1 - x0, y1 - y0];
}

export interface CompareSliderProps {
  a: Scene;
  b: Scene;
  /** Accessible name of the whole picture. */
  label: string;
  /** Short words on the two sides ("Now", "After the next step"). */
  aWords: string;
  bWords: string;
  /** Badges under each side's word (record or illustration). */
  aBadge?: ReactNode;
  bBadge?: ReactNode;
}

export function CompareSlider({ a, b, label, aWords, bWords, aBadge, bBadge }: CompareSliderProps): ReactElement {
  const box = sharedBox(a.box, b.box);
  const [pos, setPos] = useState(50);
  const drag = useRef(false);
  const wrap = useRef<HTMLDivElement>(null);
  const move = (clientX: number) => {
    const r = wrap.current?.getBoundingClientRect();
    if (r === undefined || r.width === 0) return;
    setPos(Math.max(0, Math.min(100, Math.round(((clientX - r.left) / r.width) * 100))));
  };
  const down = (e: PointerEvent) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 20 : 5;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") setPos(Math.max(0, pos - step));
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") setPos(Math.min(100, pos + step));
    else if (e.key === "Home") setPos(0);
    else if (e.key === "End") setPos(100);
    else return;
    e.preventDefault();
  };
  return (
    <figure className="ps-compare" data-compare="">
      <div className="ps-cmp-stage" ref={wrap} style={{ aspectRatio: `${box[2].toFixed(2)} / ${box[3].toFixed(2)}` }}
        onPointerDown={down} onPointerMove={(e) => { if (drag.current) move(e.clientX); }} onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}>
        <div className="ps-cmp-layer"><ArtSvg scene={{ ...a, box }} label={`${aWords}: ${label}`} /></div>
        <div className="ps-cmp-layer ps-cmp-top" style={{ clipPath: `inset(0 0 0 ${String(pos)}%)` }}><ArtSvg scene={{ ...b, box }} label={`${bWords}: ${label}`} /></div>
        <div className="ps-cmp-line" style={{ left: `${String(pos)}%` }} aria-hidden="true" />
        <div className="ps-cmp-handle" role="slider" tabIndex={0} aria-label={`Compare: ${aWords} and ${bWords}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pos}
          aria-valuetext={pos === 0 ? `All ${bWords}` : pos === 100 ? `All ${aWords}` : `${String(pos)}% ${aWords}, the rest ${bWords}`}
          style={{ left: `${String(pos)}%` }} onKeyDown={key}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
      </div>
      <figcaption className="ps-cmp-cap">
        <span className="ps-cmp-side"><b>{aWords}</b>{aBadge}</span>
        <span className="ps-cmp-side" data-end=""><b>{bWords}</b>{bBadge}</span>
      </figcaption>
    </figure>
  );
}
