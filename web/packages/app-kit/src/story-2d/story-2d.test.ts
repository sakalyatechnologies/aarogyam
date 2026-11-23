import { describe, expect, it } from "vitest";

import { mouthSnapshot, type VisitStory } from "@aarogyam/api-client";

import fixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { PathLike } from "../mouth-art/render.js";
import { canShareVideo, pickVideoPath, recorderType, videoFileName, type VideoEnv } from "../story-video/support.js";
import { drawFrame, type StoryCtx } from "./draw.js";
import { prepareStory } from "./prepare.js";
import { sectionOf, storyboard, storyFacts, type SectionName } from "./storyboard.js";

const aarav = (): VisitStory => ({
  story_version: 1,
  visit_number: "V-318",
  visited_on: "2026-11-19",
  clinic_name: "Sunrise Dental Care",
  next_visit: "2026-11-26",
  chart: mouthSnapshot.parse(fixture.snapshot),
});

class FakePath implements PathLike {
  parts: string[];
  constructor(d = "") { this.parts = [d]; }
  addPath(p: PathLike): void { if (p instanceof FakePath) this.parts.push(...p.parts); }
}

/** A canvas that writes every call and property set to a log; `measureText` is a stand-in width. */
class Recorder implements StoryCtx {
  log: string[] = [];
  texts: string[] = [];
  #font = "10px sans-serif";
  #fill: StoryCtx["fillStyle"] = "#000";
  #stroke: StoryCtx["strokeStyle"] = "#000";
  #width = 1;
  #cap: CanvasLineCap = "butt";
  #join: CanvasLineJoin = "miter";
  #alpha = 1;
  #align: CanvasTextAlign = "start";
  #baseline: CanvasTextBaseline = "alphabetic";
  private rec(name: string, ...args: unknown[]): void {
    this.log.push(`${name}(${args.map((a) => (a instanceof FakePath ? a.parts.join("|") : typeof a === "number" ? a.toFixed(3) : JSON.stringify(a))).join(",")})`);
  }
  private set_(name: string, value: string | number): void { this.log.push(`${name}=${String(value)}`); }
  private paint(v: StoryCtx["fillStyle"]): string { return typeof v === "string" ? v : "gradient"; }
  get font(): string { return this.#font; }
  set font(v: string) { this.#font = v; this.set_("font", v); }
  get fillStyle(): StoryCtx["fillStyle"] { return this.#fill; }
  set fillStyle(v: StoryCtx["fillStyle"]) { this.#fill = v; this.set_("fill", this.paint(v)); }
  get strokeStyle(): StoryCtx["strokeStyle"] { return this.#stroke; }
  set strokeStyle(v: StoryCtx["strokeStyle"]) { this.#stroke = v; this.set_("stroke", this.paint(v)); }
  get lineWidth(): number { return this.#width; }
  set lineWidth(v: number) { this.#width = v; this.set_("lineWidth", v); }
  get lineCap(): CanvasLineCap { return this.#cap; }
  set lineCap(v: CanvasLineCap) { this.#cap = v; this.set_("lineCap", v); }
  get lineJoin(): CanvasLineJoin { return this.#join; }
  set lineJoin(v: CanvasLineJoin) { this.#join = v; this.set_("lineJoin", v); }
  get globalAlpha(): number { return this.#alpha; }
  set globalAlpha(v: number) { this.#alpha = v; this.set_("alpha", v.toFixed(3)); }
  get textAlign(): CanvasTextAlign { return this.#align; }
  set textAlign(v: CanvasTextAlign) { this.#align = v; this.set_("align", v); }
  get textBaseline(): CanvasTextBaseline { return this.#baseline; }
  set textBaseline(v: CanvasTextBaseline) { this.#baseline = v; this.set_("baseline", v); }
  save(): void { this.rec("save"); }
  restore(): void { this.rec("restore"); }
  transform(...m: number[]): void { this.rec("transform", ...m); }
  setTransform(...m: number[]): void { this.rec("setTransform", ...m); }
  translate(x: number, y: number): void { this.rec("translate", x, y); }
  rotate(a: number): void { this.rec("rotate", a); }
  scale(x: number, y: number): void { this.rec("scale", x, y); }
  clip(p: PathLike): void { this.rec("clip", p); }
  fill(p: PathLike): void { this.rec("fill", p); }
  stroke(p: PathLike): void { this.rec("stroke", p); }
  fillRect(...r: number[]): void { this.rec("fillRect", ...r); }
  setLineDash(d: number[]): void { this.rec("dash", ...d); }
  measureText(text: string): { width: number } { return { width: text.length * Number(/(\d+(?:\.\d+)?)px/.exec(this.#font)?.[1] ?? 10) * 0.55 }; }
  createLinearGradient(...a: number[]): CanvasGradient { this.rec("lin", ...a); return this.gradient(); }
  createRadialGradient(...a: number[]): CanvasGradient { this.rec("rad", ...a); return this.gradient(); }
  fillText(text: string, x: number, y: number): void { this.texts.push(text); this.rec("text", text, x, y); }
  strokeText(text: string, x: number, y: number): void { this.rec("strokeText", text, x, y); }
  private gradient(): CanvasGradient { return { addColorStop: (o: number, c: string) => { this.rec("stop", o, c); } }; }
}

function recorder(): { ctx: StoryCtx; log: string[]; texts: string[] } {
  const ctx = new Recorder();
  return { ctx, log: ctx.log, texts: ctx.texts };
}

function hash(lines: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const l of lines) for (let i = 0; i < l.length; i++) h = Math.imul(h ^ l.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

const makePath = (d: string) => new FakePath(d);

describe("story storyboard", () => {
  it("walks every section for Aarav: title, overview, zoom to 21, stepper, back, findings, end", () => {
    const facts = storyFacts(aarav());
    const board = storyboard(facts);
    const sections = new Set<SectionName>(board.map(sectionOf));
    expect([...sections]).toEqual(["title", "overview", "zoom", "stepper", "back", "findings", "end"]);
    expect(facts.focus?.fdi).toBe(21);
    expect(board.filter((s) => s.kind === "step")).toHaveLength(4);
    const end = board.at(-1)?.end ?? 0;
    expect(end).toBeGreaterThanOrEqual(15_000);
    expect(end).toBeLessThanOrEqual(20_000);
    // contiguous, no gaps
    board.forEach((s, i) => { if (i > 0) expect(s.start).toBe(board[i - 1]?.end); });
    expect(facts.planned.map((p) => `${String(p.fdi)} ${p.words}`)).toEqual(["21 Crown", "55 Filling"]);
    expect(facts.findings.map((f) => `${String(f.fdi)} ${f.words}`)).toEqual(["55 Decay into the tooth"]);
    expect(facts.visitDay).toBe("Thursday, 19 November 2026");
    expect(facts.nextVisit).toBe("Thu 26 Nov");
  });

  it("skips the tooth and findings sections when nothing was treated or found", () => {
    const story = aarav();
    story.chart = { ...story.chart, focus: [], teeth: story.chart.teeth.filter((t) => t.tooth === 75) };
    const board = storyboard(storyFacts(story));
    expect(board.map(sectionOf)).toEqual(["title", "overview", "end"]);
  });
});

describe("drawFrame", () => {
  it("is deterministic: the same time gives the same calls, other times differ", async () => {
    const story = await prepareStory(aarav());
    const at = (t: number) => {
      const { ctx, log } = recorder();
      drawFrame(ctx, story, t, { makePath });
      return hash(log);
    };
    const times = [900, 4000, 5500, 8500, 14_000, 16_500, 19_000];
    const first = times.map(at);
    expect(times.map(at)).toEqual(first);
    expect(new Set(first).size).toBe(times.length);
  });

  it("says each section's words, the visit number on the end card, and never a name", async () => {
    const story = await prepareStory(aarav());
    const words = (t: number) => {
      const { ctx, texts } = recorder();
      drawFrame(ctx, story, t, { makePath });
      return texts.join(" ");
    };
    const seg = (kind: string, index?: number) => story.board.find((s) => s.kind === kind && (index === undefined || ("index" in s && s.index === index)));
    const mid = (kind: string, index?: number) => { const s = seg(kind, index); return s === undefined ? -1 : (s.start + s.end) / 2 + 400; };
    expect(words(mid("title"))).toContain("Sunrise Dental Care");
    expect(words(mid("title"))).toContain("Thursday, 19 November 2026");
    expect(words(mid("overview"))).toContain("Your teeth");
    expect(words(mid("overview"))).toContain("2 teeth need attention");
    const step1 = words(mid("step", 1));
    expect(step1).toContain("You are here");
    expect(step1).toContain("Visit 4 (today)");
    expect(step1).toContain("A medicine is placed inside the");
    expect(words(mid("step", 2))).toContain("Next visit: Thu 26 Nov");
    expect(words(mid("back"))).toContain("Planned next");
    expect(words(mid("findings"))).toContain("Decay into the tooth");
    const end = words(story.duration - 100);
    expect(end).toContain("V-318");
    expect(end).toContain("To book, reply or call");
    for (let t = 0; t < story.duration; t += 500) expect(words(t)).not.toMatch(/Aarav|Nair|\+91|PIN|shared\//);
  });
});

describe("encoder choice", () => {
  const encoder = (supported: boolean | "throws") => ({
    isConfigSupported: (config: VideoEncoderConfig) => {
      expect(config.codec).toBe("avc1.42001f");
      return supported === "throws" ? Promise.reject(new Error("nope")) : Promise.resolve({ supported, config });
    },
  });
  const recorderOf = (types: string[]) => ({ isTypeSupported: (t: string) => types.includes(t) });

  it("prefers WebCodecs, then MediaRecorder MP4, never WebM", async () => {
    const full: VideoEnv = { isSecureContext: true, VideoEncoder: encoder(true), VideoFrame: {}, MediaRecorder: recorderOf(["video/mp4"]) };
    expect(await pickVideoPath(full)).toBe("webcodecs");
    expect(await pickVideoPath({ ...full, VideoEncoder: encoder(false) })).toBe("mediarecorder");
    expect(await pickVideoPath({ ...full, VideoEncoder: encoder("throws") })).toBe("mediarecorder");
    expect(await pickVideoPath({ ...full, VideoFrame: undefined })).toBe("mediarecorder");
    expect(await pickVideoPath({ isSecureContext: true, MediaRecorder: recorderOf(["video/webm", "video/webm;codecs=vp9"]) })).toBeUndefined();
    expect(await pickVideoPath({ isSecureContext: true })).toBeUndefined();
    expect(await pickVideoPath({ ...full, isSecureContext: false })).toBeUndefined();
    expect(recorderType({ MediaRecorder: recorderOf(["video/mp4;codecs=avc1", "video/mp4"]) })).toBe("video/mp4;codecs=avc1");
  });

  it("names the file after the visit number only", () => {
    expect(videoFileName("V-318")).toBe("V-318.mp4");
    expect(videoFileName("V-318/../x")).toBe("V-318x.mp4");
    expect(videoFileName("")).toBe("visit.mp4");
    expect(videoFileName("V-318 ")).toMatch(/^[A-Za-z0-9-]+\.mp4$/);
  });

  it("shares only where the system share sheet takes a video file", () => {
    expect(canShareVideo(undefined)).toBe(false);
    expect(canShareVideo({ share: () => Promise.resolve() })).toBe(false);
    expect(canShareVideo({ share: () => Promise.resolve(), canShare: (d?: ShareData) => (d?.files?.[0]?.type ?? "") === "video/mp4" })).toBe(true);
    expect(canShareVideo({ share: () => Promise.resolve(), canShare: () => false })).toBe(false);
  });
});
