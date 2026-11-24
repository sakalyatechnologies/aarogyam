import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { Renderable, EncodeOptions } from "@aarogyam/app-kit/story-video";

import { fakePresentStudio } from "@aarogyam/api-client/fake";

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

  it("an old call opens the painted map with a style switcher and no Make default", async () => {
    act(() => { api.present(aarav()); });
    await tooth(21);
    expect(screen.getByRole("button", { name: /Painted smile/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make default" })).toBeNull();
  });

  it("style and present open the story cards with the studio options", async () => {
    const present = fakePresentStudio(aarav());
    expect(present.situations.length).toBeGreaterThan(0);
    act(() => { api.present(aarav(), { style: "story", present }); });
    await waitFor(() => { expect(document.querySelector("[data-present-style=story]")).not.toBeNull(); });
  });

  it("present alone defaults to story; a bad present payload falls back to the painted map without crashing", async () => {
    act(() => { api.present(aarav(), { present: fakePresentStudio(aarav()) }); });
    await waitFor(() => { expect(document.querySelector("[data-present-style=story]")).not.toBeNull(); });
    act(() => { api.present(aarav(), { present: { situations: "nope" } }); });
    expect(await tooth(21)).toBeTruthy();
    act(() => { api.present(aarav(), { present: "{not json" }); });
    expect(await tooth(21)).toBeTruthy();
  });

  it("Make default posts the chosen style to the app", async () => {
    act(() => { api.present(aarav()); });
    await tooth(21);
    act(() => { fireEvent.click(screen.getByRole("button", { name: /Painted smile/ })); });
    act(() => { fireEvent.click(screen.getByRole("option", { name: /Story cards/ })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Make default" })); });
    expect(last()).toEqual({ type: "make_default", style: "story" });
  });

  it("opens on the saved tooth colour and Save colour posts the new one to the app", async () => {
    act(() => { api.present(aarav(), { shade: 70, can_save_shade: true }); });
    await tooth(21);
    const slider = screen.getByRole("slider", { name: "Tooth colour" });
    expect(slider).toHaveProperty("value", "70");
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
    act(() => { fireEvent.change(slider, { target: { value: "40" } }); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Save colour" })); });
    expect(last()).toEqual({ type: "save_shade", shade: 40 });
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
  });

  it("offers no Save colour unless the app allows it", async () => {
    act(() => { api.present(aarav(), { shade: 70 }); });
    await tooth(21);
    act(() => { fireEvent.change(screen.getByRole("slider", { name: "Tooth colour" }), { target: { value: "20" } }); });
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
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

describe("phone parity options", () => {
  const xrays = (pins?: { tooth: number; x: number; y: number; label?: string }[]) => [
    { id: "att-1", url: "https://files.test/x1.png", taken_at: "2026-11-02T10:00:00Z", kind: "OPG", ...(pins === undefined ? {} : { pins }) },
    { id: "att-2", url: "https://files.test/x2.png", kind: "X-ray" },
  ];
  const chart = { current: [], history: [], terms: [] };
  const open = async (options: Parameters<AarogyamApi["present"]>[1]) => {
    act(() => { api.present(aarav(), options); });
    await waitFor(() => { expect(document.querySelector(".pm-shell")).not.toBeNull(); });
  };
  /** Moves to the story card with the studio options. */
  const toOptions = async () => {
    await waitFor(() => { expect(document.querySelector("[data-present-style=story]")).not.toBeNull(); });
    for (let i = 0; i < 12 && document.querySelector(".ps-opts") === null; i++) {
      act(() => { fireEvent.keyDown(document.querySelector("[data-present-style=story]") ?? document.body, { key: "ArrowRight" }); });
    }
    await waitFor(() => { expect(document.querySelector(".ps-opts")).not.toBeNull(); });
  };
  const styles = () => { fireEvent.click(screen.getAllByRole("button", { name: /Painted smile|Story cards/ })[0] ?? document.body); };

  it("no X-rays tab, Own X-ray or Chart without the options", async () => {
    await open({});
    expect(screen.queryByRole("tab", { name: "X-rays" })).toBeNull();
    styles();
    expect(screen.queryByRole("option", { name: /Own X-ray/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Chart/ })).toBeNull();
  });

  it("ignores bad xrays, chart and discussions", async () => {
    await open({ xrays: "nope", chart: { current: "x" }, discussions: 5 });
    expect(screen.queryByRole("tab", { name: "X-rays" })).toBeNull();
    styles();
    expect(screen.queryByRole("option", { name: /Chart/ })).toBeNull();
  });

  it("the X-rays tab shows the image and the saved pins; a new pin posts save_pins", async () => {
    await open({ xrays: xrays([{ tooth: 21, x: 0.3, y: 0.4, label: "crack" }]) });
    fireEvent.click(screen.getByRole("tab", { name: "X-rays" }));
    const img = await screen.findByRole("img", { name: /OPG from/ });
    expect(img.getAttribute("src")).toBe("https://files.test/x1.png");
    expect(screen.getByRole("button", { name: "Pin 1: tooth 21, crack" })).toBeTruthy();
    const wrap = screen.getByTestId("pinnable-xray");
    wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(wrap, { clientX: 50, clientY: 25 });
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "11" }));
    expect(last()).toEqual({ type: "save_pins", attachment_id: "att-1", pins: [{ tooth: 21, x: 0.3, y: 0.4, label: "crack" }, { tooth: 11, x: 0.5, y: 0.5 }] });
    fireEvent.click(screen.getByRole("button", { name: "Clear pins" }));
    expect(last()).toEqual({ type: "save_pins", attachment_id: "att-1", pins: [] });
  });

  it("can_write false shows pins but cannot change them", async () => {
    await open({ xrays: xrays([{ tooth: 21, x: 0.3, y: 0.4 }]), can_write: false });
    fireEvent.click(screen.getByRole("tab", { name: "X-rays" }));
    await screen.findByRole("button", { name: "Pin 1: tooth 21" });
    expect(screen.queryByRole("button", { name: "Clear pins" })).toBeNull();
    expect(types()).not.toContain("save_pins");
  });

  it("Own X-ray appears in the switcher and draws the picture", async () => {
    await open({ xrays: xrays() });
    styles();
    fireEvent.click(screen.getByRole("option", { name: /Own X-ray/ }));
    expect(await screen.findByRole("img", { name: /OPG from/ })).toBeTruthy();
    expect(document.querySelector("[data-present-style=xray]")).not.toBeNull();
  });

  it("Chart appears with the chart; its look and dentition buttons show", async () => {
    await open({ chart, look: "classic" });
    styles();
    fireEvent.click(screen.getByRole("option", { name: /Chart/ }));
    await waitFor(() => { expect(document.querySelector(".pc")).not.toBeNull(); });
    expect(document.querySelector(".pc")?.getAttribute("data-look")).toBe("classic");
    fireEvent.click(screen.getByRole("button", { name: "Child" }));
    await waitFor(() => { expect(document.querySelector(".pc")?.getAttribute("data-dentition")).toBe("child"); });
  });

  it("pinning an option, then Save in What we discussed, posts save_discussion", async () => {
    await open({ style: "story", present: fakePresentStudio(aarav()), discussions: [] });
    await toOptions();
    fireEvent.click(screen.getAllByRole("button", { name: /^Pin / })[0] ?? document.body);
    fireEvent.click(await screen.findByRole("button", { name: /^Pinned \(1\)/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "What we discussed" }));
    fireEvent.click(screen.getByLabelText(/Send to the patient/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const m = last();
    expect(m).toMatchObject({ type: "save_discussion", send_to_patient: true });
    expect(m?.type === "save_discussion" && m.options.length).toBe(1);
  });

  it("can_write false saves no discussion", async () => {
    await open({ style: "story", present: fakePresentStudio(aarav()), can_write: false });
    await toOptions();
    fireEvent.click(screen.getAllByRole("button", { name: /^Pin / })[0] ?? document.body);
    fireEvent.click(await screen.findByRole("button", { name: /^Pinned \(1\)/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "What we discussed" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(types()).not.toContain("save_discussion");
    expect(screen.getByText("Your role can't save this.")).toBeTruthy();
  });

  it("shows Prices when the studio carries them, unless can_see_prices is false", async () => {
    const base = fakePresentStudio(aarav());
    const key = base.situations[0]?.options[0]?.key ?? "x";
    const present = { ...base, prices: [{ option_key: key, from_paise: 150000 }] };
    await open({ style: "story", present });
    await toOptions();
    expect(screen.getByRole("button", { name: "Prices" })).toBeTruthy();
    act(() => { api.present(aarav(), { style: "story", present, can_see_prices: false }); });
    await toOptions();
    expect(screen.queryByRole("button", { name: "Prices" })).toBeNull();
  });
});
