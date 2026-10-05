import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LetterheadDocument, LetterheadTemplate } from "@aarogyam/api-client";

import { LETTERHEAD_TEMPLATES, LetterheadSheet } from "./letterhead.js";
import { LetterheadPreview } from "./letterhead-preview.js";
import { plainLetterhead } from "./sample.js";

const SHOW_ALL = { logo: true, doctors: true, registration: true, address: true, phone: true, email: true, timings: true, gstin: true };

function documentWith(overrides: Partial<LetterheadDocument["letterhead"]> = {}, extra: Partial<LetterheadDocument> = {}): LetterheadDocument {
  return {
    clinic: {
      name: "Sunrise Dental",
      legal_name: "Sunrise Dental LLP",
      gstin: "27AAPFU0939F1ZV",
      address: { line1: "12 MG Road", city: "Pune", state: "Maharashtra", pincode: "411001" },
      phone: "+912026123456",
    },
    brand: "#136650",
    letterhead: {
      mode: "template",
      template: "classic",
      show: SHOW_ALL,
      local_name: "सनराइज़ डेंटल",
      footer: "Open Mon to Sat, 9 to 7",
      email: "care@sunrise.test",
      timings: "Mon to Sat 9 am to 7 pm",
      doctor_ids: [],
      has_image: false,
      has_logo: false,
      ...overrides,
    },
    doctors: [
      { name: "Dr Asha Rao", qualifications: "BDS, MDS Orthodontics", registration_number: "A-12345" },
      { name: "Dr Vikram Rao", qualifications: "BDS", registration_number: "A-67890" },
    ],
    expires_at: "2099-01-01T00:00:00Z",
    ...extra,
  };
}

describe("LetterheadSheet designs", () => {
  it.each(LETTERHEAD_TEMPLATES.map((design) => design.id))("%s prints the clinic's details, doctors with qualifications and registration, and the footer", (template: LetterheadTemplate) => {
    render(<LetterheadSheet document={documentWith({ template })}>Body</LetterheadSheet>);
    expect(screen.getByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    expect(screen.getByText("Dr Asha Rao")).toBeTruthy();
    expect(screen.getByText(/BDS, MDS Orthodontics · Reg\. No\. A-12345/)).toBeTruthy();
    expect(screen.getByText("12 MG Road, Pune, Maharashtra, 411001")).toBeTruthy();
    expect(screen.getByText("GSTIN 27AAPFU0939F1ZV")).toBeTruthy();
    expect(screen.getByText("Open Mon to Sat, 9 to 7")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("leaves out what the clinic switched off", () => {
    render(
      <LetterheadSheet
        document={documentWith({ show: { ...SHOW_ALL, doctors: false, gstin: false, phone: false, address: false, email: false, timings: false } })}
      />,
    );
    expect(screen.queryByText("Dr Asha Rao")).toBeNull();
    expect(screen.queryByText(/GSTIN/)).toBeNull();
    expect(screen.queryByText("12 MG Road, Pune, Maharashtra, 411001")).toBeNull();
    expect(screen.queryByText("care@sunrise.test")).toBeNull();
  });

  it("hides registration numbers on their own", () => {
    render(<LetterheadSheet document={documentWith({ show: { ...SHOW_ALL, registration: false } })} />);
    expect(screen.getByText("BDS, MDS Orthodontics")).toBeTruthy();
    expect(screen.queryByText(/Reg\. No\./)).toBeNull();
  });

  it("shows the name in a second script on the bilingual design", () => {
    render(<LetterheadSheet document={documentWith({ template: "bilingual" })} />);
    expect(screen.getByText("सनराइज़ डेंटल")).toBeTruthy();
  });

  it("uses the uploaded letterhead image instead of a design", () => {
    render(<LetterheadSheet document={documentWith({ mode: "upload", has_image: true }, { image_url: "/api/v1/letterhead/images/1/content?token=t" })} />);
    const image = screen.getByRole("img", { name: "Sunrise Dental letterhead" });
    expect(image.getAttribute("src")).toBe("/api/v1/letterhead/images/1/content?token=t");
    expect(screen.queryByRole("heading", { name: "Sunrise Dental" })).toBeNull();
  });

  it("shows the logo when there is one and a monogram when there is not", () => {
    const { unmount } = render(<LetterheadSheet document={documentWith({}, { logo_url: "/logo.png" })} />);
    expect(screen.getByRole("img", { name: "Sunrise Dental logo" }).getAttribute("src")).toBe("/logo.png");
    unmount();
    const { container } = render(<LetterheadSheet document={documentWith()} />);
    expect(container.querySelector(".lh-mono")?.textContent).toBe("S");
  });

  it("falls back to the clinic's name alone when no letterhead could be loaded", () => {
    render(<LetterheadSheet document={plainLetterhead("Lotus Dental Care")}>Page</LetterheadSheet>);
    expect(screen.getByRole("heading", { name: "Lotus Dental Care" })).toBeTruthy();
    expect(screen.getByText("Page")).toBeTruthy();
  });

  it("is hidden from assistive technology as a thumbnail", () => {
    const { container } = render(<LetterheadSheet thumbnail document={documentWith()} />);
    expect(container.querySelector("article")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("LetterheadPreview", () => {
  it("shows a sample prescription with made-up people only, under the clinic's own letterhead", () => {
    render(<LetterheadPreview document={documentWith({ template: "modern_band" })} />);
    expect(screen.getByRole("figure", { name: "Letterhead preview" })).toBeTruthy();
    expect(screen.getByText("Sample Patient")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    expect(screen.getByText(/Sample content only/)).toBeTruthy();
  });

  it("adds sample doctors when the clinic has none yet, so a design never previews empty", () => {
    render(<LetterheadPreview document={documentWith({}, { doctors: [] })} />);
    expect(screen.getByText("Dr Asha Rao")).toBeTruthy();
  });
});
