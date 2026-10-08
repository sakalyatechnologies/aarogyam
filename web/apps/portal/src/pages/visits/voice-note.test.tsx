import { act, fireEvent, screen } from "@testing-library/react";
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

  it("offers Record voice on a draft note only to people who can write notes, and nothing in the top bar", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const { backend, path } = patientPath();
    renderPortal(path, { as: PEOPLE.asha, backend });
    expect(screen.queryByRole("button", { name: "Voice note" })).toBeNull();
    await user.click(await screen.findByRole("tab", { name: "Visits" }));
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.click(await screen.findByRole("button", { name: "New note" }));
    expect(await screen.findByRole("button", { name: "Record voice" })).toBeTruthy();
  });

  it("says plainly when the browser cannot dictate, and keeps only the recording", async () => {
    installVoiceDoubles();
    Reflect.deleteProperty(window, "SpeechRecognition");
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
    const user = userEvent.setup();
    const { backend, path } = patientPath();
    renderPortal(path, { as: PEOPLE.asha, backend });
    await user.click(await screen.findByRole("tab", { name: "Visits" }));
    await user.click(await screen.findByRole("button", { name: "Start visit" }));
    await user.click(await screen.findByRole("button", { name: "New note" }));
    await user.click(await screen.findByRole("button", { name: "Record voice" }));
    expect(await screen.findByText(/Live dictation isn't available in this browser/)).toBeTruthy();
  });
});
