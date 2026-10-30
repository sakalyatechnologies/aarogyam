import { useState } from "react";

import { apiErrorOf } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { useAddInventoryItem } from "./queries.js";

const UNITS = [
  { value: "piece", label: "Piece" },
  { value: "box", label: "Box" },
  { value: "pack", label: "Pack" },
  { value: "ml", label: "Millilitre" },
  { value: "g", label: "Gram" },
] as const;

/** Adds a stock item; receive its first delivery from the item's own panel. */
export function NewItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useAddInventoryItem();
  const toast = useToast();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]["value"]>("piece");
  const [reorder, setReorder] = useState("0");
  const [max, setMax] = useState("");
  const [maxError, setMaxError] = useState<string>();
  const [error, setError] = useState<string>();

  const close = () => {
    onClose();
    setName("");
    setCategory("");
    setUnit("piece");
    setReorder("0");
    setMax("");
    setMaxError(undefined);
    setError(undefined);
  };

  const submit = () => {
    setError(undefined);
    setMaxError(undefined);
    const level = Number(reorder);
    const top = max.trim() === "" ? 0 : Number(max);
    if (name.trim() === "") {
      setError("Enter the item's name.");
      return;
    }
    if (!Number.isInteger(level) || level < 0) {
      setError("The reorder level must be a whole number, zero or more.");
      return;
    }
    if (!Number.isInteger(top) || top < 0) {
      setMaxError("A whole number, or 0 for none.");
      return;
    }
    add.mutate(
      { name: name.trim(), category: category.trim() === "" ? null : category.trim(), unit, reorder_level: level, ...(top > 0 ? { max_level: top } : {}) },
      {
        onSuccess: (item) => {
          toast.show({ title: `${item.name} added`, tone: "success" });
          close();
        },
        onError: (thrown) => {
          const failure = apiErrorOf(thrown);
          if (failure?.field === "max_level") {
            setMaxError(failure.message);
          } else {
            setError(failure?.message ?? "Couldn't add this item. Please try again.");
          }
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="New item"
      description="A material or medicine the clinic keeps in stock."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={add.isPending} onClick={submit}>
            {add.isPending ? "Adding…" : "Add item"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <TextInput
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Category" hint="Lower case, such as restorative or disposables">
          <TextInput
            value={category}
            onChange={(event) => {
              setCategory(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Unit" required>
          <Select options={UNITS} value={unit} onValueChange={setUnit} />
        </Field>
        <Field label="Reorder level" hint="At or below this the item shows as low" required>
          <TextInput
            inputMode="numeric"
            value={reorder}
            onChange={(event) => {
              setReorder(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Maximum level" hint="Optional. Reorder tops up to this; it can't be below the reorder level" {...(maxError === undefined ? {} : { error: maxError })}>
          <TextInput
            inputMode="numeric"
            value={max}
            onChange={(event) => {
              setMax(event.currentTarget.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
