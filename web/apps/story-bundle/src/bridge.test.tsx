import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Renderable, EncodeOptions } from "@aarogyam/app-kit/story-video";

import fixture from "../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import { installBridge, type AarogyamApi } from "./bridge.js";
import { BUNDLE_VERSION, detectChannel, post, type PageMessage } from "./channel.js";

// The encoder needs WebCodecs and a canvas: the device path is the smoke test's; here it is mocked.
const encoder = vi.hoisted(() => {
  const state: { path: "webcodecs" | undefined; encode: Mock<(story: Renderable, opts: EncodeOptions) => Promise<Blob>> } = {
    path: "webcodecs",
    encode: vi.fn(),
  };
  return state;
});
vi.mock("@aarogyam/app-kit/story-video", () => ({
  pickVideoPath: () => Promise.resolve(encoder.path),
  encodeStory: encoder.encode,
}));
vi.mock("@aarogyam/app-kit/story-2d", () => ({
  STORY_VERSIONS: [1],
  createStory2d: () => Promise.resolve({ width: 720, height: 1280, fps: 30, duration: 1000, frames: 30, renderAt: () => undefined }),
}));

const aarav = () => structuredClone(fixture.snapshot);
const story = (version = 1) => ({
  story_version: version,
  visit_number: "V-318",
  visited_on: "2026-11-19",
  clinic_name: "Sunrise Dental Care",
  next_visit: "2026-11-26",
  chart: aarav(),
});

let sent: PageMessage[] = [];
let api: AarogyamApi;
const types = () => sent.map((m) => m.type);
const last = () => sent.at(-1);
/** The painted map's dot on a recorded tooth (the map loads from its own chunk). */
const tooth = (fdi: number) => waitFor(() => {
  const el = document.querySelector<SVGGElement>(`.ps-dot[data-tooth="${String(fdi)}"]`);
  if (el === null) throw new Error(`no dot on ${String(fdi)}`);
  return el;
});

beforeEach(() => {
  sent = [];
  encoder.path = "webcodecs";
  encoder.encode.mockReset();
  const container = document.createElement("div");
  document.body.appendChild(container);
  api = installBridge({ container, send: (m) => { sent.push(m); } });
});
afterEach(() => {
  cleanup();
  document.body.textContent = "";
  vi.useRealTimers();
});

describe("channel", () => {
  it("finds the iOS message handler and posts JSON text to it", () => {
    const postMessage = vi.fn();
    const w = { webkit: { messageHandlers: { aarogyam: { postMessage } } } };
    expect(detectChannel(w)).toBe("ios");
    post({ type: "exit" }, w);
    expect(postMessage).toHaveBeenCalledWith('{"type":"exit"}');
  });

  it("finds the Android interface and posts JSON text to it", () => {
    const bridge = { post: vi.fn() };
    const w = { AarogyamBridge: bridge };
    expect(detectChannel(w)).toBe("android");
    post({ type: "add_depth", tooth: 55 }, w);
    expect(bridge.post).toHaveBeenCalledWith('{"type":"add_depth","tooth":55}');
  });

  it("goes nowhere outside the apps", () => {
    expect(detectChannel({})).toBe("none");
    expect(() => { post({ type: "exit" }, {}); }).not.toThrow();
  });
});

describe("window.aarogyam", () => {
  it("installs itself and tells the app it is ready", () => {
    expect(window.aarogyam).toBe(api);
    expect(sent).toEqual([{ type: "ready", bundle_version: BUNDLE_VERSION, story_versions: [1] }]);
  });

  it("present renders the mouth view in Present mode on the painted map, dark when asked", async () => {
    act(() => { api.present(aarav(), { dark: true }); });
    expect(screen.getByRole("dialog", { name: "Present mode" }).dataset["mvTheme"]).toBe("dark");
    expect(document.querySelector(".mv-present")).not.toBeNull();
    expect(await tooth(21)).toBeTruthy();
    expect([...document.querySelectorAll(".ps-dot")].map((d) => Number(d.getAttribute("data-tooth")))).toEqual([55, 21, 65, 75]);
    expect(screen.getByRole("button", { name: "How to brush" })).toBeTruthy();
  });

  it("present takes the JSON as text too, and shows a notice for something that isn't a mouth", () => {
    act(() => { api.present(JSON.stringify(aarav())); });
    expect(screen.getByRole("dialog", { name: "Present mode" }).dataset["mvTheme"]).toBe("light");
    act(() => { api.present({ teeth: "no" }); });
    expect(screen.getByRole("alert").textContent).toContain("couldn't show the teeth");
  });

  it("back goes to all teeth (true), then says it is at the overview (false)", async () => {
    act(() => { api.present(aarav()); });
    expect(api.back()).toBe(false);
    const t21 = await tooth(21);
    act(() => { fireEvent.click(t21); });
    expect(screen.getByRole("heading", { name: "Root canal treatment" })).toBeTruthy();
    let answer = false;
    act(() => { answer = api.back(); });
    expect(answer).toBe(true);
    await waitFor(() => { expect(screen.queryByRole("heading", { name: "Root canal treatment" })).toBeNull(); });
    expect(api.back()).toBe(false);
  });

  it("back closes How to brush first", async () => {
    act(() => { api.present(aarav()); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "How to brush" })); });
    await screen.findByRole("button", { name: "Close" });
    let answer = false;
    act(() => { answer = api.back(); });
    expect(answer).toBe(true);
    await waitFor(() => { expect(screen.queryByRole("button", { name: "Close" })).toBeNull(); });
    expect(api.back()).toBe(false);
  });

  it("hold-to-exit posts exit; a tap does not", () => {
    vi.useFakeTimers();
    act(() => { api.present(aarav()); });
    const exit = screen.getByRole("button", { name: "Exit" });
    fireEvent.pointerDown(exit);
    fireEvent.pointerUp(exit);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(types()).not.toContain("exit");
    fireEvent.pointerDown(exit);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(last()).toEqual({ type: "exit" });
  });

  it("Add depth posts the tooth when caries has no depth", async () => {
    const snap = aarav();
    const t55 = snap.teeth.find((t) => t.tooth === 55);
    if (t55?.details != null) Reflect.deleteProperty(t55.details, "caries_depth");
    act(() => { api.present(snap); });
    const t21 = await tooth(21);
    act(() => { fireEvent.click(t21); });
    expect(screen.queryByRole("button", { name: "Add depth" })).toBeNull();
    act(() => { api.back(); });
    const dot55 = await tooth(55);
    act(() => { fireEvent.click(dot55); });
    fireEvent.click(screen.getByRole("button", { name: "Add depth" }));
    expect(last()).toEqual({ type: "add_depth", tooth: 55 });
  });
});

describe("render", () => {
  const done = () => waitFor(() => { expect(["done", "failed"]).toContain(last()?.type); });

  it("posts progress, 512 KB chunks that add up to the file, then done", async () => {
    const bytes = new Uint8Array(600 * 1024).map((_, i) => i % 251);
    encoder.encode.mockImplementation((_story, opts) => {
      opts.onProgress?.(0.5);
      return Promise.resolve(new Blob([bytes], { type: "video/mp4" }));
    });
    api.render(story());
    await done();
    const chunks = sent.filter((m) => m.type === "chunk");
    expect(types().slice(1)).toEqual(["progress", "progress", "chunk", "chunk", "done"]);
    expect(sent.filter((m) => m.type === "progress").map((m) => m.value)).toEqual([0, 0.5]);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1]);
    const back = chunks.map((c) => Uint8Array.from(atob(c.base64), (ch) => ch.charCodeAt(0)));
    expect(back.map((b) => b.length)).toEqual([512 * 1024, 88 * 1024]);
    expect(back.flatMap((b) => [...b])).toEqual([...bytes]);
    expect(last()).toEqual({ type: "done", bytes: 600 * 1024 });
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("cancel stops a running render with failed cancelled", async () => {
    encoder.encode.mockImplementation((_story, opts) => new Promise((_resolve, reject) => {
      opts.signal?.addEventListener("abort", () => { reject(new DOMException("cancelled", "AbortError")); });
    }));
    api.render(story());
    await waitFor(() => { expect(encoder.encode).toHaveBeenCalled(); });
    api.cancel();
    await done();
    expect(last()).toEqual({ type: "failed", reason: "cancelled" });
    expect(types()).not.toContain("chunk");
  });

  it("a newer render replaces a running one, which goes quiet", async () => {
    let calls = 0;
    encoder.encode.mockImplementation((_story, opts) => {
      calls += 1;
      if (calls === 1) return new Promise((_r, reject) => { opts.signal?.addEventListener("abort", () => { reject(new Error("aborted")); }); });
      return Promise.resolve(new Blob([new Uint8Array(10)]));
    });
    api.render(story());
    await waitFor(() => { expect(calls).toBe(1); });
    api.render(story());
    await done();
    expect(types()).not.toContain("failed");
    expect(last()).toEqual({ type: "done", bytes: 10 });
  });

  it.each([
    ["text that isn't JSON", "{not json", "bad_story"],
    ["a story without its fields", { story_version: 1 }, "bad_story"],
    ["a story version this bundle can't draw", story(99), "unsupported_version"],
  ])("fails on %s", async (_name, input, reason) => {
    api.render(input);
    await done();
    expect(last()).toEqual({ type: "failed", reason });
    expect(encoder.encode).not.toHaveBeenCalled();
  });

  it("fails with no_encoder where the device can't make an MP4", async () => {
    encoder.path = undefined;
    api.render(JSON.stringify(story()));
    await done();
    expect(last()).toEqual({ type: "failed", reason: "no_encoder" });
  });

  it("fails with encode_failed when the encoder throws", async () => {
    encoder.encode.mockRejectedValue(new Error("boom"));
    api.render(story());
    await done();
    expect(last()).toEqual({ type: "failed", reason: "encode_failed" });
  });
});
