import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bookingUrl, fullPageUrl, tokenFromPath, VisitPage } from "./visit-page.js";
import { parseVisit } from "./public-client.js";
import { doses, rupees, toothWords } from "./words.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const TOKEN = "v".repeat(43);

const VISIT = {
  clinic_name: "Sunrise Dental",
  patient_name: "Rahul Verma",
  visit_number: "V-318",
  visited_on: "2026-11-19",
  doctor_name: "Dr Asha Rao",
  treatments: [{ name: "Root canal", tooth: 46 }],
  follow_up_on: "2026-11-26",
  booking_path: "/book",
  booking_host: "sunrise.example",
  expires_at: "2026-11-26T10:00:00Z",
  chief_complaint: "Pain on the lower right while chewing",
  plan: [{ id: "p1", source: "procedure", name: "Crown", tooth: 46, estimate_paise: 800_000 }],
  medicines: [{ generic: "Aceclofenac + Paracetamol", strength: "100 mg + 325 mg", frequency: "1-0-1", timing: "after_food", duration_days: 3 }],
  aftercare: [{ key: "root_canal", title: "After your root canal", steps: ["Don't chew on that side until the crown is fitted."], call_if: "Call us if the swelling grows." }],
  clinic_phone: "+919000009000",
  practitioner_id: "0193-prac",
};

type Reply = { status: number; body: unknown };

function serve(replies: Record<string, Reply | Reply[]>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.credentials).toBe("omit");
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const entry = replies[url];
    const reply = Array.isArray(entry) ? entry.shift() : entry;
    if (reply === undefined) return Promise.reject(new Error(`unexpected ${url}`));
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const preview = (resource: string, state = "active"): Reply => ({ status: 200, body: { resource, state, clinic_name: "Sunrise Dental", expires_at: "2026-11-26T10:00:00Z" } });

describe("Visit page (patient link)", () => {
  it("opens with the PIN and shows why they came, what was done, the plan, care and medicines", async () => {
    const user = userEvent.setup();
    const fetchMock = serve({
      [`/api/v1/shared/${TOKEN}`]: preview("visit"),
      [`/api/v1/shared/${TOKEN}/visit`]: [
        { status: 403, body: { error: { code: "wrong_pin", message: "Wrong PIN; 4 tries left." } } },
        { status: 200, body: VISIT },
      ],
    });
    render(<VisitPage token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "Your visit summary" })).toBeTruthy();
    expect(screen.getByText(/Please don't forward it/)).toBeTruthy();
    expect(await axe.run(document.body, AXE).then((r) => r.violations.map((v) => v.id))).toEqual([]);

    await user.type(screen.getByLabelText("PIN"), "111111");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Wrong PIN; 4 tries left.");

    await user.type(screen.getByLabelText("PIN"), "123456");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("heading", { name: "Hi Rahul, here's your visit" })).toBeTruthy();
    expect(screen.getByText("Pain on the lower right while chewing")).toBeTruthy();
    expect(screen.getAllByText(/Lower right first molar/)).toHaveLength(2);
    expect(screen.getByText("₹8,000")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book my next visit" }).getAttribute("href")).toBe("/book?practitioner=0193-prac");
    expect(screen.getByText("After your root canal")).toBeTruthy();
    expect(screen.getByRole("link", { name: "WhatsApp the clinic" }).getAttribute("href")).toBe("https://wa.me/919000009000");
    expect(await axe.run(document.body, AXE).then((r) => r.violations.map((v) => v.id))).toEqual([]);

    const body = fetchMock.mock.calls[2]?.[1]?.body;
    expect(body).toBe(JSON.stringify({ pin: "123456" }));
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === "omit")).toBe(true);
  });

  async function openWith(replies: Record<string, Reply | Reply[]>, visit: unknown = VISIT) {
    const user = userEvent.setup();
    const fetchMock = serve({
      [`/api/v1/shared/${TOKEN}`]: preview("visit"),
      [`/api/v1/shared/${TOKEN}/visit`]: { status: 200, body: visit },
      ...replies,
    });
    render(<VisitPage token={TOKEN} />);
    await user.type(await screen.findByLabelText("PIN"), "123456");
    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("heading", { name: "Hi Rahul, here's your visit" });
    return { user, fetchMock };
  }

  const ANSWER = `/api/v1/shared/${TOKEN}/plan-response`;

  it("answers the plan with the PIN it was opened with: go ahead", async () => {
    const { user, fetchMock } = await openWith({ [ANSWER]: { status: 200, body: { choice: "go_ahead", responded_at: "2026-11-19T10:00:00Z" } } });
    await user.click(screen.getByRole("button", { name: "Yes, I want to go ahead" }));
    expect(await screen.findByText("Thanks, the clinic will call you to book.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I have a question" })).toBeNull();
    const call = fetchMock.mock.calls.find(([url]) => url === ANSWER);
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.body).toBe(JSON.stringify({ pin: "123456", choice: "go_ahead" }));
    expect(await axe.run(document.body, AXE).then((r) => r.violations.map((v) => v.id))).toEqual([]);
  });

  it("a question offers WhatsApp straight away, and failures are said plainly", async () => {
    const { user } = await openWith({
      [ANSWER]: [
        { status: 410, body: { error: { code: "expired", message: "x" } } },
        { status: 200, body: { choice: "question", responded_at: "2026-11-19T10:00:00Z" } },
      ],
    });
    await user.click(screen.getByRole("button", { name: "I have a question" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This link has expired. Please ask the clinic for a new one.");
    await user.click(screen.getByRole("button", { name: "I have a question" }));
    expect(await screen.findByText("Thanks, the clinic will get back to you.")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "WhatsApp the clinic" });
    expect(links.length).toBe(2);
    expect(links[0]?.getAttribute("href")).toBe("https://wa.me/919000009000");
  });

  it("shows no answer buttons without a plan", async () => {
    await openWith({}, { ...VISIT, plan: [] });
    expect(screen.queryByRole("button", { name: "Yes, I want to go ahead" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I have a question" })).toBeNull();
  });

  it("hands other links to the portal page and explains expired or unknown links", async () => {
    serve({ [`/api/v1/shared/${TOKEN}`]: preview("prescription") });
    const leave = vi.fn();
    render(<VisitPage token={TOKEN} leave={leave} />);
    await vi.waitFor(() => {
      expect(leave).toHaveBeenCalledWith(fullPageUrl(TOKEN));
    });
    cleanup();

    serve({ [`/api/v1/shared/${TOKEN}`]: preview("visit", "expired") });
    render(<VisitPage token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeTruthy();
    cleanup();

    serve({ [`/api/v1/shared/${TOKEN}`]: { status: 404, body: { error: { code: "not_found", message: "x" } } } });
    render(<VisitPage token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: "We couldn't find this link" })).toBeTruthy();
  });

  it("reads an older server's summary without the new fields", () => {
    const old: Record<string, unknown> = { ...VISIT };
    for (const key of ["chief_complaint", "plan", "medicines", "aftercare", "clinic_phone", "practitioner_id"]) {
      Reflect.deleteProperty(old, key);
    }
    const visit = parseVisit(old);
    expect(visit?.plan).toEqual([]);
    expect(visit?.chiefComplaint).toBeNull();
    expect(visit === undefined ? undefined : bookingUrl(visit)).toBe("/book");
    expect(parseVisit({ clinic_name: "x" })).toBeUndefined();
  });

  it("speaks teeth, doses and rupees in plain words", () => {
    expect(toothWords(46)).toBe("Lower right first molar (back tooth)");
    expect(toothWords(11)).toBe("Upper right front tooth");
    expect(toothWords(38)).toBe("Lower left wisdom tooth");
    expect(toothWords(85)).toBe("Lower right second milk molar");
    expect(toothWords(19)).toBeUndefined();
    expect(toothWords(null)).toBeUndefined();
    expect(doses("1-0-1")).toEqual([1, 0, 1]);
    expect(doses("SOS")).toBeUndefined();
    expect(rupees(150_000)).toBe("₹1,500");
    expect(tokenFromPath(`/shared/${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromPath("/book")).toBe("");
  });
  it("shows the offers and shares the referral text without a link that carries the code", async () => {
    const shareText = "I go to Sunrise Dental. Use my code K7QM-4XRD for 10% off on your first visit. Book here: https://sunrise.example/book";
    const visit = {
      ...VISIT,
      offer: [{ code: "ABCD-2345", purpose: "patient_offer", kind: "percent_bps", value: 1000, words: "10% off (up to ₹2,000)", target: "the next treatment", valid_to: "2026-12-31" }],
      referral: { code: "K7QM-4XRD", kind: "percent_bps", value: 1000, words: "10% off", valid_to: "2026-12-31", share_text: shareText },
    };
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { share });
    const { user } = await openWith({}, visit);
    expect(screen.getByText("10% off (up to ₹2,000)")).toBeTruthy();
    expect(screen.getByText("ABCD-2345")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Share with a friend" }));
    expect(share).toHaveBeenCalledWith({ text: shareText });
    expect(document.body.innerHTML).not.toContain("wa.me/?text");
  });

  it("copies the message when the device has no share sheet", async () => {
    const shareText = "Use my code K7QM-4XRD at Sunrise Dental";
    const visit = { ...VISIT, referral: { code: "K7QM-4XRD", words: "10% off", valid_to: "2026-12-31", share_text: shareText } };
    const { user } = await openWith({}, visit);
    await user.click(screen.getByRole("button", { name: "Copy message" }));
    expect(await navigator.clipboard.readText()).toBe(shareText);
    expect(await screen.findByText("Message copied. Paste it to your friend.")).toBeTruthy();
  });
});
