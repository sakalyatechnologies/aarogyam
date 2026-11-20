import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Fixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const WAIT = { timeout: 20_000 };
const NOW = "2026-11-10T09:00:00Z";

/**
 * A Sunrise patient whose chart is the test's own: 36 has caries (with a planned root canal), 26 a doctor's Watch with advice,
 * 11 and 21 are sound, 46 is missing, and the other 27 teeth have no record. One OPG and one older X-ray.
 */
function patient() {
  let path = "";
  let phone = "";
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
    const clinicId = sunrise?.id ?? "";
    const patientId = visit?.patient_id ?? "";
    path = `/patients/${patientId}`;
    phone = fixtures.patients.find((p) => p.id === patientId)?.phone ?? "";
    const asha = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha && m.clinic_id === clinicId)?.id ?? "";
    fixtures.chartEntries = fixtures.chartEntries.filter((c) => c.patient_id !== patientId);
    const chart = (tooth: number, finding: Fixtures["chartEntries"][number]["finding"]) => {
      fixtures.chartEntries.push({ id: `xp-${String(tooth)}`, clinic_id: clinicId, patient_id: patientId, tooth, finding, status: "current", recorded_by: asha, effective_at: NOW });
    };
    chart(36, "caries");
    chart(11, "sound");
    chart(21, "sound");
    chart(46, "missing");
    fixtures.toothStatuses = [
      { id: "xp-s26", clinic_id: clinicId, patient_id: patientId, tooth: 26, health: "watch", note: "Early decay", treat_within_months: 3, status: "current", recorded_by: asha, recorded_at: NOW },
    ];
    fixtures.plans = fixtures.plans.filter((p) => p.patient_id !== patientId);
    fixtures.plans.push({
      id: "xp-plan",
      clinic_id: clinicId,
      patient_id: patientId,
      clinician_membership_id: asha,
      title: "Plan",
      status: "proposed",
      created_at: NOW,
      items: [{ id: "xp-item", name: "Root canal treatment", tooth: 36, surfaces: [], phase: 1, estimate_paise: 450000, status: "proposed" }],
    });
    fixtures.attachments = fixtures.attachments.filter((a) => a.patient_id !== patientId);
    const image = (id: string, label: string, created_at: string) => {
      fixtures.attachments.push({ id, clinic_id: clinicId, patient_id: patientId, kind: "xray", mime_type: "image/png", size_bytes: 10, sha256: id, label, created_at, url: `https://files.test/${id}.png` });
    };
    image("a0000000-0000-4000-8000-000000000e01", "X-ray", "2026-11-09T09:00:00Z");
    image("a0000000-0000-4000-8000-000000000e02", "OPG", "2026-10-01T09:00:00Z");
  });
  return { path, phone, backend };
}

async function openExplain(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Show patient" }, WAIT));
  return screen.findByRole("dialog", { name: "Your teeth today" });
}

describe("Explain mode", () => {
  it("shows only the image, the chart and the summary: no phone or balance", async () => {
    const user = userEvent.setup();
    const { path, phone, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const dialog = await openExplain(user);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await within(dialog).findByText("2 healthy · 1 to watch · 1 needs treatment", undefined, WAIT);
    const text = dialog.textContent;
    expect(phone).not.toBe("");
    expect(text).not.toContain(phone.slice(-5));
    expect(text).not.toMatch(/balance|due|owes/i);
    expect(within(dialog).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Image", "Chart", "Summary"]);
  });

  it("counts teeth in plain words, says what is not checked yet, and lists each tooth with its estimate and advice", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const dialog = await openExplain(user);
    await within(dialog).findByText("2 healthy · 1 to watch · 1 needs treatment", undefined, WAIT);
    expect(within(dialog).getByText("27 not checked yet")).toBeTruthy();
    const lines = within(dialog).getByRole("list", { name: "What each tooth needs" });
    const items = within(lines).getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Tooth 36");
    expect(items[0]).toContain("Root canal treatment");
    expect(items[0]).toContain("₹4,500 (estimate; final cost after examination)");
    expect(items[1]).toContain("Tooth 26");
    expect(items[1]).toContain("Early decay");
    expect(items[1]).toContain("Cost: ask the doctor.");
    expect(items[1]).toMatch(/Dr .+ advises treatment within 3 months/);
    expect(within(dialog).getByText(/Total of planned estimates/).textContent).toContain("₹4,500");
    // The OPG comes first, before the newer X-ray.
    expect(within(dialog).getByRole("button", { name: /^OPG,/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("drops a pin on the image, picks the tooth on the number pad, and rings that tooth on the chart", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const dialog = await openExplain(user);
    const stage = await within(dialog).findByTestId("explain-stage", undefined, WAIT);
    const img = await within(stage).findByRole("img", undefined, WAIT);
    // An 800 × 400 stage showing a square image: drawn 400 × 400 from x = 200, with bars at the sides.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains("xp-stage") ? 800 : 0;
      const height = this.classList.contains("xp-stage") ? 400 : 0;
      return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };
    });
    Object.defineProperty(img, "naturalWidth", { value: 1000, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 1000, configurable: true });
    fireEvent.load(img);

    // A tap on the bar is not on the picture.
    fireEvent.click(stage, { clientX: 100, clientY: 200 });
    expect(within(dialog).queryByRole("group", { name: "Pin 1" })).toBeNull();

    fireEvent.click(stage, { clientX: 400, clientY: 200 });
    const picker = within(dialog).getByRole("group", { name: "Pin 1" });
    await user.click(within(picker).getByRole("button", { name: "Quadrant 3" }));
    await user.click(within(picker).getByRole("button", { name: "Tooth 36" }));
    await user.type(within(picker).getByRole("textbox", { name: "Label (optional)" }), "Needs a root canal");
    await user.click(within(picker).getByRole("button", { name: "Place pin" }));

    const pin = within(dialog).getByRole("button", { name: "Pin 1: tooth 36, Needs a root canal" });
    expect(pin.style.left).toBe("400px");
    expect(pin.style.top).toBe("200px");
    const chart = within(dialog).getByRole("region", { name: "Chart" });
    const tooth36 = within(chart).getByRole("button", { name: /^Tooth 36,.*pinned$/ });
    expect(tooth36.hasAttribute("data-marked")).toBe(true);
    expect(tooth36.getAttribute("aria-pressed")).toBe("true");
    expect(pin.getAttribute("aria-pressed")).toBe("true");

    // Selecting another tooth on the chart moves the highlight off the pin; a new pin can take its tooth from the chart.
    await user.click(within(chart).getByRole("button", { name: /^Tooth 11,/ }));
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(stage, { clientX: 300, clientY: 100 });
    const second = within(dialog).getByRole("group", { name: "Pin 2" });
    await user.click(within(chart).getByRole("button", { name: /^Tooth 21,/ }));
    expect(within(second).getByText(/^Tooth 21/)).toBeTruthy();
  });

  it("needs a hold to exit: a tap does nothing, a one-second hold or Esc leaves", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    let dialog = await openExplain(user);
    const exit = within(dialog).getByRole("button", { name: "Exit" });
    await user.click(exit);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(screen.queryByRole("dialog", { name: "Your teeth today" })).not.toBeNull();

    fireEvent.pointerDown(exit);
    expect(exit.hasAttribute("data-holding")).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Your teeth today" })).toBeNull();
    }, { timeout: 3000 });

    dialog = await openExplain(user);
    expect(dialog).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Your teeth today" })).toBeNull();
    });
  });

  it("has no axe violations", async () => {
    const user = userEvent.setup();
    const { path, backend } = patient();
    renderPortal(path, { as: PEOPLE.asha, backend });
    const dialog = await openExplain(user);
    await within(dialog).findByText("2 healthy · 1 to watch · 1 needs treatment", undefined, WAIT);
    const result = await axe.run(dialog, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
});
