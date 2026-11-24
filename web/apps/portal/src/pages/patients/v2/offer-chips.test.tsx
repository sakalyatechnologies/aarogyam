import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { patientId, unwrap, visitId } from "@aarogyam/api-client";
import { DEFAULT_OFFER_SETTINGS } from "@aarogyam/api-client/fake";

import { clinic } from "../../../test/clinic-wrapper.js";
import { handoff, WhatsAppSummary } from "./whatsapp-summary.js";

afterEach(() => {
  cleanup();
});

async function renderDone(off = false, plan = false) {
  let visit: string | undefined;
  let pid: string | undefined;
  const made = await clinic((fixtures) => {
    const past = fixtures.visits.find((v) => v.status === "closed");
    const patient = fixtures.patients.find((p) => p.id === past?.patient_id);
    if (past === undefined || patient === undefined) throw new Error("no closed visit");
    patient.phone ??= "+919876543210";
    visit = past.id;
    pid = patient.id;
    if (plan) {
      fixtures.plans.push({
        id: "pl_offer", clinic_id: past.clinic_id, patient_id: patient.id, clinician_membership_id: past.clinician_membership_id, title: "Plan", status: "accepted", created_at: "2026-01-01T00:00:00Z",
        items: [
          { id: "pli_crown", name: "Crown", tooth: 21, surfaces: [], phase: 1, estimate_paise: 0, status: "accepted" },
          { id: "pli_done", name: "Filling", tooth: 11, surfaces: [], phase: 1, estimate_paise: 0, status: "done" },
        ],
      });
    }
    if (off) {
      const clinicId = past.clinic_id;
      fixtures.offerSettings = { [clinicId]: { ...DEFAULT_OFFER_SETTINGS, patient_offer: { ...DEFAULT_OFFER_SETTINGS.patient_offer, enabled: false } } };
    }
  });
  const id = visitId.parse(visit);
  render(<WhatsAppSummary visitId={id} patientId={patientId.parse(pid)} patientName="Aarav" />, { wrapper: made.wrapper });
  return { ...made, id };
}

describe("Offer chips on the Done screen", () => {
  it("gives the preset offer in one tap, shows the code with Undo, and Undo revokes it", async () => {
    const user = userEvent.setup();
    const { api, id } = await renderDone();
    await user.click(await screen.findByRole("button", { name: /Offer 10% · 30 days/ }));
    const live = await unwrap(api.getVisitOffers(id));
    expect(live.patient_offer?.value).toBe(1000);
    expect(live.patient_offer?.kind).toBe("percent_bps");
    await screen.findByText(/^✓ [A-Z0-9]{4}-[A-Z0-9]{4}/);
    expect(screen.queryByRole("button", { name: /Offer 10% · 30 days/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Undo offer/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Offer 10% · 30 days/ })).toBeTruthy();
    });
    expect((await unwrap(api.getVisitOffers(id))).patient_offer).toBeUndefined();
  });

  it("gives a referral code in one tap", async () => {
    const user = userEvent.setup();
    const { api, id } = await renderDone();
    await user.click(await screen.findByRole("button", { name: /Referral code/ }));
    await screen.findByText(/^✓ [A-Z0-9]{4}-[A-Z0-9]{4}/);
    expect((await unwrap(api.getVisitOffers(id))).referral?.purpose).toBe("referral");
  });

  it("Edit changes the terms within the caller's limit", async () => {
    const user = userEvent.setup();
    const { api, id } = await renderDone();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const percent = screen.getByLabelText("Percent");
    await user.clear(percent);
    await user.type(percent, "150");
    expect(screen.getByRole("alert").textContent).toContain("Up to 100%");
    expect(screen.getByRole("button", { name: "Give offer" })).toHaveProperty("disabled", true);
    await user.clear(percent);
    await user.type(percent, "15");
    await user.selectOptions(screen.getByLabelText("Valid for"), "60");
    await user.click(screen.getByRole("button", { name: "Give offer" }));
    await waitFor(async () => {
      const offer = (await unwrap(api.getVisitOffers(id))).patient_offer;
      expect(offer?.value).toBe(1500);
    });
  });

  it("aims the offer at an open plan item and sends its id", async () => {
    const user = userEvent.setup();
    const { api } = await renderDone(false, true);
    const spy = vi.spyOn(api, "issueVisitOffers");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const aim = await screen.findByLabelText("For");
    expect([...aim.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["The next treatment", "Crown on 21"]);
    await user.selectOptions(aim, "pli_crown");
    await user.click(screen.getByRole("button", { name: "Give offer" }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ patient_offer: { plan_item_id: "pli_crown" } });
  });

  it("sends no plan item by default", async () => {
    const user = userEvent.setup();
    const { api } = await renderDone(false, true);
    const spy = vi.spyOn(api, "issueVisitOffers");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await screen.findByLabelText("For");
    await user.click(screen.getByRole("button", { name: "Give offer" }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });
    expect(spy.mock.calls[0]?.[1].patient_offer).not.toHaveProperty("plan_item_id");
  });

  it("hides the offer chip when the clinic switched it off, keeps the referral chip", async () => {
    await renderDone(true);
    await screen.findByRole("button", { name: /Referral code/ });
    expect(screen.queryByRole("button", { name: /^🎁 Offer/ })).toBeNull();
  });

  it("Send still prepares the message after an offer is given", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(handoff, "open").mockImplementation(() => undefined);
    await renderDone();
    await user.click(await screen.findByRole("button", { name: /Offer 10% · 30 days/ }));
    await screen.findByText(/^✓ [A-Z0-9]{4}-[A-Z0-9]{4}/);
    await user.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
    await waitFor(() => {
      expect(open).toHaveBeenCalled();
    });
    open.mockRestore();
  });
});
