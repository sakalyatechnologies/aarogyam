import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ROLES, fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";

describe("Queue", () => {
  it("seats a waiting token, which moves to In the chair", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const queue = await client.listQueue(undefined);
    if (!queue.ok) throw new Error("expected a queue");
    const waiting = queue.value.items.find((t) => t.status === "waiting");
    if (waiting === undefined) throw new Error("expected a waiting token in the fixture day");
    const initialInChair = queue.value.items.filter((t) => t.status === "in_chair").length;

    renderPortal("/queue", { as: PEOPLE.farah, backend });
    const waitingColumn = await screen.findByRole("heading", { name: /^Waiting/ });
    const card = waitingColumn.closest("section");
    if (card === null) throw new Error("expected the waiting card");
    const row = within(card).getByText(waiting.patient.full_name).closest("li");
    if (row === null) throw new Error("expected the token's row");
    await user.click(within(row).getByRole("button", { name: "Seat" }));

    await screen.findByRole("heading", { name: `In the chair (${String(initialInChair + 1)})` });
  });

  it("issues a walk-in token for a patient found by search", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const patients = await client.listPatients();
    if (!patients.ok) throw new Error("expected patients");
    const target = patients.value.items.find((p) => p.number === "SD-7");
    if (target === undefined) throw new Error("expected SD-7 in fixtures");

    renderPortal("/queue", { as: PEOPLE.farah, backend });
    await user.click(await screen.findByRole("button", { name: "Walk-in" }));
    await user.type(await screen.findByPlaceholderText("Name, clinic number or phone"), "SD-7");
    await user.click(await screen.findByRole("button", { name: new RegExp(target.full_name) }));
    await user.click(screen.getByRole("button", { name: "Issue token" }));
    expect(await screen.findByText(/Issued token #/)).toBeTruthy();
  });

  it("hides the walk-in button and seat/done actions from someone without appointments.write", async () => {
    const backend = fakeApi((fixtures) => {
      const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
      if (membership !== undefined) membership.role = ROLES.assistant;
    });
    renderPortal("/queue", { as: PEOPLE.farah, backend });
    await screen.findByRole("heading", { name: "Queue" });
    expect(screen.queryByRole("button", { name: "Walk-in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Seat" })).toBeNull();
  });
});
