import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, NewLabOrder, Permission } from "@aarogyam/api-client";
import { failure, parseApiError } from "@aarogyam/api-client";
import { ROLES, createFixtures } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

// The page sits behind a fake API with latency, and a busy machine makes drawers and dialogs slow to settle.
vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Farah (front desk) with the role changed. */
function farahAs(role: { key: string; name: string; permissions: readonly Permission[] }) {
  return fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = { ...role, permissions: [...role.permissions] };
  });
}

const rail = () => {
  const found = document.querySelector(".mk2-rail");
  if (!(found instanceof HTMLElement)) throw new Error("expected the rail");
  return within(found);
};

async function card(number: string): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Lab orders" });
  const found = (await within(list).findAllByRole("listitem")).find((li) => li.textContent.includes(number) && li.classList.contains("lb-card"));
  if (found === undefined) throw new Error(`no card for ${number}`);
  return found;
}
/** Chooses a lab in the filter by its name (the option's text has an ampersand, which `selectOptions` can't match). */
async function pickLab(user: ReturnType<typeof userEvent.setup>, name: string) {
  const select = screen.getByRole("combobox", { name: "Lab" });
  const option = within(select).getAllByRole("option").find((o) => o.textContent === name);
  if (!(option instanceof HTMLOptionElement)) throw new Error(`no ${name} option`);
  await user.selectOptions(select, option.value);
}
const drawer = () => screen.getByRole("dialog", { name: /LAB-\d+/ });
const currentStep = (scope: HTMLElement) => scope.querySelector('.lb-track [aria-current="step"]')?.textContent;

describe("Lab work: the work orders tab", () => {
  it("lists open cases with a five-step tracker from the pipeline stage and a late badge", async () => {
    renderPortal("/labs", { as: PEOPLE.asha });
    expect(await screen.findByRole("heading", { level: 1, name: "Lab work" })).toBeTruthy();
    const late = await card("LAB-12");
    expect(within(late).getByText("Late 2 d")).toBeTruthy();
    expect(within(late).getAllByRole("listitem").map((li) => li.textContent)).toEqual(expect.arrayContaining(["Impression", "Production", "Trial", "Final", "Delivered"]));
    expect(currentStep(late)).toContain("Production");
    expect(currentStep(await card("LAB-11"))).toContain("Trial");
    expect(currentStep(await card("LAB-10"))).toContain("Final");
    expect(currentStep(await card("LAB-14"))).toContain("Impression");
    // Delivered and cancelled work is not open.
    const list = screen.getByRole("list", { name: "Lab orders" });
    expect(within(list).queryByText(/LAB-9\b/)).toBeNull();
    expect(within(list).queryByText(/LAB-15\b/)).toBeNull();
  });

  it("filters by overdue, by lab, and to everything", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await card("LAB-12");
    const show = screen.getByRole("group", { name: "Show" });
    await user.click(within(show).getByRole("button", { name: "Overdue" }));
    await waitFor(() => {
      const list = screen.getByRole("list", { name: "Lab orders" });
      expect(within(list).getAllByText(/^LAB-\d+ · /)).toHaveLength(1);
    });
    expect(await card("LAB-12")).toBeTruthy();

    await user.click(within(show).getByRole("button", { name: "Open" }));
    await pickLab(user, "Crown & Bridge Studio");
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Lab orders" })).getAllByText(/^LAB-\d+ · /)).toHaveLength(1);
    });
    expect(await card("LAB-11")).toBeTruthy();

    await pickLab(user, "All labs");
    await user.click(within(show).getByRole("button", { name: "All" }));
    await waitFor(() => {
      expect(within(screen.getByRole("list", { name: "Lab orders" })).getAllByText(/^LAB-\d+ · /)).toHaveLength(7);
    });
  });

  it("says so when nothing is overdue", async () => {
    const user = userEvent.setup();
    const backend = fakeApi((fixtures) => {
      for (const order of fixtures.labs?.orders ?? []) order.due_on = "2027-01-01";
    });
    renderPortal("/labs", { as: PEOPLE.asha, backend });
    await card("LAB-12");
    await user.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Overdue" }));
    expect(await screen.findByText("Nothing is overdue")).toBeTruthy();
  });

  it("shows an empty state and an error state", async () => {
    const empty = fakeApi((fixtures) => {
      if (fixtures.labs !== undefined) fixtures.labs.orders = [];
    });
    renderPortal("/labs", { as: PEOPLE.asha, backend: empty });
    expect(await screen.findByText("No cases at labs right now")).toBeTruthy();
    cleanup();

    const broken = (client: ApiClient): ApiClient => ({
      ...client,
      listLabOrders: () => Promise.resolve(failure(parseApiError(500, { code: "internal", message: "boom" }, undefined))),
    });
    renderPortal("/labs", { as: PEOPLE.asha, wrap: broken });
    expect(await screen.findByText("Couldn't load the lab orders")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeTruthy();
  });

  it("moves a case from the card and shows the new stage", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    const late = await card("LAB-12");
    await user.click(within(late).getByRole("button", { name: "Mark Trial, LAB-12" }));
    await waitFor(async () => {
      expect(currentStep(await card("LAB-12"))).toContain("Trial");
    });
  });
});

describe("Lab work: the order drawer", () => {
  it("shows the items, changes the stage and status, and keeps the history", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await user.click(within(await card("LAB-11")).getByRole("button", { name: "Details of LAB-11" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-11/ });
    const items = within(await within(panel).findByRole("table"));
    expect(items.getByRole("row", { name: /Complete denture.*A3.*Acrylic.*1/ })).toBeTruthy();
    expect(items.getByRole("row", { name: /Night guard/ })).toBeTruthy();

    const moves = within(within(panel).getByRole("group", { name: "Move to" }));
    expect(moves.getByRole("button", { name: "Trial" })).toHaveProperty("disabled", true);
    await user.click(moves.getByRole("button", { name: "Final" }));
    await waitFor(() => {
      expect(currentStep(drawer())).toContain("Final");
    });
    await user.click(within(drawer()).getByRole("button", { name: "Delivered" }));
    await waitFor(() => {
      expect(currentStep(drawer())).toContain("Delivered");
    });
    // Delivering a case at the lab takes two status moves (back, then fitted) after the stage change.
    expect(within(drawer()).getAllByText("Status changed")).toHaveLength(2);
    expect(within(drawer()).getAllByText("Stage changed")).toHaveLength(1);
    // A delivered case can't be cancelled or moved any more.
    expect(within(drawer()).queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("reminds the lab by email, never naming the patient", async () => {
    const user = userEvent.setup();
    const remind = vi.fn();
    renderPortal("/labs", {
      as: PEOPLE.asha,
      wrap: (client) => ({
        ...client,
        remindLab: (id, opts) => {
          remind(id);
          return client.remindLab(id, opts);
        },
      }),
    });
    await user.click(within(await card("LAB-12")).getByRole("button", { name: "Details of LAB-12" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-12/ });
    await user.click(within(panel).getByRole("button", { name: "Remind lab" }));
    const done = await within(panel).findByText(/Reminder emailed to Rahul Deshmukh/);
    expect(done.getAttribute("role")).toBe("status");
    expect(remind).toHaveBeenCalledOnce();
    // The seeded history already holds one reminder.
    expect(within(panel).getAllByText("Reminder sent")).toHaveLength(2);
  });

  it("offers a WhatsApp link when the lab has no email", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await user.click(within(await card("LAB-11")).getByRole("button", { name: "Details of LAB-11" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-11/ });
    await user.click(within(panel).getByRole("button", { name: "Remind lab" }));
    const link = await within(panel).findByRole("link", { name: "Send on WhatsApp instead" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toMatch(/^https:\/\/wa\.me\/919876500103\?text=/);
    const text = decodeURIComponent(href.split("text=")[1] ?? "");
    expect(text).toContain("LAB-11");
    expect(text).toContain("Complete denture");
    // The patient's name never goes to the lab.
    const patient = createFixtures({ now: NOW }).patients.find((p) => p.full_name !== "" && text.includes(p.full_name));
    expect(patient).toBeUndefined();
  });

  it("calls with a tel: link and logs the call, which can set a promised date", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await user.click(within(await card("LAB-12")).getByRole("button", { name: "Details of LAB-12" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-12/ });
    const section = within(within(panel).getByRole("region", { name: "Call and log" }));
    await waitFor(() => {
      expect(section.getByRole("link", { name: /^Call Rahul Deshmukh/ }).getAttribute("href")).toBe("tel:+919876500101");
    });
    await user.selectOptions(section.getByRole("combobox", { name: /What came of it/ }), "Lab promised a date");
    await user.type(section.getByLabelText(/Promised date/), "2026-10-20");
    await user.type(section.getByRole("textbox", { name: "Note" }), "Said Friday");
    await user.click(section.getByRole("button", { name: "Log call" }));
    await waitFor(() => {
      expect(within(panel).getAllByText("Lab contacted")).toHaveLength(2);
    });
    expect(within(panel).getByText("Due date changed")).toBeTruthy();
    await waitFor(() => {
      expect(within(panel).getAllByText(/due 20 Oct 2026/).length).toBeGreaterThan(0);
    });
  });
});

describe("Lab work: sending work", () => {
  it("creates an order with two items", async () => {
    const user = userEvent.setup();
    const create = vi.fn<(input: NewLabOrder) => void>();
    const patient = createFixtures({ now: NOW }).patients.find((p) => p.clinic_id === createFixtures({ now: NOW }).clinics[0]?.id);
    if (patient === undefined) throw new Error("no patient");
    renderPortal("/labs", {
      as: PEOPLE.asha,
      wrap: (client) => ({
        ...client,
        createLabOrder: (input, opts) => {
          create(input);
          return client.createLabOrder(input, opts);
        },
      }),
    });
    await card("LAB-12");
    await user.click(screen.getByRole("button", { name: "Send work" }));
    const dialog = await screen.findByRole("dialog", { name: "Send work to a lab" });
    await user.type(within(dialog).getByRole("textbox", { name: /Find the patient/ }), patient.full_name.split(" ")[0] ?? "a");
    await user.click(await within(dialog).findByRole("button", { name: new RegExp(patient.full_name) }));

    const first = within(within(dialog).getByRole("group", { name: "Item 1" }));
    await user.clear(first.getByRole("combobox", { name: /Work/ }));
    await user.type(first.getByRole("combobox", { name: /Work/ }), "Zirconia crown");
    await user.type(first.getByRole("textbox", { name: /Teeth/ }), "36");
    await user.type(first.getByRole("textbox", { name: "Shade" }), "A2");

    await user.click(within(dialog).getByRole("button", { name: "Add another item" }));
    const second = within(within(dialog).getByRole("group", { name: "Item 2" }));
    await user.clear(second.getByRole("combobox", { name: /Work/ }));
    await user.type(second.getByRole("combobox", { name: /Work/ }), "Night guard");
    await user.click(within(dialog).getByRole("button", { name: "Send to lab" }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce();
    });
    const sent = create.mock.calls[0]?.[0];
    if (sent === undefined) throw new Error("no call");
    expect(sent.items.map((i) => i.work_type)).toEqual(["Zirconia crown", "Night guard"]);
    expect(sent.items[0]).toMatchObject({ teeth: [36], shade: "A2" });
    expect(sent.send).toBe(true);
    expect(sent.due_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const made = await card("LAB-16");
    expect(within(made).getByText(/· 2 items/)).toBeTruthy();
    expect(within(made).getByText(patient.full_name)).toBeTruthy();
  });

  it("asks for the patient first, and removes an item row", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await card("LAB-12");
    await user.click(screen.getByRole("button", { name: "Send work" }));
    const dialog = await screen.findByRole("dialog", { name: "Send work to a lab" });
    await user.click(within(dialog).getByRole("button", { name: "Add another item" }));
    expect(within(dialog).getAllByRole("group", { name: /^Item \d/ })).toHaveLength(2);
    await user.click(within(dialog).getByRole("button", { name: "Remove item 2" }));
    expect(within(dialog).getAllByRole("group", { name: /^Item \d/ })).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Send to lab" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Find the patient first.");
  });
});

describe("Lab work: the labs tab", () => {
  it("lists labs with several contacts each, and adds a lab and a contact", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await card("LAB-12");
    await user.click(screen.getByRole("button", { name: "Labs" }));
    const list = await screen.findByRole("list", { name: "Labs" });
    const precision = within(list).getAllByRole("listitem").find((li) => li.textContent.includes("Precision Dental Lab"));
    if (precision === undefined) throw new Error("no Precision card");
    const people = within(within(precision).getByRole("list", { name: "People at Precision Dental Lab" }));
    expect(people.getByText("Rahul Deshmukh")).toBeTruthy();
    expect(people.getByText("Meena Joshi")).toBeTruthy();
    expect(people.getByRole("link", { name: "Call Meena Joshi" }).getAttribute("href")).toBe("tel:+919876500102");

    await user.click(screen.getByRole("button", { name: "Add lab" }));
    const add = await screen.findByRole("dialog", { name: "Add a lab" });
    await user.click(within(add).getByRole("button", { name: "Save lab" }));
    expect((await within(add).findByRole("alert")).textContent).toBe("Enter the lab's name.");
    await user.type(within(add).getByRole("textbox", { name: /Lab name/ }), "Smile Ceramics");
    await user.click(within(add).getByRole("button", { name: "Save lab" }));
    const added = await waitFor(() => {
      const found = within(screen.getByRole("list", { name: "Labs" })).getAllByRole("listitem").find((li) => li.textContent.includes("Smile Ceramics"));
      if (found === undefined) throw new Error("not yet");
      return found;
    });

    await user.click(within(added).getByRole("button", { name: "Add a contact at Smile Ceramics" }));
    const contact = await screen.findByRole("dialog", { name: "Add a contact at Smile Ceramics" });
    await user.type(within(contact).getByRole("textbox", { name: /^Name/ }), "Priya Nair");
    await user.type(within(contact).getByRole("textbox", { name: "Email" }), "priya@smile.example.com");
    await user.click(within(contact).getByRole("button", { name: "Save contact" }));
    await waitFor(() => {
      expect(within(added).getByText("Priya Nair")).toBeTruthy();
    });
    await user.click(within(added).getByRole("button", { name: "Edit Priya Nair" }));
    const edit = await screen.findByRole("dialog", { name: "Edit Priya Nair" });
    await user.type(within(edit).getByRole("textbox", { name: "Role" }), "Owner");
    await user.click(within(edit).getByRole("button", { name: "Save contact" }));
    await waitFor(() => {
      expect(within(added).getByText(/· Owner/)).toBeTruthy();
    });
  });
});

describe("Lab work: payments", () => {
  it("shows the balance, records a payment and voids one", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await card("LAB-12");
    await user.click(screen.getByRole("button", { name: "Labs" }));
    await user.click(await screen.findByRole("button", { name: "Precision Dental Lab" }));
    const panel = await screen.findByRole("dialog", { name: "Precision Dental Lab" });
    const balance = within(await within(panel).findByLabelText("Balance"));
    // Billed: 4,50,000 + 5,20,000 x2 + 2,80,000 + 6,50,000 paise-rupees as seeded; paid 8,500.
    await waitFor(() => {
      expect(balance.getByText("Still owed").nextElementSibling?.textContent).toMatch(/₹/);
    });
    const owedBefore = balance.getByText("Still owed").nextElementSibling?.textContent;

    await user.type(within(panel).getByRole("textbox", { name: /Amount/ }), "1000");
    // The fake clinic's clock is fixed at 3 Oct 2026; the page's own date is today's.
    fireEvent.change(within(panel).getByLabelText("Paid on"), { target: { value: "2026-10-02" } });
    await user.click(within(panel).getByRole("button", { name: "Record payment" }));
    await waitFor(() => {
      expect(within(panel).getByRole("list", { name: "Payments so far" }).textContent).toContain("₹1,000");
    });
    expect(balance.getByText("Still owed").nextElementSibling?.textContent).not.toBe(owedBefore);

    await user.click(within(panel).getByRole("button", { name: /^Void the payment of ₹1,000/ }));
    await user.type(within(panel).getByRole("textbox", { name: /Reason for voiding/ }), "ab");
    await user.click(within(panel).getByRole("button", { name: "Void payment" }));
    expect((await within(panel).findByRole("alert")).textContent).toMatch(/reason/);
    await user.type(within(panel).getByRole("textbox", { name: /Reason for voiding/ }), "c twice");
    await user.click(within(panel).getByRole("button", { name: "Void payment" }));
    await waitFor(() => {
      expect(within(panel).getAllByText("Void").length).toBeGreaterThan(0);
    });
    expect(balance.getByText("Still owed").nextElementSibling?.textContent).toBe(owedBefore);
  });
});

describe("Lab work: who sees what", () => {
  it("hides costs and payments from a role without finance.view, and sending from one without labs.write", async () => {
    const user = userEvent.setup();
    // A doctor holds labs.read and labs.write, but not finance.view.
    renderPortal("/labs", { as: PEOPLE.farah, backend: farahAs(ROLES.doctor) });
    await user.click(within(await card("LAB-10")).getByRole("button", { name: "Details of LAB-10" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-10/ });
    await within(panel).findByRole("table");
    expect(within(panel).queryByRole("columnheader", { name: "Cost" })).toBeNull();
    expect(panel.textContent).not.toMatch(/₹/);
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(within(await card("LAB-10")).queryByText(/₹/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Labs" }));
    await user.click(await screen.findByRole("button", { name: "Precision Dental Lab" }));
    const lab = await screen.findByRole("dialog", { name: "Precision Dental Lab" });
    expect(within(lab).queryByRole("heading", { name: "Payments" })).toBeNull();
    expect(within(lab).queryByRole("button", { name: "Record payment" })).toBeNull();
    cleanup();

    // The owner sees both.
    renderPortal("/labs", { as: PEOPLE.asha });
    await user.click(within(await card("LAB-10")).getByRole("button", { name: "Details of LAB-10" }));
    const owner = await screen.findByRole("dialog", { name: /LAB-10/ });
    expect(await within(owner).findByRole("columnheader", { name: "Cost" })).toBeTruthy();
    cleanup();

    // finance.view without expenses.write: costs, but no payments.
    const finance = farahAs({ key: "lab_reader", name: "Lab reader", permissions: ["patients.read", "labs.read", "finance.view"] });
    renderPortal("/labs", { as: PEOPLE.farah, backend: finance });
    expect(await card("LAB-10")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send work" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Labs" }));
    await user.click(await screen.findByRole("button", { name: "Precision Dental Lab" }));
    const readOnly = await screen.findByRole("dialog", { name: "Precision Dental Lab" });
    expect(within(readOnly).queryByRole("button", { name: "Record payment" })).toBeNull();
  });

  it("gives a read-only role no way to move, remind or edit", async () => {
    const user = userEvent.setup();
    const readOnly = farahAs({ key: "lab_reader", name: "Lab reader", permissions: ["patients.read", "labs.read"] });
    renderPortal("/labs", { as: PEOPLE.farah, backend: readOnly });
    const late = await card("LAB-12");
    expect(within(late).queryByRole("button", { name: /^Mark / })).toBeNull();
    // Calling is still possible.
    expect(within(late).getByRole("link", { name: /^Call Rahul/ }).getAttribute("href")).toBe("tel:+919876500101");
    await user.click(within(late).getByRole("button", { name: "Details of LAB-12" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-12/ });
    await within(panel).findByRole("table");
    expect(within(panel).queryByRole("button", { name: "Remind lab" })).toBeNull();
    expect(within(panel).queryByRole("group", { name: "Move to" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Log call" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send work" })).toBeNull();
  });

  it("shows Lab work in the rail only to roles with labs.read, and a notice to the rest", async () => {
    for (const [who, backend, sees] of [
      [PEOPLE.asha, fakeApi(), true],
      [PEOPLE.farah, farahAs(ROLES.doctor), true],
      [PEOPLE.farah, fakeApi(), true],
      [PEOPLE.farah, farahAs(ROLES.finance), false],
      [PEOPLE.farah, farahAs(ROLES.consultant), false],
    ] as const) {
      renderPortal("/stock", { as: who, backend });
      await waitFor(() => {
        expect(document.querySelector(".mk2-rail")).not.toBeNull();
      });
      await waitFor(() => {
        const links = rail().queryAllByRole("link", { name: /Lab work/ });
        expect(links.length > 0).toBe(sees);
      });
      cleanup();
    }
    renderPortal("/labs", { as: PEOPLE.farah, backend: farahAs(ROLES.finance) });
    expect(await screen.findByText("Lab work isn't available to your role")).toBeTruthy();
  });

  it("keeps the rail item out of the old look", async () => {
    localStorage.setItem(NEW_LOOK_KEY, "0");
    renderPortal("/today", { as: PEOPLE.asha });
    await screen.findByRole("button", { name: "Collapse sidebar" });
    expect(screen.queryByRole("link", { name: /Lab work/ })).toBeNull();
  });
});

describe("Lab work: accessibility", () => {
  it("has no axe violations on the cases, the order drawer, the labs and a form", async () => {
    const user = userEvent.setup();
    renderPortal("/labs", { as: PEOPLE.asha });
    await card("LAB-12");
    const run = async () => {
      const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
      return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    };
    expect(await run()).toEqual([]);

    await user.click(within(await card("LAB-12")).getByRole("button", { name: "Details of LAB-12" }));
    const panel = await screen.findByRole("dialog", { name: /LAB-12/ });
    await within(panel).findByRole("table");
    expect(await run()).toEqual([]);
    await user.click(within(panel).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Labs" }));
    await screen.findByRole("list", { name: "Labs" });
    expect(await run()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Work orders" }));
    await user.click(await screen.findByRole("button", { name: "Send work" }));
    await screen.findByRole("dialog", { name: "Send work to a lab" });
    expect(await run()).toEqual([]);
  });
});
