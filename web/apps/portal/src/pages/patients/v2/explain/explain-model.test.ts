import { describe, expect, it } from "vitest";

import { chartEntryId, type Attachment, type ChartEntry } from "@aarogyam/api-client";

import { containedRect, explainImages, explainSummary, fractionIn, isFdi, type PlanLike } from "./explain-model.js";

describe("the letterbox maths", () => {
  it("fits a wide image into a tall box with bars above and below", () => {
    expect(containedRect({ width: 400, height: 400 }, { width: 2000, height: 1000 })).toEqual({ left: 0, top: 100, width: 400, height: 200 });
  });
  it("fits a tall image into a wide box with bars at the sides", () => {
    expect(containedRect({ width: 800, height: 400 }, { width: 500, height: 1000 })).toEqual({ left: 300, top: 0, width: 200, height: 400 });
  });
  it("fills the box until the image size is known, and is empty for an empty box", () => {
    expect(containedRect({ width: 300, height: 200 }, { width: 0, height: 0 })).toEqual({ left: 0, top: 0, width: 300, height: 200 });
    expect(containedRect({ width: 0, height: 200 }, { width: 10, height: 10 })).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
  it("turns a point into fractions of the drawn image, and ignores the bars", () => {
    const rect = containedRect({ width: 400, height: 400 }, { width: 2000, height: 1000 });
    expect(fractionIn(rect, 100, 150)).toEqual({ x: 0.25, y: 0.25 });
    expect(fractionIn(rect, 100, 50)).toBeUndefined();
    // The same fraction lands on the same spot of the picture after a resize.
    const wider = containedRect({ width: 800, height: 400 }, { width: 2000, height: 1000 });
    expect(wider.left + 0.25 * wider.width).toBe(200);
    expect(wider.top + 0.25 * wider.height).toBe(100);
  });
});

describe("FDI numbers", () => {
  it("accepts 11–48 and the child teeth 51–85 only", () => {
    expect([11, 18, 36, 48, 55, 85].every(isFdi)).toBe(true);
    expect([10, 19, 49, 56, 86, 91, 9].some(isFdi)).toBe(false);
  });
});

const NOW = "2026-11-10T10:00:00Z";
const entry = (tooth: number, finding: ChartEntry["finding"]): ChartEntry => ({
  id: chartEntryId.parse(`e-${String(tooth)}-${finding}`),
  tooth,
  finding,
  status: "current",
  effective_at: NOW,
  canals: [],
  in_progress: false,
});

describe("the summary", () => {
  // 32 adult teeth: 36 caries, 26 a doctor's Watch with advice, 46 missing, 11 sound; the other 28 have no record.
  const current = [entry(36, "caries"), entry(46, "missing"), entry(11, "sound"), entry(21, "filled")];
  const statuses = [{ tooth: 26, health: "watch" as const, note: "Early decay", treat_within_months: 3, recorded_by: "m-1", recorded_at: NOW }];
  const plans: PlanLike[] = [
    {
      status: "proposed",
      clinician: { id: "m-1", name: "Asha Rao" },
      items: [
        { name: "Root canal treatment", tooth: 36, estimate_paise: 450000, status: "proposed" },
        { name: "Scaling", tooth: null, estimate_paise: 80000, status: "accepted" },
        { name: "Crown", tooth: 21, estimate_paise: 0, status: "done" },
      ],
    },
  ];

  it("counts healthy, watch and needs treatment; unassessed teeth are not healthy", () => {
    const summary = explainSummary({ current, statuses, plans, dentition: "adult" });
    expect(summary.counts).toBe("2 healthy · 1 to watch · 1 needs treatment");
    expect(summary.notChecked).toBe("27 not checked yet");
  });

  it("writes one line per tooth to treat or watch, with the plan's name and estimate, the doctor's advice and the total", () => {
    const summary = explainSummary({ current, statuses, plans, dentition: "adult" });
    expect(summary.lines.map((l) => [l.tooth, l.needs, l.cost, l.advice])).toEqual([
      [36, "Root canal treatment", "₹4,500 (estimate; final cost after examination)", undefined],
      [26, "Early decay", "ask the doctor", "Dr Asha Rao advises treatment within 3 months"],
      [undefined, "Scaling", "₹800 (estimate; final cost after examination)", undefined],
    ]);
    expect(summary.totalPaise).toBe(530000);
  });

  it("says needs treatment when there is neither a plan nor a note, and uses the team's name when known", () => {
    const summary = explainSummary({
      current: [entry(17, "fractured")],
      statuses: [{ tooth: 17, health: "needs_treatment", treat_within_months: 1, recorded_by: "m-9", recorded_at: NOW }],
      plans: [],
      dentition: "adult",
      nameOf: (id) => (id === "m-9" ? "Dr. Vikram Shah" : undefined),
    });
    expect(summary.lines[0]).toMatchObject({ tooth: 17, needs: "needs treatment", cost: "ask the doctor", advice: "Dr Vikram Shah advises treatment within 1 month" });
    expect(summary.notChecked).toBe("31 not checked yet");
    expect(summary.totalPaise).toBe(0);
  });
});

describe("the images offered", () => {
  it("puts OPGs first, then newest, and leaves out PDFs and voice notes", () => {
    const file = (id: string, label: string, created_at: string, mime_type = "image/png", kind: Attachment["kind"] = "xray") => ({ id, label, created_at, mime_type, kind });
    const shown = explainImages([
      file("a", "X-ray", "2026-11-09T00:00:00Z"),
      file("b", "OPG", "2026-10-01T00:00:00Z"),
      file("c", "Report", "2026-11-10T00:00:00Z", "application/pdf", "report"),
      file("d", "Intraoral", "2026-11-11T00:00:00Z", "image/jpeg", "photo"),
      file("e", "OPG", "2026-11-01T00:00:00Z"),
    ]);
    expect(shown.map((f) => f.id)).toEqual(["e", "b", "d", "a"]);
  });
});
