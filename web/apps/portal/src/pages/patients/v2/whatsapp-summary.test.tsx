import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { visitId, type ApiClient, type VisitId, type VisitStory } from "@aarogyam/api-client";

import { clinic } from "../../../test/clinic-wrapper.js";
import { handoff, videoKit, WhatsAppSummary, type VideoSupport } from "./whatsapp-summary.js";

/** The summary's own API calls; the video adds only `getVisitStory`, never an upload. */
const ALLOWED = new Set(["getMessagePrefs", "previewVisitPatientMessage", "prepareVisitPatientMessage", "handOffVisitPatientMessage", "getVisitStory", "getVisitOffers"]);

let calls: string[];
let renders: { story: VisitStory; signal: AbortSignal }[];
let shared: File[];
let downloaded: File[];
let opened: string[];
let fetchSpy: MockInstance<typeof fetch>;
const original = { ...videoKit };
const originalOpen = handoff.open;

/** Every call the Done screen makes on the API is recorded. */
const recording = (client: ApiClient): ApiClient =>
  new Proxy(client, {
    get(target, key, receiver) {
      if (typeof key === "string") calls.push(key);
      const value: unknown = Reflect.get(target, key, receiver);
      return value;
    },
  });

async function renderDone(sections?: string[]): Promise<VisitId> {
  let visit: string | undefined;
  const { wrapper, api } = await clinic((fixtures) => {
    const past = fixtures.visits.find((v) => v.status === "closed");
    const patient = fixtures.patients.find((p) => p.id === past?.patient_id);
    if (past === undefined || patient === undefined) throw new Error("no closed visit");
    patient.phone ??= "+919876543210";
    visit = past.id;
  }, recording);
  if (sections !== undefined) await api.saveMessagePrefs({ sections });
  const id = visitId.parse(visit);
  calls = [];
  render(<WhatsAppSummary visitId={id} patientName="Aarav" />, { wrapper });
  return id;
}

function device(support: VideoSupport | null) {
  videoKit.support = () => Promise.resolve(support);
  videoKit.render = (story, _path, opts) => {
    renders.push({ story, signal: opts.signal });
    opts.onProgress(0.5);
    return Promise.resolve(new File([new Uint8Array([0, 0, 0, 28])], `${story.visit_number}.mp4`, { type: "video/mp4" }));
  };
  videoKit.share = (file) => {
    shared.push(file);
    return Promise.resolve();
  };
  videoKit.download = (file) => {
    downloaded.push(file);
  };
}

beforeEach(() => {
  calls = [];
  renders = [];
  shared = [];
  downloaded = [];
  opened = [];
  handoff.open = (url) => {
    opened.push(url);
  };
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  cleanup();
  Object.assign(videoKit, original);
  handoff.open = originalOpen;
  // The video never leaves through the network: no fetch, and no API call beyond the summary's own.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(calls.filter((c) => !ALLOWED.has(c))).toEqual([]);
  fetchSpy.mockRestore();
});

describe("the patient's video on the Done screen", () => {
  it("where the share sheet takes files: Video is on, renders after /story, then Share video shares V-1.mp4", async () => {
    const user = userEvent.setup();
    device({ path: "webcodecs", share: true });
    await renderDone();
    const tick = await screen.findByRole("checkbox", { name: "Video" });
    expect(tick).toHaveProperty("checked", true);
    expect(await screen.findByText("Video V-1 · Aarav is ready. It goes after the text.")).toBeTruthy();
    expect(renders).toHaveLength(1);
    expect(renders[0]?.story.visit_number).toBe("V-1");
    expect(JSON.stringify(renders[0]?.story)).not.toMatch(/Aarav|phone/);
    expect(calls).toContain("getVisitStory");
    await user.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    expect(opened[0]).toMatch(/^whatsapp:\/\/send\?phone=\d+&text=/);
    await user.click(await screen.findByRole("button", { name: "Share video" }));
    await waitFor(() => {
      expect(shared).toHaveLength(1);
    });
    expect(shared[0]?.name).toBe("V-1.mp4");
    expect(downloaded).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Download video" })).toBeNull();
  });

  it("where only a download works: Video starts off; ticked, it renders and Download video saves V-1.mp4 with the steps", async () => {
    const user = userEvent.setup();
    device({ path: "mediarecorder", share: false });
    await renderDone();
    const tick = await screen.findByRole("checkbox", { name: "Video" });
    expect(tick).toHaveProperty("checked", false);
    // Off: no /story call and no rendering.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).not.toContain("getVisitStory");
    expect(renders).toHaveLength(0);
    await user.click(tick);
    await screen.findByText(/is ready/);
    await user.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    await user.click(await screen.findByRole("button", { name: "Download video" }));
    expect(downloaded.map((f) => f.name)).toEqual(["V-1.mp4"]);
    expect(screen.getByText(/Drag V-1\.mp4 from your downloads/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy full summary" })).toBeTruthy();
    expect(shared).toHaveLength(0);
  });

  it("where the device can't make the video: no Video tick, no /story call, the text still goes", async () => {
    const user = userEvent.setup();
    device(null);
    await renderDone();
    await screen.findByRole("checkbox", { name: "Care at home" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("checkbox", { name: "Video" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    expect(await screen.findByText(/Summary prepared/)).toBeTruthy();
    expect(calls).not.toContain("getVisitStory");
    expect(renders).toHaveLength(0);
  });

  it("a doctor whose saved defaults leave Video out gets no render; unticking Video cancels one under way", async () => {
    const user = userEvent.setup();
    device({ path: "webcodecs", share: true });
    videoKit.render = (story, _path, opts) => {
      renders.push({ story, signal: opts.signal });
      return new Promise<File>(() => undefined);
    };
    await renderDone(["done", "care"]);
    const tick = await screen.findByRole("checkbox", { name: "Video" });
    expect(tick).toHaveProperty("checked", false);
    await user.click(tick);
    await screen.findByText(/Making the video/);
    await user.click(tick);
    expect(renders[0]?.signal.aborted).toBe(true);
    expect(screen.queryByText(/Making the video/)).toBeNull();
  });
});
