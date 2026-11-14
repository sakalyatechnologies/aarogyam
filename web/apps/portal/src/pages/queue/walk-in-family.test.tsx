import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, WalkInRequest } from "@aarogyam/api-client";
import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function registeredWithPhone() {
  const backend = fakeApi();
  const client = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  const patients = await client.listPatients();
  if (!patients.ok) throw new Error("expected patients");
  const target = patients.value.items.find((p) => typeof p.phone === "string" && p.phone.startsWith("+91"));
  if (target === undefined || typeof target.phone !== "string") throw new Error("expected a patient with a phone");
  return { backend, target, mobile: target.phone.slice(3) };
}

async function openWizard(user: ReturnType<typeof userEvent.setup>, mobile: string) {
  await user.click(await screen.findByRole("button", { name: "Add to queue" }));
  const dialog = await screen.findByRole("dialog", { name: "Add to queue" });
  await user.click(within(dialog).getByRole("button", { name: /Register a walk-in/ }));
  const wizard = await screen.findByRole("dialog", { name: "Walk-in (no booking)" });
  await user.type(within(wizard).getByLabelText(/Mobile number/), mobile);
  return wizard;
}

describe("Walk-in wizard: family member of a registered patient", () => {
  it("sends family_of with the chosen relation and keeps the new-patient fields", async () => {
    const user = userEvent.setup();
    const { backend, target, mobile } = await registeredWithPhone();
    const sent = vi.fn<(input: WalkInRequest) => void>();
    renderPortal("/queue", {
      as: PEOPLE.asha,
      backend,
      wrap: (client: ApiClient) => ({
        ...client,
        registerWalkIn: (input, options) => {
          sent(input);
          return client.registerWalkIn(input, options);
        },
      }),
    });
    const wizard = await openWizard(user, mobile);
    await user.click(await within(wizard).findByRole("button", { name: new RegExp(`Family member of ${target.full_name}`) }));
    // Child is the default; pick Spouse to show the chips drive the request.
    const relation = within(wizard).getByRole("group", { name: "Relation" });
    expect(within(relation).getByRole("button", { name: "Child" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(relation).getByRole("button", { name: "Spouse" }));
    await user.type(within(wizard).getByLabelText(/^Name/), "Meera Test-Relative");
    const result = await axe.run(wizard, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    await user.click(await within(wizard).findByRole("button", { name: "No known allergies" }));
    await user.click(within(wizard).getByRole("button", { name: "Next" }));
    await user.click(within(wizard).getByRole("button", { name: "Add to queue" }));
    expect(await screen.findByText(/Meera Test-Relative: token #/)).toBeTruthy();
    await waitFor(() => {
      expect(sent).toHaveBeenCalledTimes(1);
    });
    const request = sent.mock.calls[0]?.[0];
    expect(request?.family_of).toEqual({ patient_id: target.id, relation: "spouse" });
    expect(request?.patient?.full_name).toBe("Meera Test-Relative");
    expect(request?.patient_id).toBeUndefined();
  });
});
