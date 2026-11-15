import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failure, type ApiClient } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";
import { FLAG_ID, SIGNUP_ID, seedOnlineSignup } from "../../test/signup.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** The desktop table; the same rows are also rendered as a phone list, which jsdom doesn't hide. */
const table = async () => within(await screen.findByRole("table", { name: "Possible duplicate patients" }));

describe("Possible duplicates", () => {
  it("lists the sign-up beside the patient it matches", async () => {
    renderPortal("/patients/duplicates", { as: PEOPLE.farah, backend: fakeApi(seedOnlineSignup) });
    const row = (await (await table()).findByText("Test Signup")).closest("tr");
    if (row === null) throw new Error("expected a table row");
    expect(within(row).getByText("SD-901")).toBeTruthy();
    expect(within(row).getByText("Same phone number")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Same person: merge" })).toBeTruthy();
  });

  it("asks before merging, then merges the sign-up into the existing patient", async () => {
    const user = userEvent.setup();
    const merge = vi.fn<(id: string, into: string) => void>();
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      mergePatient: (id, body, options) => {
        merge(id, body.into_patient_id);
        return client.mergePatient(id, body, options);
      },
    });
    renderPortal("/patients/duplicates", { as: PEOPLE.farah, backend: fakeApi(seedOnlineSignup), wrap });
    await user.click(await (await table()).findByRole("button", { name: "Same person: merge" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge these records?" });
    expect(merge).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/can't be undone/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => {
      expect(merge).toHaveBeenCalledTimes(1);
    });
    expect(merge.mock.calls[0]?.[0]).toBe(SIGNUP_ID);
    expect(merge.mock.calls[0]?.[1]).not.toBe(SIGNUP_ID);
    expect(await screen.findByText("No possible duplicates")).toBeTruthy();
  });

  it("does nothing when the merge is cancelled", async () => {
    const user = userEvent.setup();
    renderPortal("/patients/duplicates", { as: PEOPLE.farah, backend: fakeApi(seedOnlineSignup) });
    await user.click(await (await table()).findByRole("button", { name: "Same person: merge" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge these records?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect((await table()).getByText("Test Signup")).toBeTruthy();
  });

  it("shows the API's message when the merge is refused", async () => {
    const user = userEvent.setup();
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      mergePatient: () => Promise.resolve(failure({ code: "conflict", status: 409, message: "That record already has clinical data." })),
    });
    renderPortal("/patients/duplicates", { as: PEOPLE.farah, backend: fakeApi(seedOnlineSignup), wrap });
    await user.click(await (await table()).findByRole("button", { name: "Same person: merge" }));
    const dialog = await screen.findByRole("dialog", { name: "Merge these records?" });
    await user.click(within(dialog).getByRole("button", { name: "Merge" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("That record already has clinical data.");
  });

  it("removes the row when they are different people", async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn<(id: string) => void>();
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      dismissPatientDuplicate: (id, options) => {
        dismiss(id);
        return client.dismissPatientDuplicate(id, options);
      },
    });
    renderPortal("/patients/duplicates", { as: PEOPLE.farah, backend: fakeApi(seedOnlineSignup), wrap });
    await user.click(await (await table()).findByRole("button", { name: "Different people" }));
    expect(await screen.findByText("No possible duplicates")).toBeTruthy();
    expect(dismiss).toHaveBeenCalledWith(FLAG_ID);
  });

  it("says so when there are none", async () => {
    renderPortal("/patients/duplicates", { as: PEOPLE.farah });
    expect(await screen.findByText("No possible duplicates")).toBeTruthy();
  });

  it("shows an error with a retry when the list can't load", async () => {
    const wrap = (client: ApiClient): ApiClient => ({
      ...client,
      listPatientDuplicates: () => Promise.resolve(failure({ code: "internal", status: 500, message: "The server is busy." })),
    });
    renderPortal("/patients/duplicates", { as: PEOPLE.farah, wrap });
    expect(await screen.findByText("Couldn't load possible duplicates")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });
});

describe("Patients directory chip", () => {
  it("counts the possible duplicates and links to the list", async () => {
    renderPortal("/patients", { as: PEOPLE.farah, backend: fakeApi(seedOnlineSignup) });
    const chip = await screen.findByRole("link", { name: "1 possible duplicate" });
    expect(chip.getAttribute("href")).toBe("/patients/duplicates");
  });

  it("is absent when there are none", async () => {
    renderPortal("/patients", { as: PEOPLE.farah });
    await screen.findByRole("heading", { name: "Patients" });
    expect(screen.queryByRole("link", { name: /possible duplicate/ })).toBeNull();
  });
});
