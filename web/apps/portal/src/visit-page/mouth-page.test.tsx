import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import { BAND_BYTES, STORY_BYTES, lazyBudget, type Chunk } from "../../scripts/size-budget.mjs";
import { parseChart } from "./chart.js";
import { parseVisit } from "./public-client.js";
import { VisitPage } from "./visit-page.js";

const TOKEN = "m".repeat(43);
const VISIT = {
  clinic_name: "Demo Dental",
  patient_name: "Aarav Demo",
  visit_number: "V-4",
  visited_on: "2026-11-20",
  treatments: [{ name: "Root canal, sitting 4", tooth: 21 }],
  expires_at: "2026-12-20T10:00:00Z",
  chief_complaint: "Pain in the upper front tooth",
  plan: [{ id: "p1", source: "plan", name: "Filling", tooth: 55, estimate_paise: 150_000 }],
  aftercare: [{ key: "root_canal", title: "Between sittings", steps: ["Brush gently around 21 twice a day."], call_if: "Call us if it swells." }],
  chart: fixture.snapshot,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve() {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const body = url.endsWith("/visit") ? VISIT : { resource: "visit", state: "active", clinic_name: "Demo Dental", expires_at: VISIT.expires_at };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }));
}

describe("the visit page's mouth view (§1.4)", () => {
  it("reads the chart by hand and drops a malformed one", () => {
    const chart = parseChart(fixture.snapshot);
    expect(chart?.dentition).toBe("mixed");
    expect(chart?.teeth.find((t) => t.tooth === 21)?.treatments?.[0]?.steps).toHaveLength(4);
    expect(chart?.positions.find((p) => p.tooth === 11)?.other).toEqual({ tooth: 51, finding: "missing" });
    expect(parseChart({ dentition: "adult", positions: "nope" })).toBeUndefined();
    expect(parseVisit({ ...VISIT, chart: { teeth: [] } })?.chart).toBeUndefined();
    expect(parseVisit(VISIT)?.chart?.next_visit).toBe("2026-11-26");
  });

  it("puts the mouth view first, then Why you came, Done today, What we found, the plan and care; rows open that tooth", async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const user = userEvent.setup();
    serve();
    render(<VisitPage token={TOKEN} />);
    await user.type(await screen.findByLabelText("PIN"), "123456");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("heading", { name: "Aarav's teeth" })).toBeTruthy();
    const order = [...document.querySelectorAll("main > *")].map((el) => el.getAttribute("aria-label") ?? el.className);
    expect(order.slice(1, 7)).toEqual(["vp-hero-mouth vp-reveal", "Why you came", "Done today", "What we found", "Your plan", "Care at home"]);
    const found = within(screen.getByRole("region", { name: "What we found" }));
    expect(found.getByText("Decay into the tooth")).toBeTruthy();
    await user.click(found.getByRole("button", { name: /Decay into the tooth/ }));
    expect(screen.getByRole("heading", { name: "Decay into the tooth found today" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to all teeth" }));
    await user.click(within(screen.getByRole("region", { name: "Done today" })).getByRole("button", { name: /Root canal/ }));
    expect(screen.getByRole("heading", { name: "Root canal treatment" })).toBeTruthy();
    // care at home: the 6-12 band (a parent helps), as stills under reduced motion
    const care = within(screen.getByRole("region", { name: "Care at home" }));
    expect(care.getByText("How to brush, 6 to 12. Help Aarav brush.")).toBeTruthy();
    expect(care.getByText("A parent helps")).toBeTruthy();
    expect(await care.findAllByRole("figure", {}, { timeout: 3000 })).toHaveLength(3);
  });
});

describe("the lazy size budget (§1.4, DT6)", () => {
  const manifest: Record<string, Chunk> = {
    "shared.html": { file: "assets/shared.js", imports: ["_react.js"], dynamicImports: ["band.ts", "teeth3d.ts"] },
    "_react.js": { file: "assets/react.js" },
    "band.ts": { file: "assets/general_6_12.js", src: "src/mouth-art/gen/brushing/general_6_12.ts", isDynamicEntry: true },
    "teeth3d.ts": { file: "assets/index-3d.js", src: "src/real-teeth-3d/index.ts", isDynamicEntry: true, imports: ["_three.js", "_react.js"] },
    "_three.js": { file: "assets/three.js" },
  };
  const sizes = (band: number, three: number) => (file: string) => ({ "assets/general_6_12.js": band, "assets/three.js": three, "assets/index-3d.js": 10_000 })[file] ?? 1000;

  it("passes within budget and counts the 3D chunk with what only it loads", () => {
    const result = lazyBudget({ manifest, entry: "shared.html", gz: sizes(6 * 1024, 120_000), preloaded: ["/assets/shared.js"] });
    expect(result.failures).toEqual([]);
    expect(result.story).toBe(130_000);
  });

  it("fails a 9 KB band chunk, a story over 180 KB and a preloaded lazy chunk", () => {
    expect(lazyBudget({ manifest, entry: "shared.html", gz: sizes(9 * 1024, 1), preloaded: [] }).failures[0]).toMatch(/brushing-general_6_12 is 9.0 KB gzipped, over 8 KB/);
    expect(lazyBudget({ manifest, entry: "shared.html", gz: sizes(1, STORY_BYTES), preloaded: [] }).failures[0]).toMatch(/3D story/);
    expect(lazyBudget({ manifest, entry: "shared.html", gz: sizes(1, 1), preloaded: ["/assets/three.js", "/assets/index-3d.js"] }).failures).toEqual(["assets/index-3d.js is lazy but shared.html preloads it"]);
    expect(BAND_BYTES).toBe(8 * 1024);
  });
});
