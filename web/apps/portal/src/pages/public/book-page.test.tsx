import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";

import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

const SUNRISE = "sunrise.localtest.me";
const BOOK = `/book?clinic=${SUNRISE}`;

function staff(backend: ReturnType<typeof fakeApi>) {
  return backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
}

describe("Book an appointment (public)", () => {
  it("takes a patient from a free slot, through email verification, to a request", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal(BOOK, { backend });

    expect(await screen.findByRole("heading", { name: "Sunrise Dental" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Mon 5 Oct" }));
    const times = await screen.findByRole("group", { name: "Free times" });
    await user.click(within(times).getByRole("button", { name: "9:00 am" }));

    // Not signed in: the next step is verifying an email, not asking for details.
    expect(screen.queryByLabelText(/full name/i)).toBeNull();
    await user.type(await screen.findByLabelText(/your email/i), "priya@example.test");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await user.type(await screen.findByLabelText(/full name/i), "Priya Nair");
    await user.type(screen.getByLabelText(/^phone/i), "98765 43210");
    await user.type(screen.getByLabelText(/reason for the visit/i), "Toothache");
    await user.click(screen.getByRole("button", { name: "Request appointment" }));

    expect(await screen.findByText("Request received")).toBeTruthy();
    expect(screen.getByText(/will confirm your appointment/i)).toBeTruthy();

    // The front desk sees it as requested, from the website.
    const calendar = await staff(backend).listAppointments({ from: "2026-10-05", to: "2026-10-05" });
    if (!calendar.ok) throw new Error("expected the calendar");
    const requested = calendar.value.items.find((a) => a.patient.full_name === "Priya Nair");
    expect(requested?.status).toBe("requested");
    expect(requested?.source).toBe("website");
  });

  it("drops a slot that was taken meanwhile and says so", async () => {
    const user = userEvent.setup();
    const backend = fakeApi();
    renderPortal(BOOK, { backend });
    await user.click(await screen.findByRole("button", { name: "Mon 5 Oct" }));
    const times = await screen.findByRole("group", { name: "Free times" });
    await user.click(within(times).getByRole("button", { name: "9:00 am" }));
    await user.type(await screen.findByLabelText(/your email/i), "late@example.test");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText(/full name/i), "Late Comer");
    await user.type(screen.getByLabelText(/^phone/i), "9876543211");

    // Someone else takes 9:00 with the first doctor first.
    const doctors = await backend.client({ host: SUNRISE, now: () => NOW }).getBookingOptions();
    if (!doctors.ok) throw new Error("expected options");
    const rival = backend.client({
      host: SUNRISE,
      getToken: () => fakeTokenFor({ id: "d0d0d0d0-0000-4000-8000-000000000009", email: "rival@example.test" }),
      now: () => NOW,
    });
    const slots = await rival.getAvailability("2026-10-05", doctors.value.doctors[0]?.id ?? "");
    if (!slots.ok) throw new Error("expected slots");
    const taken = await rival.createOnlineBooking({
      starts_at: slots.value.slots[0] ?? "",
      practitioner_id: doctors.value.doctors[0]?.id ?? "",
      full_name: "Rival",
      phone: "9876543212",
    });
    expect(taken.ok).toBe(true);

    await user.click(screen.getByRole("button", { name: "Request appointment" }));
    expect(await screen.findByText(/someone just took that time/i)).toBeTruthy();
    expect(screen.queryByLabelText(/full name/i)).toBeNull();
  });

  it("says online booking isn't available when the clinic has switched it off", async () => {
    const backend = fakeApi((fixtures) => {
      const clinic = fixtures.clinics.find((c) => c.host === SUNRISE);
      if (clinic !== undefined) clinic.online_booking = { enabled: false };
    });
    renderPortal(BOOK, { backend });
    expect(await screen.findByText("Online booking isn't available")).toBeTruthy();
  });

  it("is a not-available page on a host that isn't a clinic", async () => {
    renderPortal("/book?clinic=nowhere.localtest.me");
    expect(await screen.findByText("Online booking isn't available")).toBeTruthy();
  });
});
