// @aarogyam/app-kit/story-2d: the canvas 2D visit story (design §1.7, P4), the first implementation
// of the story contract `createStory(canvas, payload, {clock: "virtual"})`. It draws the mouth-art
// kit's Path2D art on a 2D context (no WebGL, no SVG per frame); `story_version` picks it.
import type { VisitStory } from "@aarogyam/api-client";

import { drawFrame, type StoryCtx } from "./draw.js";
import { prepareStory, type PrepareOptions, type PreparedStory } from "./prepare.js";
import { FPS, HEIGHT, WIDTH } from "./storyboard.js";

export { drawFrame, type DrawOptions, type StoryCtx } from "./draw.js";
export { prepareStory, type PrepareOptions, type PreparedStory } from "./prepare.js";
export { FPS, HEIGHT, WIDTH, TIMING, storyboard, storyFacts, sectionOf, segmentAt, longDay, type Segment, type SectionName, type StoryFacts } from "./storyboard.js";

/** The story versions this renderer draws. */
export const STORY_VERSIONS: readonly number[] = [1];

/** A ready story: `renderAt(ms)` paints that frame on the canvas. */
export interface Story {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** ms. */
  readonly duration: number;
  readonly frames: number;
  readonly prepared: PreparedStory;
  renderAt(ms: number): void;
}

export interface StoryOptions extends PrepareOptions {
  /** "virtual": frames are drawn when asked (the encoder's clock), never on a timer. */
  clock?: "virtual";
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Sizes the canvas to 720×1280, loads the art the story needs and returns the frame painter. */
export async function createStory2d(canvas: AnyCanvas, payload: VisitStory, opts: StoryOptions = {}): Promise<Story> {
  const prepared = await prepareStory(payload, opts);
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx: StoryCtx | null =
    typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas
      ? canvas.getContext("2d", { alpha: false })
      : canvas instanceof HTMLCanvasElement
        ? canvas.getContext("2d", { alpha: false })
        : null;
  if (ctx === null) throw new Error("no 2d context");
  return {
    width: WIDTH, height: HEIGHT, fps: FPS, prepared,
    duration: prepared.duration,
    frames: Math.ceil((prepared.duration * FPS) / 1000),
    renderAt: (ms) => { drawFrame(ctx, prepared, ms); },
  };
}
