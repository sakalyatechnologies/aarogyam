import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { attachment, type Attachment } from "@aarogyam/api-client";
import type { Fixtures } from "@aarogyam/api-client/fake";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { groupByLabel, parseTooth } from "./file-labels.js";

function withFiles() {
  let path = "";
  const backend = fakeApi((fixtures: Fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
    path = `/patients/${patient?.id ?? ""}`;
    const base = { clinic_id: sunrise?.id ?? "", patient_id: patient?.id ?? "", size_bytes: 2048, sha256: "0".repeat(64), url: "blob:x" };
    fixtures.attachments.push(
      { ...base, id: "f1", kind: "xray", mime_type: "application/pdf", label: "OPG", created_at: "2026-10-01T05:00:00Z" },
      { ...base, id: "f2", kind: "photo", mime_type: "application/pdf", label: "Intraoral – upper", tooth: 36, created_at: "2026-10-02T05:00:00Z" },
      { ...base, id: "f3", kind: "document", mime_type: "application/pdf", label: "OPG", created_at: "2026-10-03T05:00:00Z" },
    );
  });
  return { path, backend };
}

describe("Patient 360 files", () => {
  it("groups files by label", async () => {
    const user = userEvent.setup();
    const { path, backend } = withFiles();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Files" }));
    const opg = await screen.findByRole("list", { name: "OPG" });
    expect(within(opg).getAllByRole("listitem")).toHaveLength(2);
    const upper = screen.getByRole("list", { name: "Intraoral – upper" });
    expect(within(upper).getByText(/Tooth 36/)).toBeTruthy();
  });

  it("uploads with a label and a tooth, and shows the file under that label", async () => {
    const user = userEvent.setup();
    const { path, backend } = withFiles();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Files" }));
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("File"), new File([new Uint8Array([1, 2, 3])], "scan.pdf", { type: "application/pdf" }));
    await user.selectOptions(within(dialog).getByLabelText("Label"), "Consent");
    await user.type(within(dialog).getByLabelText("Tooth (optional)"), "46");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    const consent = await screen.findByRole("list", { name: "Consent" });
    expect(within(consent).getByText(/Tooth 46/)).toBeTruthy();
  });

  it("refuses a tooth that is not an FDI number", async () => {
    const user = userEvent.setup();
    const { path, backend } = withFiles();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Files" }));
    await user.click(await screen.findByRole("button", { name: "Upload" }));
    const dialog = await screen.findByRole("dialog");
    await user.upload(within(dialog).getByLabelText("File"), new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    await user.type(within(dialog).getByLabelText("Tooth (optional)"), "99");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/FDI/);
  });

  it("shows a tooth's files in the chart's side panel", async () => {
    const user = userEvent.setup();
    const { path, backend } = withFiles();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Chart" }));
    await user.click(await screen.findByRole("button", { name: /^Tooth 36,/ }));
    const files = await screen.findByRole("list", { name: "Files of tooth 36" });
    expect(within(files).getByText("Intraoral – upper")).toBeTruthy();
  });
});

describe("file labels", () => {
  it("orders presets first, custom next, unlabelled last", () => {
    const file = (id: string, label: string | null): Attachment =>
      attachment.parse({
      id,
      label,
      kind: "photo",
      mime_type: "image/jpeg",
      size_bytes: 1,
      sha256: "0",
      created_at: "2026-10-01T05:00:00Z",
    });
    const groups = groupByLabel([file("a", null), file("b", "Zeta"), file("c", "Consent"), file("d", "OPG")]);
    expect(groups.map((g) => g.label)).toEqual(["OPG", "Consent", "Zeta", "Unlabelled"]);
  });

  it("accepts FDI tooth numbers only", () => {
    expect([parseTooth("11"), parseTooth("48"), parseTooth("85"), parseTooth("49"), parseTooth("99"), parseTooth("x")]).toEqual([11, 48, 85, undefined, undefined, undefined]);
  });
});
