import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { FakeRecognition, installVoiceDoubles, removeVoiceDoubles } from "./voice/test-doubles.js";

afterEach(() => {
  removeVoiceDoubles();
});

function patientPath(prepare?: (patientName: string) => void) {
  let path = "";
  let name = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    const patient = fixtures.patients.find((p) => p.clinic_id === sunrise?.id);
    path = `/patients/${patient?.id ?? ""}`;
    name = patient?.full_name ?? "";
    prepare?.(name);
  });
  return { backend, path, name };
}

describe("Voice note in the visit", () => {
  it("dictates into the draft at the cursor, keeps the recording with the note and shows it", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const uploads: FormData[] = [];
    const { backend, path } = patientPath();
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        uploadAttachment: (id, form, options) => {
          uploads.push(form);
          return client.uploadAttachment(id, form, options);
        },
      }),
    });
    await user.click(await screen.findByRole("tab", { name: "Visits" }));
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await screen.findByRole("heading", { name: /^Visit V-/ });
    await user.click(await screen.findByRole("button", { name: "New note" }));

    const subjective = await screen.findByLabelText<HTMLTextAreaElement>("Subjective");
    await user.type(subjective, "Pain chewing");
    subjective.setSelectionRange(4, 4);
    fireEvent.select(subjective);

    await user.click(screen.getByRole("button", { name: "Record voice" }));
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByRole("timer");
    act(() => {
      FakeRecognition.instances[0]?.say("on the lower left", true);
    });
    expect(subjective.value).toBe("Pain on the lower left chewing");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Keep recording" }));

    const list = await screen.findByRole("list", { name: "Recordings" });
    expect(list.textContent).toContain("Voice recording");
    expect(uploads).toHaveLength(1);
    const form = uploads[0];
    expect(form?.get("kind")).toBe("audio");
    expect(form?.get("language")).toBe("en-IN");
    expect(Number(form?.get("duration_seconds"))).toBeGreaterThanOrEqual(1);
    expect(form?.get("note_id")).toBeTruthy();
    expect(form?.get("visit_id")).toBeTruthy();
    // The dictated text was saved before the recording, and the note can be signed as it stands.
    await user.click(screen.getByRole("button", { name: "Sign" }));
    await screen.findByText("signed");
    expect(screen.getByText("Pain on the lower left chewing")).toBeTruthy();
  });

  it("opens the recorder from the top bar after asking which patient", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const { backend, name } = patientPath();
    renderPortal("/", { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("button", { name: "Voice note" }));
    const dialog = await screen.findByRole("dialog", { name: "Voice note: choose the patient" });
    expect(within(dialog).getByText("The note is saved as a draft on this patient's record.")).toBeTruthy();
    await user.type(await screen.findByPlaceholderText("Name, clinic number or phone"), name);
    await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
    await screen.findByRole("heading", { name: /^Visit V-/ });
    await screen.findByRole("region", { name: "Voice recorder" });
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
    // The same button on the open visit goes straight to the recorder.
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Voice recorder" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Voice note" }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Voice recorder" })).toBeTruthy();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is unavailable without clinical.write", async () => {
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      path = `/patients/${fixtures.patients.find((p) => p.clinic_id === sunrise?.id)?.id ?? ""}`;
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = { key: "reader", name: "Reader", permissions: ["patients.read", "clinical.read"] };
    });
    renderPortal(path, { as: PEOPLE.farah, backend });
    const button = await screen.findByRole("button", { name: "Voice note" });
    expect(button).toHaveProperty("disabled", true);
  });
});
