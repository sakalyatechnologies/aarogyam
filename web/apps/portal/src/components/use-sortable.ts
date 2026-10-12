import { useCallback, useMemo, useState } from "react";

// TODO: move to sakalya-web (packages/ui) and fold into DataTable, which sorts but has no "off" step.

export type SortKind = "text" | "number" | "date" | "money";
export type SortDirection = "ascending" | "descending";
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface SortColumn<Row> {
  id: string;
  /** Decides how values compare: text by locale, number and money numerically, date by time. */
  kind: SortKind;
  /** Dates as ISO strings, money as paise or a "₹1,200.50" string. Blank values sort last either way. */
  value: (row: Row) => string | number | null | undefined;
}

const collator = new Intl.Collator("en-IN", { numeric: true, sensitivity: "base" });

/** The number a value stands for, or `undefined` when it is blank or not of that kind. */
function toNumber(kind: Exclude<SortKind, "text">, value: string | number): number | undefined {
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (kind === "date") parsed = Date.parse(value);
  else parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Compares two non-blank values of one kind. */
export function compareByKind(kind: SortKind, a: string | number, b: string | number): number {
  if (kind === "text") return collator.compare(String(a), String(b));
  const x = toNumber(kind, a);
  const y = toNumber(kind, b);
  if (x === undefined || y === undefined) return Number(x === undefined) - Number(y === undefined);
  return x - y;
}

const blank = (value: string | number | null | undefined): value is null | undefined | "" => value === null || value === undefined || value === "";

/** Sorts a copy of the rows; blank values stay last in both directions. */
export function sortByColumn<Row>(rows: readonly Row[], column: SortColumn<Row>, direction: SortDirection): Row[] {
  return rows.toSorted((rowA, rowB) => {
    const a = column.value(rowA);
    const b = column.value(rowB);
    if (blank(a) || blank(b)) return Number(blank(a)) - Number(blank(b));
    const order = compareByKind(column.kind, a, b);
    return direction === "ascending" ? order : -order;
  });
}

export interface Sortable<Row> {
  /** The rows in the current order (the input order when the sort is off). */
  rows: Row[];
  sort: SortState | null;
  /** Ascending, then descending, then off; picking another column starts it at ascending. */
  toggle: (columnId: string) => void;
  /** The `aria-sort` value for a column. */
  ariaSort: (columnId: string) => SortDirection | undefined;
}

export function useSortable<Row>(rows: readonly Row[], columns: readonly SortColumn<Row>[], initial: SortState | null = null): Sortable<Row> {
  const [sort, setSort] = useState<SortState | null>(initial);
  const toggle = useCallback((columnId: string) => {
    setSort((current) => {
      if (current?.columnId !== columnId) return { columnId, direction: "ascending" };
      return current.direction === "ascending" ? { columnId, direction: "descending" } : null;
    });
  }, []);
  const ariaSort = useCallback((columnId: string) => (sort?.columnId === columnId ? sort.direction : undefined), [sort]);
  const sorted = useMemo(() => {
    const column = sort === null ? undefined : columns.find((c) => c.id === sort.columnId);
    return sort === null || column === undefined ? [...rows] : sortByColumn(rows, column, sort.direction);
    // `columns` is rebuilt each render by callers; only the sort and rows decide the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  return { rows: sorted, sort, toggle, ariaSort };
}
