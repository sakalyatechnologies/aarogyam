// The patient's video on the phone (design §1.7): the `/visits/{id}/story` JSON, untouched, drawn by
// the canvas 2D story and encoded on this device. Loaded lazily, so Present never downloads the encoder.
import { visitStory } from "@aarogyam/api-client";
import { STORY_VERSIONS, createStory2d } from "@aarogyam/app-kit/story-2d";
import { encodeStory, pickVideoPath } from "@aarogyam/app-kit/story-video";

import type { FailReason, PageMessage } from "./channel.js";

/** The MP4 goes back in parts of 512 KB at most (mobile `PageMessage.Chunk`). */
export const CHUNK_BYTES = 512 * 1024;

/** Base64 of one part, built in slices so a large part never overflows the argument limit. */
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

class RenderFailure extends Error {
  constructor(readonly reason: FailReason) {
    super(reason);
  }
}

function parseStory(input: unknown) {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new RenderFailure("bad_story");
    }
  }
  const parsed = visitStory.safeParse(value);
  if (!parsed.success) throw new RenderFailure("bad_story");
  if (!STORY_VERSIONS.includes(parsed.data.story_version)) throw new RenderFailure("unsupported_version");
  return parsed.data;
}

/**
 * Renders and encodes the story, then sends progress, the chunks and done; any stop sends failed with a
 * short reason. `signal` is the bridge's cancel.
 */
export async function runRender(input: unknown, send: (m: PageMessage) => void, signal: AbortSignal): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const stopIfCancelled = () => { if (signal.aborted) throw new RenderFailure("cancelled"); };
  canvas.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  try {
    const payload = parseStory(input);
    const path = await pickVideoPath();
    if (path === undefined) throw new RenderFailure("no_encoder");
    document.body.appendChild(canvas);
    const story = await createStory2d(canvas, payload, { clock: "virtual" });
    stopIfCancelled();
    send({ type: "progress", value: 0 });
    const blob = await encodeStory(story, {
      path, canvas, signal,
      onProgress: (value) => { if (!signal.aborted) send({ type: "progress", value }); },
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    for (let seq = 0, at = 0; at < bytes.length; seq++, at += CHUNK_BYTES) {
      stopIfCancelled();
      send({ type: "chunk", seq, base64: toBase64(bytes.subarray(at, at + CHUNK_BYTES)) });
    }
    send({ type: "done", bytes: bytes.length });
  } catch (e) {
    const reason: FailReason = e instanceof RenderFailure ? e.reason : signal.aborted ? "cancelled" : "encode_failed";
    send({ type: "failed", reason });
  } finally {
    canvas.remove();
  }
}
