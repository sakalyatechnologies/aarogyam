import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ApiClient, RequestOptions, PatientListOptions } from "@aarogyam/api-client";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

type ListCall = Omit<RequestOptions & PatientListOptions, "signal">;

/** Sunrise with 30 more patients (so there is a second page of 20) and the list calls recorded. */
function setup() {
  const calls: ListCall[] = [];
  const backend = fakeApi((fixtures) => {
    const [seed] = fixtures.patients.filter((p) => p.clinic_id === fixtures.clinics[0]?.id);
    if (seed === undefined) throw new Error("no seed patient");
    for (let i = 0; i < 30; i += 1) {
      fixtures.patients.push({
        ...seed,
        id: `00000000-0000-4000-8000-${String(800 + i).padStart(12, "0")}`,
        number: `SD-${String(800 + i)}`,
        full_name: `Extra ${String.fromCharCode(65 + (i % 26))}${String(i)}`,
      });
    }
  });
  const wrap = (client: ApiClient): ApiClient => ({
    ...client,
    listPatients: (options) => {
      const rest: ListCall & { signal?: AbortSignal | undefined } = { ...options };
      delete rest.signal;
      calls.push(rest);
      return client.listPatients(options);
    },
  });
  return { calls, backend, wrap };
}

const names = () =>
  within(screen.getByRole("table", { name: "Patients" }))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent);

describe("Patients page: server sort and paging", () => {
  it("pages the list by offset and follows has_more", async () => {
    const { calls, backend, wrap } = setup();
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha, backend, wrap });
    await screen.findByRole("table", { name: "Patients" });
    expect(calls[0]).toMatchObject({ offset: 0, limit: 20 });
    expect(calls[0]?.sort).toBeUndefined();
    expect(names()).toHaveLength(20);
    await user.click(await screen.findByRole("button", { name: /Show more/ }));
    await waitFor(() => {
      expect(names().length).toBeGreaterThan(20);
    });
    expect(calls.some((c) => c.offset === 20)).toBe(true);
    expect(new Set(names()).size).toBe(names().length);
  });

  it("asks the server to sort on name, number and last visit, in both directions", async () => {
    const { calls, backend, wrap } = setup();
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha, backend, wrap });
    await screen.findByRole("table", { name: "Patients" });
    await user.click(screen.getByRole("button", { name: "Patient" }));
    await waitFor(() => {
      expect(calls.some((c) => c.sort === "name" && c.dir === "asc" && c.offset === 0)).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "Patient" }).getAttribute("aria-sort")).toBe("ascending");
    });
    const ascending = names();
    await user.click(screen.getByRole("button", { name: "Patient" }));
    await waitFor(() => {
      expect(calls.some((c) => c.sort === "name" && c.dir === "desc")).toBe(true);
    });
    await waitFor(() => {
      expect(names()[0]).not.toBe(ascending[0]);
    });
    await user.click(screen.getByRole("button", { name: "Patient" }));
    await user.click(screen.getByRole("button", { name: "Patient ID" }));
    await waitFor(() => {
      expect(calls.some((c) => c.sort === "number" && c.dir === "asc")).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Last visit" }));
    await waitFor(() => {
      expect(calls.some((c) => c.sort === "last_visit" && c.dir === "asc")).toBe(true);
    });
  });

  it("sorts Next on the loaded rows without a server sort", async () => {
    const { calls, backend, wrap } = setup();
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha, backend, wrap });
    await screen.findByRole("table", { name: "Patients" });
    const before = calls.length;
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("columnheader", { name: "Next" }).getAttribute("aria-sort")).toBe("ascending");
    expect(calls.slice(before).every((c) => c.sort === undefined)).toBe(true);
  });
});

describe("Patients page: a search capped at its best matches", () => {
  /** Sunrise with `count` more patients named "Extra …". */
  function withExtras(count: number) {
    return fakeApi((fixtures) => {
      const [seed] = fixtures.patients.filter((p) => p.clinic_id === fixtures.clinics[0]?.id);
      if (seed === undefined) throw new Error("no seed patient");
      for (let i = 0; i < count; i += 1) {
        fixtures.patients.push({
          ...seed,
          id: `00000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`,
          number: `SD-${String(900 + i)}`,
          full_name: `Extra Person${String(i)}`,
        });
      }
    });
  }

  it("says to narrow the search when it returns the most matches", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha, backend: withExtras(55) });
    await user.type(await screen.findByRole("searchbox", { name: "Search patients" }), "Extra");
    expect(await screen.findByText(/Showing the best 50 matches/)).toBeTruthy();
  });

  it("says nothing when every match fits", async () => {
    const user = userEvent.setup();
    renderPortal("/patients", { as: PEOPLE.asha, backend: withExtras(5) });
    await user.type(await screen.findByRole("searchbox", { name: "Search patients" }), "Extra");
    await waitFor(() => {
      expect(names()).toHaveLength(5);
    });
    expect(screen.queryByText(/Showing the best/)).toBeNull();
  });
});
