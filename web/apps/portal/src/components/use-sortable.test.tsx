import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { SortHeader } from "./sort-header.js";
import { sortByColumn, useSortable, type SortColumn } from "./use-sortable.js";

interface Row {
  name: string;
  n: number | null;
  day: string | null;
  paise: string | number | null;
}

const ROWS: Row[] = [
  { name: "beta", n: 10, day: "2026-03-01", paise: "₹1,200.50" },
  { name: "Alpha", n: 9, day: "2025-12-31", paise: 99 },
  { name: "gamma", n: null, day: null, paise: null },
  { name: "item 10", n: 2, day: "2026-10-05T09:00:00Z", paise: 5_000 },
];

const COLUMNS: SortColumn<Row>[] = [
  { id: "name", kind: "text", value: (r) => r.name },
  { id: "n", kind: "number", value: (r) => r.n },
  { id: "day", kind: "date", value: (r) => r.day },
  { id: "money", kind: "money", value: (r) => r.paise },
];

const names = (rows: readonly Row[]) => rows.map((r) => r.name);
const col = (id: string) => {
  const found = COLUMNS.find((c) => c.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe("sortByColumn", () => {
  it("compares text ignoring case, numbers numerically, dates by time and money by amount", () => {
    expect(names(sortByColumn(ROWS, col("name"), "ascending"))).toEqual(["Alpha", "beta", "gamma", "item 10"]);
    expect(names(sortByColumn(ROWS, col("n"), "ascending"))).toEqual(["item 10", "Alpha", "beta", "gamma"]);
    expect(names(sortByColumn(ROWS, col("day"), "ascending"))).toEqual(["Alpha", "beta", "item 10", "gamma"]);
    expect(names(sortByColumn(ROWS, col("money"), "ascending"))).toEqual(["Alpha", "beta", "item 10", "gamma"]);
  });

  it("keeps blank values last in both directions", () => {
    expect(names(sortByColumn(ROWS, col("n"), "descending"))).toEqual(["beta", "Alpha", "item 10", "gamma"]);
    expect(names(sortByColumn(ROWS, col("day"), "descending")).at(-1)).toBe("gamma");
  });
});

function Demo() {
  const sortable = useSortable(ROWS, COLUMNS);
  return (
    <table>
      <caption>Demo</caption>
      <thead>
        <tr>
          <SortHeader id="name" sortable={sortable}>Name</SortHeader>
          <SortHeader id="n" sortable={sortable}>Count</SortHeader>
        </tr>
      </thead>
      <tbody>
        {sortable.rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{r.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const order = () => screen.getAllByRole("row").slice(1).map((r) => r.firstElementChild?.textContent);
const header = (name: string) => screen.getByRole("columnheader", { name });

describe("useSortable and SortHeader", () => {
  it("cycles ascending, descending, off, and sets aria-sort", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    expect(order()).toEqual(["beta", "Alpha", "gamma", "item 10"]);
    expect(header("Name").getAttribute("aria-sort")).toBe("none");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["Alpha", "beta", "gamma", "item 10"]);
    expect(header("Name").getAttribute("aria-sort")).toBe("ascending");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["item 10", "gamma", "beta", "Alpha"]);
    expect(header("Name").getAttribute("aria-sort")).toBe("descending");

    await user.click(screen.getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["beta", "Alpha", "gamma", "item 10"]);
    expect(header("Name").getAttribute("aria-sort")).toBe("none");
  });

  it("sorts from the keyboard, restarts at ascending on another column, and has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<Demo />);
    await user.click(screen.getByRole("button", { name: "Name" }));
    screen.getByRole("button", { name: "Count" }).focus();
    await user.keyboard("{Enter}");
    expect(order()).toEqual(["item 10", "Alpha", "beta", "gamma"]);
    expect(header("Name").getAttribute("aria-sort")).toBe("none");
    await user.keyboard(" ");
    expect(header("Count").getAttribute("aria-sort")).toBe("descending");
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
