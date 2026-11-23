// The Face to tooth style in MouthView's overview slot: lazy chunk, text if it fails to load (§13).
import { useState, type ReactNode } from "react";

import type { OverviewSlot } from "../mouth-view/mouth-view.js";
import { StyleBoundary, TextFallback, useChunk } from "./blocks.js";
import type { FaceProps } from "./face.js";

const loadFace = () => import("./face.js").then((m) => m.faceStyle);

export function FaceSlot({ model, slot, ...rest }: FaceProps & { slot: OverviewSlot }): ReactNode {
  const chunk = useChunk(loadFace);
  const [tries, setTries] = useState(0);
  const retry = () => { setTries(tries + 1); chunk.retry(); };
  const fallback = <TextFallback model={model} onRetry={retry} onOpen={slot.open} />;
  if (chunk.state === "failed") return fallback;
  if (chunk.value === undefined) return <div className="ps-wait" role="status" aria-label="Loading the picture" />;
  const Face = chunk.value.Component;
  return <StyleBoundary key={tries} fallback={fallback}><Face model={model} {...rest} /></StyleBoundary>;
}
