import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";

import type { Sortable } from "./use-sortable.js";

/**
 * A column header that sorts when clicked (a real button, so Enter and Space work). It carries
 * `aria-sort` and an arrow. Pass the object `useSortable` returned.
 */
export function SortHeader({ id, sortable, className, children }: { id: string; sortable: Pick<Sortable<never>, "toggle" | "ariaSort">; className?: string; children: ReactNode }) {
  const state = sortable.ariaSort(id);
  const Icon = state === "ascending" ? ArrowUp : state === "descending" ? ArrowDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={state ?? "none"} className={className}>
      <button
        type="button"
        className="mk-sorth"
        onClick={() => {
          sortable.toggle(id);
        }}
      >
        {children}
        <Icon aria-hidden="true" size={12} />
      </button>
    </th>
  );
}
