import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { practitionerId, type LetterheadDocument, type LetterheadSlot } from "@aarogyam/api-client";

import { LetterheadPicker, applyDraft, imageProblem, toDraft, type DoctorChoice, type LetterheadDraft } from "./letterhead-picker.js";

const SHOW = { logo: true, doctors: true, registration: true, address: true, phone: true, email: true, timings: true, gstin: false };
const ASHA = practitionerId.parse("p-asha");
const VIKRAM = practitionerId.parse("p-vikram");
const CHOICES: DoctorChoice[] = [
  { id: ASHA, name: "Dr Asha Rao", qualifications: "BDS, MDS", registration_number: "A-1" },
  { id: VIKRAM, name: "Dr Vikram Rao", qualifications: "BDS", registration_number: "A-2" },
];
const DOCUMENT: LetterheadDocument = {
  clinic: { name: "Sunrise Dental", address: { city: "Pune" } },
  brand: "#136650",
  letterhead: { mode: "template", template: "classic", show: SHOW, doctor_ids: [], has_image: false, has_logo: false },
  doctors: [],
  expires_at: "2099-01-01T00:00:00Z",
};

function Harness({
  initial,
  onUpload = () => undefined,
  onRemove = () => undefined,
  hasImage = false,
  errors,
  onDraft,
}: {
  initial?: Partial<LetterheadDraft>;
  onUpload?: (slot: LetterheadSlot, file: File) => void;
  onRemove?: (slot: LetterheadSlot) => void;
  hasImage?: boolean;
  errors?: Record<string, string>;
  onDraft?: (draft: LetterheadDraft) => void;
}) {
  const [draft, setDraft] = useState<LetterheadDraft>({ ...toDraft(DOCUMENT.letterhead), ...initial });
  return (
    <LetterheadPicker
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        onDraft?.(next);
      }}
      document={DOCUMENT}
      doctorChoices={CHOICES}
      hasImage={hasImage}
      hasLogo={false}
      onUploadImage={onUpload}
      onRemoveImage={onRemove}
      errors={errors ?? {}}
    />
  );
}

describe("LetterheadPicker", () => {
  it("offers the six designs and marks the chosen one", async () => {
    const user = userEvent.setup();
    let latest: LetterheadDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} />);
    const designs = within(screen.getByRole("radiogroup", { name: "Design" })).getAllByRole("radio");
    expect(designs.map((d) => d.getAttribute("aria-label"))).toEqual([
      "Logo and doctors",
      "Classic centred",
      "Modern band",
      "Minimal line",
      "Two doctors",
      "Bilingual",
    ]);
    expect(screen.getByRole("radio", { name: "Classic centred" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("radio", { name: "Modern band" }));
    expect(screen.getByRole("radio", { name: "Modern band" }).getAttribute("aria-checked")).toBe("true");
    expect(latest?.template).toBe("modern_band");
  });

  it("switches what the design shows, one detail at a time", async () => {
    const user = userEvent.setup();
    let latest: LetterheadDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} />);
    const gstin = screen.getByRole("switch", { name: "Show gstin" });
    expect(gstin.getAttribute("aria-checked")).toBe("false");
    await user.click(gstin);
    await user.click(screen.getByRole("switch", { name: "Show phone" }));
    expect(latest?.show).toMatchObject({ gstin: true, phone: false, address: true });
  });

  it("takes accent, footer, email and timings, and shows the API's message for a bad one", async () => {
    const user = userEvent.setup();
    let latest: LetterheadDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} errors={{ "letterhead.email": "email must be a valid email address" }} />);
    await user.type(screen.getByLabelText("Footer line"), "Call 98765 43210");
    await user.type(screen.getByLabelText("Accent colour"), "#0F766E");
    expect(latest).toMatchObject({ footer: "Call 98765 43210", accent: "#0F766E" });
    expect((await screen.findByRole("alert")).textContent).toBe("email must be a valid email address");
  });

  it("limits the printed doctors to four and keeps the order chosen", async () => {
    const user = userEvent.setup();
    let latest: LetterheadDraft | undefined;
    render(<Harness onDraft={(d) => (latest = d)} />);
    await user.click(screen.getByRole("checkbox", { name: "Dr Vikram Rao" }));
    await user.click(screen.getByRole("checkbox", { name: "Dr Asha Rao" }));
    expect(latest?.doctor_ids).toEqual([VIKRAM, ASHA]);
    await user.click(screen.getByRole("checkbox", { name: "Dr Vikram Rao" }));
    expect(latest?.doctor_ids).toEqual([ASHA]);
  });

  it("uploads a PNG or JPG up to 2 MB and refuses anything else without calling the API", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onUpload = vi.fn();
    render(<Harness initial={{ mode: "upload" }} onUpload={onUpload} />);
    const input = screen.getByLabelText("Letterhead image");

    await user.upload(input, new File(["%PDF-"], "letterhead.pdf", { type: "application/pdf" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a PNG or JPG image.");
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    await user.upload(input, big);
    expect((await screen.findByRole("alert")).textContent).toMatch(/larger than 2 MB/);
    expect(onUpload).not.toHaveBeenCalled();

    await user.upload(input, new File([new Uint8Array([1, 2, 3])], "letterhead.jpg", { type: "image/jpeg" }));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0]?.[0]).toBe("letterhead");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers to remove an uploaded image", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<Harness initial={{ mode: "upload" }} hasImage onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("letterhead");
  });

  it("moves between a generated design and an upload", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText("Letterhead image")).toBeNull();
    await user.click(screen.getByRole("radio", { name: /My own letterhead/ }));
    expect(screen.getByLabelText("Letterhead image")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Design" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: /Generated design/ }));
    expect(screen.getByRole("radiogroup", { name: "Design" })).toBeTruthy();
  });
});

describe("letterhead draft helpers", () => {
  it("checks image files", () => {
    expect(imageProblem({ size: 1000, type: "image/png" })).toBeUndefined();
    expect(imageProblem({ size: 2 * 1024 * 1024, type: "image/jpeg" })).toBeUndefined();
    expect(imageProblem({ size: 2 * 1024 * 1024 + 1, type: "image/png" })).toMatch(/2 MB/);
    expect(imageProblem({ size: 10, type: "image/svg+xml" })).toMatch(/PNG or JPG/);
  });

  it("applies a draft to the document as it would print, choosing doctors the way the API does", () => {
    const draft = { ...toDraft(DOCUMENT.letterhead), footer: "Hello", accent: "", doctor_ids: [VIKRAM] };
    const applied = applyDraft(DOCUMENT, draft, CHOICES);
    expect(applied.letterhead.footer).toBe("Hello");
    expect(applied.letterhead.accent).toBeNull();
    expect(applied.doctors.map((d) => d.name)).toEqual(["Dr Vikram Rao"]);
    expect(applyDraft(DOCUMENT, { ...draft, doctor_ids: [] }, CHOICES).doctors.map((d) => d.name)).toEqual(["Dr Asha Rao", "Dr Vikram Rao"]);
  });
});
