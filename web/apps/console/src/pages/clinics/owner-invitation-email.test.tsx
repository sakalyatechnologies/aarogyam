import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ApiClient, OwnerInvitationDelivery } from "@aarogyam/api-client";

import { renderConsole } from "../../test/render-console.js";

async function openSunrise(user: ReturnType<typeof userEvent.setup>) {
  const table = await screen.findByRole("table", { name: "Clinics" });
  const [link] = await within(table).findAllByRole("link", { name: "Sunrise Dental" });
  if (link === undefined) {
    throw new Error("no Sunrise Dental");
  }
  await user.click(link);
}

/** A console client whose clinic has no joined owner and whose email delivery is `delivery`. */
function withDelivery(delivery: () => ReturnType<ApiClient["getOwnerInvitationDelivery"]>) {
  return (client: ApiClient): ApiClient => ({
    ...client,
    getClinicDetail: async (id, options) => {
      const result = await client.getClinicDetail(id, options);
      return result.ok ? { ok: true, value: { ...result.value, members: result.value.members.filter((m) => m.role_key !== "owner") } } : result;
    },
    getOwnerInvitationDelivery: () => delivery(),
  });
}

const ok = (value: OwnerInvitationDelivery) => Promise.resolve({ ok: true, value } as const);

describe("Owner invitation email status", () => {
  it("shows a failure with its reason, provider, attempts and times", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics", {
      override: withDelivery(() =>
        ok({ status: "failed", provider: "resend", attempts: 5, last_error: "resend answered 422: invalid to address", queued_at: "2026-11-01T09:00:00Z" }),
      ),
    });
    await openSunrise(user);
    const panel = await screen.findByRole("region", { name: "Owner invitation email" });
    expect(await within(panel).findByText("Failed")).toBeTruthy();
    expect(within(panel).getByText("resend")).toBeTruthy();
    expect(within(panel).getByText("5")).toBeTruthy();
    expect(within(panel).getByText("resend answered 422: invalid to address")).toBeTruthy();
    expect(within(panel).getByText("Queued")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend invitation" })).toBeTruthy();
  });

  it("says a log-only send was not sent", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics", {
      override: withDelivery(() => ok({ status: "not_sent", provider: "log", attempts: 1, queued_at: "2026-11-01T09:00:00Z", sent_at: "2026-11-01T09:00:05Z" })),
    });
    await openSunrise(user);
    const panel = await screen.findByRole("region", { name: "Owner invitation email" });
    expect(await within(panel).findByText("Not sent")).toBeTruthy();
    expect(within(panel).getByText(/only written to the log/)).toBeTruthy();
  });

  it("shows not queued yet when nothing was queued", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics", { override: withDelivery(() => ok({ status: "not_queued", attempts: 0 })) });
    await openSunrise(user);
    const panel = await screen.findByRole("region", { name: "Owner invitation email" });
    expect(await within(panel).findByText("Not queued yet")).toBeTruthy();
  });

  it("shows the panel while the status is still loading", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics", { override: withDelivery(() => new Promise(() => undefined)) });
    await openSunrise(user);
    const panel = await screen.findByRole("region", { name: "Owner invitation email" });
    expect(within(panel).queryByText("Failed")).toBeNull();
    expect(within(panel).queryByText("Not queued yet")).toBeNull();
  });

  it("shows an error with a retry when the status can't be loaded", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics", {
      override: withDelivery(() => Promise.resolve({ ok: false, error: { status: 403, code: "forbidden", message: "Not allowed." } } as const)),
    });
    await openSunrise(user);
    const panel = await screen.findByRole("region", { name: "Owner invitation email" });
    expect(await within(panel).findByText("Couldn't load the email status")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });

  it("shows nothing once the owner has joined", async () => {
    const user = userEvent.setup();
    renderConsole("/clinics");
    await openSunrise(user);
    await screen.findByRole("heading", { name: "Sunrise Dental" });
    expect(screen.queryByRole("region", { name: "Owner invitation email" })).toBeNull();
  });
});
