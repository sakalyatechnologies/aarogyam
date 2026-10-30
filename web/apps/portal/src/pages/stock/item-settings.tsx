import { useState } from "react";

import { apiErrorOf, type InventoryItem } from "@aarogyam/api-client";
import { Button, Field, TextInput, useToast } from "@sakalya/ui";

import { useChangeInventoryItem } from "./queries.js";

/**
 * An item's reorder level and maximum level (New look, `inventory.manage`). The maximum is what "Reorder" tops stock up to;
 * 0 or empty clears it, and the API refuses one below the reorder level, which is shown here against the field.
 */
export function ItemSettings({ item }: { item: InventoryItem }) {
  const change = useChangeInventoryItem(item.id);
  const toast = useToast();
  const [reorder, setReorder] = useState(String(item.reorder_level));
  const [max, setMax] = useState(item.max_level == null ? "" : String(item.max_level));
  const [reorderError, setReorderError] = useState<string>();
  const [maxError, setMaxError] = useState<string>();

  const save = () => {
    setReorderError(undefined);
    setMaxError(undefined);
    const level = Number(reorder);
    const top = max.trim() === "" ? 0 : Number(max);
    if (!Number.isInteger(level) || level < 0) {
      setReorderError("A whole number, zero or more.");
      return;
    }
    if (!Number.isInteger(top) || top < 0) {
      setMaxError("A whole number, or 0 to clear it.");
      return;
    }
    change.mutate(
      { reorder_level: level, max_level: top },
      {
        onSuccess: () => {
          toast.show({ title: "Levels saved", tone: "success" });
        },
        onError: (thrown) => {
          const error = apiErrorOf(thrown);
          const message = error?.message ?? "Couldn't save the levels. Please try again.";
          if (error?.field === "max_level") {
            setMaxError(message);
          } else {
            setReorderError(message);
          }
        },
      },
    );
  };

  return (
    <section aria-label="Levels" className="st2-settings">
      <h3 className="text-sm font-bold text-text">Levels</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Reorder level" hint="At or below this the item shows as low" {...(reorderError === undefined ? {} : { error: reorderError })}>
          <TextInput
            inputMode="numeric"
            value={reorder}
            onChange={(event) => {
              setReorder(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Maximum level" hint="Reorder tops up to this. 0 clears it." {...(maxError === undefined ? {} : { error: maxError })}>
          <TextInput
            inputMode="numeric"
            value={max}
            onChange={(event) => {
              setMax(event.currentTarget.value);
            }}
          />
        </Field>
      </div>
      <div>
        <Button variant="secondary" disabled={change.isPending} onClick={save}>
          {change.isPending ? "Saving…" : "Save levels"}
        </Button>
      </div>
    </section>
  );
}
