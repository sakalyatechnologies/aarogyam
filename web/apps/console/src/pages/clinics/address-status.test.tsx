import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderConsole } from "../../test/render-console.js";

/** The table row holding `cell`. */
function rowOf(cell: HTMLElement | undefined): HTMLElement {
  const row = cell?.closest("tr");
  if (row == null) {
    throw new Error("not in a table row");
  }
  return row;
}

function firstOf(items: HTMLElement[]): HTMLElement {
  const [first] = items;
  if (first === undefined) {
    throw new Error("nothing found");
  }
  return first;
}

describe("Clinic address status", () => {
  it("shows a clinic just created as address pending, in the list and on its page", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    await user.type(screen.getByLabelText(/owner's email/i), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText(/is being set up for its owner/)).toBeTruthy();

    await user.click(screen.getByRole("link", { name: /^Clinics$/ }));
    const table = await screen.findByRole("table", { name: "Clinics" });
    const row = rowOf(await within(table).findByRole("link", { name: "Asha Dental Care" }));
    expect(within(row).getByText("Address pending")).toBeTruthy();
    // Ready addresses are the normal case and show no chip in the list.
    const sunrise = rowOf(within(table).getAllByRole("link", { name: "Sunrise Dental" })[0]);
    expect(within(sunrise).queryByText(/^Address /)).toBeNull();

    await user.click(within(table).getByRole("link", { name: "Asha Dental Care" }));
    const addresses = await screen.findByRole("list", { name: "Clinic addresses" });
    expect(within(addresses).getByText("asha-dental-care.localtest.me")).toBeTruthy();
    expect(within(addresses).getByText("Address pending")).toBeTruthy();
    expect(within(addresses).getByText(/usually within two minutes/)).toBeTruthy();
  });

  it("shows a ready address on the clinic's page", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics");
    const table = await screen.findByRole("table", { name: "Clinics" });
    await user.click(firstOf(await within(table).findAllByRole("link", { name: "Sunrise Dental" })));
    const addresses = await screen.findByRole("list", { name: "Clinic addresses" });
    expect(within(addresses).getByText("Address ready")).toBeTruthy();
  });

  it("shows a failed address with its reason and how to retry", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics", {
      override: (client) => ({
        ...client,
        getClinicDetail: async (id, options) => {
          const result = await client.getClinicDetail(id, options);
          return result.ok ? { ok: true, value: { ...result.value, address_status: "failed", address_error: "cloudflare answered 403 (code 10000)" } } : result;
        },
      }),
    });
    const table = await screen.findByRole("table", { name: "Clinics" });
    await user.click(firstOf(await within(table).findAllByRole("link", { name: "Sunrise Dental" })));
    const addresses = await screen.findByRole("list", { name: "Clinic addresses" });
    expect(within(addresses).getByText("Address failed")).toBeTruthy();
    expect(within(addresses).getByText("Last attempt: cloudflare answered 403 (code 10000)")).toBeTruthy();
    expect(within(addresses).getByText(/scripts\/provision-hosts\.sh/)).toBeTruthy();
  });
});

describe("Address status polling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls the clinic list every 10 seconds while a clinic address is pending", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConsole("/clinics/new");
    await user.type(await screen.findByLabelText(/clinic name/i), "Asha Dental Care");
    await user.type(screen.getByLabelText(/owner's email/i), "asha@example.com");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText(/is being set up for its owner/)).toBeTruthy();

    await user.click(screen.getByRole("link", { name: /^Clinics$/ }));
    const table = await screen.findByRole("table", { name: "Clinics" });

    // The new clinic appears with Address pending.
    expect(within(table).getByText("Address pending")).toBeTruthy();

    // After 10 s the query refetches but the fake backend still returns pending; polling continues.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(within(table).getByText("Address pending")).toBeTruthy();
  });

  it("stops polling the clinic detail once the address is ready", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderConsole("/clinics", {
      override: (client) => {
        let calls = 0;
        const orig = client.getClinicDetail.bind(client);
        return {
          ...client,
          getClinicDetail: async (id, options) => {
            calls += 1;
            const result = await orig(id, options);
            if (!result.ok) return result;
            // First call: pending. Second call onward: ready.
            return calls === 1
              ? { ok: true as const, value: { ...result.value, address_status: "pending" } }
              : { ok: true as const, value: { ...result.value, address_status: "ready" } };
          },
        };
      },
    });
    const table = await screen.findByRole("table", { name: "Clinics" });
    await user.click(firstOf(await within(table).findAllByRole("link", { name: "Sunrise Dental" })));
    expect(await screen.findByText("Address pending")).toBeTruthy();

    // Advance 10 s: polling should refetch and flip to ready.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await screen.findByText("Address ready")).toBeTruthy();
    expect(screen.queryByText("Address pending")).toBeNull();
  });
});
