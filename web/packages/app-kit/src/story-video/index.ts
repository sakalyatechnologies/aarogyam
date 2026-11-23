// @aarogyam/app-kit/story-video: turns a story (`createStory2d`) into an MP4 on this device (design
// §1.7). Path 1: WebCodecs `VideoEncoder` H.264 Baseline + Mediabunny (MPL-2.0) muxing in memory,
// faster than real time. Path 2: MediaRecorder with `video/mp4` in real time. Otherwise no video
// (WebM is never used); the text summary still goes. Nothing here uploads anything.
import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from "mediabunny";

import {
  VIDEO_CONFIG, recorderType, type Renderable, type VideoPath,
} from "./support.js";

export * from "./support.js";

const KEYFRAME_EVERY = 60; // 2 s
const MAX_QUEUE = 5;

export interface EncodeOptions {
  path: VideoPath;
  /** 0..1. */
  onProgress?: (done: number) => void;
  signal?: AbortSignal;
  /** The canvas the story draws on (needed for VideoFrame and captureStream). */
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

const aborted = () => new DOMException("The video was cancelled", "AbortError");
const nextTask = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/** Renders every frame and returns the MP4. Rejects with an AbortError when `signal` aborts. */
export async function encodeStory(story: Renderable, opts: EncodeOptions): Promise<Blob> {
  return opts.path === "webcodecs" ? encodeWebCodecs(story, opts) : encodeRecorder(story, opts);
}

async function encodeWebCodecs(story: Renderable, { canvas, onProgress, signal }: EncodeOptions): Promise<Blob> {
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const source = new EncodedVideoPacketSource("avc");
  output.addVideoTrack(source, { frameRate: story.fps });
  await output.start();
  let muxing: Promise<void> = Promise.resolve();
  let failure: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxing = muxing.then(() => source.add(EncodedPacket.fromEncodedChunk(chunk), meta));
    },
    error: (e) => { failure = e; },
  });
  const stop = async () => {
    if (encoder.state !== "closed") encoder.close();
    await output.cancel();
  };
  try {
    encoder.configure({ ...VIDEO_CONFIG, width: story.width, height: story.height, framerate: story.fps, avc: { format: "avc" } });
    const step = 1_000_000 / story.fps;
    for (let i = 0; i < story.frames; i++) {
      if (signal?.aborted === true) throw aborted();
      if (failure !== undefined) throw failure;
      story.renderAt((i * 1000) / story.fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
      encoder.encode(frame, { keyFrame: i % KEYFRAME_EVERY === 0 });
      frame.close();
      // back-pressure: never more than a few frames queued in the encoder
      while (encoder.encodeQueueSize > MAX_QUEUE) await nextTask();
      if (i % 10 === 9) {
        onProgress?.((i + 1) / story.frames);
        await nextTask(); // keep the page responsive
      }
    }
    await encoder.flush();
    if (failure !== undefined) throw failure;
    encoder.close();
    await muxing;
    source.close();
    await output.finalize();
  } catch (e) {
    await stop().catch(() => undefined);
    throw e;
  }
  const buffer = target.buffer;
  if (buffer === null) throw new Error("no video");
  onProgress?.(1);
  return new Blob([buffer], { type: "video/mp4" });
}

/** Path 2: real time; the tab must stay visible. */
async function encodeRecorder(story: Renderable, { canvas, onProgress, signal }: EncodeOptions): Promise<Blob> {
  const type = recorderType();
  if (type === undefined || !("captureStream" in canvas)) throw new Error("no MP4 recorder");
  const stream = canvas.captureStream(story.fps);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_CONFIG.bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const done = new Promise<void>((resolve) => { recorder.onstop = () => { resolve(); }; });
  story.renderAt(0);
  recorder.start(1000);
  const t0 = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (signal?.aborted === true) { reject(aborted()); return; }
        const t = performance.now() - t0;
        story.renderAt(Math.min(t, story.duration));
        onProgress?.(Math.min(1, t / story.duration));
        if (t >= story.duration) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    recorder.stop();
    stream.getTracks().forEach((track) => { track.stop(); });
  }
  await done;
  return new Blob(chunks, { type: "video/mp4" });
}
