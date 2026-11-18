import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { IMAGE_TAGS } from "./images.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const WAIT = { timeout: 20_000 };

describe("Add image in the visit bar", () => {
  it("appears once the visit is started and opens the upload with OPG preset", async () => {
    const user = userEvent.setup();
    let path = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      const visit = fixtures.visits.find((v) => v.clinic_id === sunrise?.id);
      path = `/patients/${visit?.patient_id ?? ""}`;
    });
    const sent: FormData[] = [];
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      uploadAttachment: (id, form, options) => {
        sent.push(form);
        return client.uploadAttachment(id, form, options);
      },
    });
    renderPortal(path, { as: PEOPLE.asha, backend, wrap });
    const bar = await screen.findByRole("region", { name: "Visit actions" }, WAIT);
    const start = await within(bar).findByRole("button", { name: "Start visit" }, WAIT);
    expect(within(bar).queryByRole("button", { name: "Add image" })).toBeNull();
    await user.click(start);
    await user.click(await within(bar).findByRole("button", { name: "Add image" }, WAIT));

    const dialog = await screen.findByRole("dialog", { name: "Add an X-ray or photo" });
    expect(within(dialog).getByText("OPG")).toBeTruthy();
    await user.upload(within(dialog).getByLabelText("Image"), new File(["png"], "opg.png", { type: "image/png" }));
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.get("label")).toBe("OPG");
    expect(sent[0]?.get("kind")).toBe("xray");
    expect(sent[0]?.get("visit_id")).not.toBeNull();
    expect(IMAGE_TAGS.find((t) => t.value === "OPG")).toEqual({ value: "OPG", label: "OPG", kind: "xray" });
  });
});
