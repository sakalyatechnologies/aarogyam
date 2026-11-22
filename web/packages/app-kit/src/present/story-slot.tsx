// The story style in MouthView's overview slot: lazy chunk, text if it fails to load (§13).
import { useState, type ReactNode } from "react";

import type { OverviewSlot } from "../mouth-view/mouth-view.js";
import { StyleBoundary, TextFallback, useChunk } from "./blocks.js";
import type { PresentModel } from "./model.js";
import type { StoryProps } from "./story.js";

const loadStory = () => import("./story.js").then((m) => m.storyStyle);

export function StorySlot({ model, slot, ...rest }: Omit<StoryProps, "stacked"> & { slot: OverviewSlot }): ReactNode {
  const chunk = useChunk(loadStory);
  const [tries, setTries] = useState(0);
  const retry = () => { setTries(tries + 1); chunk.retry(); };
  const fallback = <TextFallback model={model satisfies PresentModel} onRetry={retry} onOpen={slot.open} />;
  if (chunk.state === "failed") return fallback;
  if (chunk.value === undefined) return <div className="ps-wait" role="status" aria-label="Loading the picture" />;
  const Story = chunk.value.Component;
  return <StyleBoundary key={tries} fallback={fallback}><Story model={model} {...rest} /></StyleBoundary>;
}
