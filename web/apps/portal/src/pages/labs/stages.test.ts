import { describe, expect, it } from "vitest";

import { nextStage, parseTeeth, planMove, reminderText, stageIndex, telLink, waLink } from "./stages.js";

const at = (status: Parameters<typeof stageIndex>[0]["status"], pipeline_stage: Parameters<typeof stageIndex>[0]["pipeline_stage"], stage: string | null = null) => ({ status, pipeline_stage, stage });

describe("the five-step tracker", () => {
  it("puts each pipeline stage on its step, and reads Trial and Final from the stage text while at the lab", () => {
    expect(stageIndex(at("draft", "to_send"))).toBe(0);
    expect(stageIndex(at("sent", "sent"))).toBe(1);
    expect(stageIndex(at("in_progress", "in_progress", "Production"))).toBe(1);
    expect(stageIndex(at("in_progress", "in_progress", "Trial fit"))).toBe(2);
    expect(stageIndex(at("in_progress", "in_progress", "Final glaze"))).toBe(3);
    expect(stageIndex(at("received", "ready_to_fit"))).toBe(3);
    expect(stageIndex(at("fitted", "fitted"))).toBe(4);
    expect(stageIndex(at("cancelled", "cancelled"))).toBe(-1);
  });

  it("plans the calls that reach a step, only forwards", () => {
    expect(planMove(at("draft", "to_send"), 2)).toEqual([
      { kind: "status", status: "sent" },
      { kind: "status", status: "in_progress", stage: "Trial" },
    ]);
    expect(planMove(at("draft", "to_send"), 1)).toEqual([
      { kind: "status", status: "sent" },
      { kind: "status", status: "in_progress", stage: "Production" },
    ]);
    expect(planMove(at("sent", "sent"), 1)).toEqual([]);
    expect(planMove(at("sent", "sent"), 2)).toEqual([{ kind: "status", status: "in_progress", stage: "Trial" }]);
    expect(planMove(at("in_progress", "in_progress", "Trial"), 3)).toEqual([{ kind: "stage", stage: "Final" }]);
    expect(planMove(at("in_progress", "in_progress", "Trial"), 4)).toEqual([
      { kind: "status", status: "received", stage: "Final" },
      { kind: "status", status: "fitted", stage: "Delivered" },
    ]);
    expect(planMove(at("received", "ready_to_fit"), 4)).toEqual([{ kind: "status", status: "fitted", stage: "Delivered" }]);
    expect(planMove(at("in_progress", "in_progress", "Final"), 2)).toEqual([]);
    expect(planMove(at("cancelled", "cancelled"), 3)).toEqual([]);
    expect(planMove(at("fitted", "fitted"), 4)).toEqual([]);
  });

  it("offers the next step, or none when finished or cancelled", () => {
    expect(nextStage(at("draft", "to_send"))?.label).toBe("Production");
    expect(nextStage(at("received", "ready_to_fit"))?.label).toBe("Delivered");
    expect(nextStage(at("fitted", "fitted"))).toBeNull();
    expect(nextStage(at("cancelled", "cancelled"))).toBeNull();
  });
});

describe("teeth, links and reminder text", () => {
  it("reads tooth numbers", () => {
    expect(parseTeeth("")).toEqual([]);
    expect(parseTeeth("36, 37 46")).toEqual([36, 37, 46]);
    expect(parseTeeth("9")).toBeNull();
    expect(parseTeeth("tooth")).toBeNull();
  });

  it("builds tel and WhatsApp links from a formatted number", () => {
    expect(telLink("+91 98765 00101")).toBe("tel:+919876500101");
    expect(waLink("+91 98765 00101", "Hi there")).toBe("https://wa.me/919876500101?text=Hi%20there");
  });

  it("names the work, teeth, shade and due date but never the patient", () => {
    const text = reminderText(
      {
        number: "LAB-12",
        contact_name: "Rahul",
        due_on: "2026-10-08",
        items: [{ id: "i", line_no: 1, work_type: "PFM crown", teeth: [46], shade: "B2", material: null, qty: 1 }],
      },
      "Sunrise Dental",
    );
    expect(text).toBe("Hi Rahul, reminder from Sunrise Dental: order LAB-12 - PFM crown (tooth 46, shade B2), due 2026-10-08. Please confirm dispatch.");
  });
});
