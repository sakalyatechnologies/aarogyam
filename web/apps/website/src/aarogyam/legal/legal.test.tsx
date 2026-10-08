import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LEGAL_DOCS, DRAFT_NOTICE, legalPath } from "./index";
import { LegalIndex, LegalPage } from "./LegalPage";
import { LegalLinks } from "./LegalLinks";
import { DATA_LOCATION, GRIEVANCE_OFFICER } from "./shared";

describe("legal pages", () => {
  it("has the four pages, each at its own path", () => {
    expect(LEGAL_DOCS.map((doc) => legalPath(doc.slug))).toEqual(["/privacy", "/terms", "/dpa", "/patient-notice"]);
  });

  it("marks every page, and the index, as a draft that a lawyer must review", () => {
    expect(DRAFT_NOTICE).toBe("Draft — needs review by a lawyer before launch");
    for (const doc of LEGAL_DOCS) {
      const html = renderToString(<LegalPage doc={doc} />);
      expect(html, doc.slug).toContain(DRAFT_NOTICE);
      expect(html, doc.slug).toContain(doc.title);
    }
    expect(renderToString(<LegalIndex />)).toContain(DRAFT_NOTICE);
  });

  it("highlights every [placeholder] so none ships unnoticed", () => {
    const html = renderToString(<LegalPage doc={LEGAL_DOCS[0]!} />);
    expect(html).toContain('class="legal-ph"');
    expect(html).toContain(GRIEVANCE_OFFICER.email.slice(1, -1));
  });

  it("says where the data lives, in India", () => {
    expect(DATA_LOCATION).toContain("ap-south-1");
    expect(DATA_LOCATION).toContain("asia-south1");
    const privacy = renderToString(<LegalPage doc={LEGAL_DOCS[0]!} />);
    expect(privacy).toContain("ap-south-1");
    expect(privacy).toContain("asia-south1");
    expect(privacy).toContain("Grievance Officer");
  });

  it("names the roles: clinic as fiduciary, Sakalya as processor", () => {
    const dpa = renderToString(<LegalPage doc={LEGAL_DOCS[2]!} />);
    expect(dpa).toContain("Data Fiduciary");
    expect(dpa).toContain("Data Processor");
    expect(dpa).toContain("Sub-processors");
  });

  it("gives the patient notice the same consent choices Aarogyam records", () => {
    const notice = renderToString(<LegalPage doc={LEGAL_DOCS[3]!} />);
    for (const purpose of ["Care and records", "Reminders", "Offers", "Sharing", "Research"]) {
      expect(notice).toContain(purpose);
    }
  });

  it("links every legal page from the sign-in and register footer", () => {
    const html = renderToString(<LegalLinks />);
    for (const doc of LEGAL_DOCS) {
      expect(html).toContain(`href="${legalPath(doc.slug)}"`);
    }
  });
});
