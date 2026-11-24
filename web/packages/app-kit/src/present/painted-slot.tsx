// The painted style in MouthView's overview slot (present-studio-design §6.2), shared by the portal's Show
// patient and the phone story bundle: a tap on a dot opens the tooth detail; text if its chunk fails (§13).
import { useState, type ReactNode } from "react";

import type { OverviewSlot } from "../mouth-view/mouth-view.js";
import { StyleBoundary, TextFallback, useChunk } from "./blocks.js";
import type { Orientation, PresentModel } from "./model.js";
import type { PaintedProps, PaintedView } from "./painted.js";
import type { Shade } from "./painter.js";

const loadPainted = () => import("./painted.js").then((m) => m.paintedStyle);

export function PaintedSlot({ model, slot, ...knobs }: {
  model: PresentModel; slot: OverviewSlot; orientation: Orientation; onOrientation: (o: Orientation) => void;
  shade: Shade; onShade: (s: Shade) => void; theme: "light" | "dark";
  /** Offers "Save colour" beside the slider while the colour differs from the saved one. */
  shadeDirty?: boolean | undefined; onSaveShade?: (() => void) | undefined; savingShade?: boolean | undefined;
  /** Front or Open wide; undefined lets the painted style pick (Open wide when the front hides every problem). */
  view?: PaintedView | undefined; onView?: ((v: PaintedView) => void) | undefined;
  /** Lazy 3D module for the tooth sheet's "See in 3D". */
  load3d?: PaintedProps["load3d"];
  /** The portal opens the tooth sheet on a tap; the phone bundle keeps MouthView's tooth screen. */
  toothSheet?: boolean | undefined;
}): ReactNode {
  const chunk = useChunk(loadPainted);
  // a render error also falls back to text; retry remounts the boundary
  const [tries, setTries] = useState(0);
  const retry = () => { setTries(tries + 1); chunk.retry(); };
  const fallback = <TextFallback model={model} onRetry={retry} onOpen={slot.open} />;
  if (chunk.state === "failed") return fallback;
  if (chunk.value === undefined) return <div className="ps-wait" role="status" aria-label="Loading the picture" />;
  const Painted = chunk.value.Component;
  return (
    <StyleBoundary key={tries} fallback={fallback}>
      <Painted model={model} onOpen={slot.open} {...knobs} />
    </StyleBoundary>
  );
}
