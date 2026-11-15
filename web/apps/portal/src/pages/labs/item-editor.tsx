import { Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type LabOrder, type LabOrderItem, type NewLabOrderItem } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, Field, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useAddLabOrderItem, useRemoveLabOrderItem, useUpdateLabOrderItem } from "./queries.js";
import { WORK_TYPES, parseTeeth } from "./stages.js";

/** Fitted, reworked and cancelled orders no longer change; the API answers 409 to item edits. */
export const itemsLocked = (status: LabOrder["status"]): boolean => status === "fitted" || status === "returned_for_rework" || status === "cancelled";

interface Draft {
  work: string;
  teeth: string;
  shade: string;
  material: string;
  qty: string;
  cost: string;
}

const blank: Draft = { work: WORK_TYPES[0], teeth: "", shade: "", material: "", qty: "1", cost: "" };
const draftOf = (item: LabOrderItem): Draft => ({
  work: item.work_type,
  teeth: item.teeth.join(", "),
  shade: item.shade ?? "",
  material: item.material ?? "",
  qty: String(item.qty),
  cost: item.unit_cost_paise == null ? "" : String(item.unit_cost_paise / 100),
});

type Parsed = { ok: true; value: Required<Pick<NewLabOrderItem, "work_type" | "teeth" | "qty">> & { shade: string | null; material: string | null; unitCost: number | null } } | { ok: false; problem: string };

/** The same checks as the new-order form. */
function parse(draft: Draft): Parsed {
  const teeth = parseTeeth(draft.teeth);
  const qty = Number(draft.qty);
  const rupees = draft.cost.trim() === "" ? null : Number(draft.cost);
  if (draft.work.trim() === "") return { ok: false, problem: "Write the kind of work." };
  if (teeth === null) return { ok: false, problem: "Write tooth numbers such as 36 or 36, 37." };
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { ok: false, problem: "Quantity must be a whole number from 1 to 99." };
  if (rupees !== null && (!Number.isFinite(rupees) || rupees < 0)) return { ok: false, problem: "Cost must be an amount in rupees." };
  return {
    ok: true,
    value: {
      work_type: draft.work.trim(),
      teeth,
      qty,
      shade: draft.shade.trim() === "" ? null : draft.shade.trim(),
      material: draft.material.trim() === "" ? null : draft.material.trim(),
      unitCost: rupees === null ? null : Math.round(rupees * 100),
    },
  };
}

function ItemForm({ label, initial, costs, busy, error, submitLabel, onSubmit, onCancel }: {
  label: string;
  initial: Draft;
  costs: boolean;
  busy: boolean;
  error: string | undefined;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (field: keyof Draft) => (event: { currentTarget: { value: string } }) => {
    const { value } = event.currentTarget;
    setDraft((current) => ({ ...current, [field]: value }));
  };
  return (
    <form
      className="lb-form lb-itemform"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="lb-row">
        <Field label="Work" required>
          <TextInput list="lb-work-types-edit" value={draft.work} onChange={set("work")} />
        </Field>
        <Field label="Teeth" hint="Such as 36 or 36, 37">
          <TextInput inputMode="numeric" value={draft.teeth} onChange={set("teeth")} />
        </Field>
        <Field label="Shade">
          <TextInput value={draft.shade} maxLength={20} onChange={set("shade")} />
        </Field>
        <Field label="Material">
          <TextInput value={draft.material} maxLength={80} onChange={set("material")} />
        </Field>
        <Field label="Qty">
          <TextInput inputMode="numeric" value={draft.qty} onChange={set("qty")} />
        </Field>
        {costs ? (
          <Field label="Cost each (₹)">
            <TextInput inputMode="decimal" value={draft.cost} onChange={set("cost")} />
          </Field>
        ) : null}
      </div>
      <datalist id="lb-work-types-edit">
        {WORK_TYPES.map((w) => (
          <option key={w} value={w} />
        ))}
      </datalist>
      {error === undefined ? null : (
        <p role="alert" className="lb-error">
          {error}
        </p>
      )}
      <div className="lb-actions">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * An order's items, each editable inline and removable with a confirm, and "Add item". Needs `labs.write`; a cost needs
 * `finance.view` too. Shown read-only once the order is final. When the API refuses (a 409 after the order moved on
 * elsewhere), its message is shown here.
 */
export function ItemsSection({ order }: { order: LabOrder }) {
  const { can } = useClinic();
  const toast = useToast();
  const add = useAddLabOrderItem();
  const update = useUpdateLabOrderItem();
  const remove = useRemoveLabOrderItem();
  const [editing, setEditing] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const editable = can("labs.write") && !itemsLocked(order.status);
  const costs = can("finance.view") && order.costs_visible;
  const columns = 5 + (costs ? 1 : 0) + (editable ? 1 : 0);

  const fail = (thrown: unknown) => {
    setProblem(apiErrorOf(thrown)?.message ?? "Couldn't change the items. Please try again.");
  };
  const done = (title: string) => {
    setProblem(undefined);
    setEditing(undefined);
    setRemoving(undefined);
    toast.show({ title, tone: "success" });
  };

  const save = (item: LabOrderItem, draft: Draft) => {
    const parsed = parse(draft);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(undefined);
    const { value } = parsed;
    update.mutate(
      {
        itemId: item.id,
        changes: {
          work_type: value.work_type,
          teeth: value.teeth,
          qty: value.qty,
          shade: value.shade,
          material: value.material,
          ...(costs ? { unit_cost_paise: value.unitCost } : {}),
        },
      },
      {
        onSuccess: () => {
          done(`Item ${String(item.line_no)} saved`);
        },
        onError: fail,
      },
    );
  };
  const create = (draft: Draft) => {
    const parsed = parse(draft);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(undefined);
    const { value } = parsed;
    add.mutate(
      {
        orderId: order.id,
        item: {
          work_type: value.work_type,
          teeth: value.teeth,
          qty: value.qty,
          ...(value.shade === null ? {} : { shade: value.shade }),
          ...(value.material === null ? {} : { material: value.material }),
          ...(costs && value.unitCost !== null ? { unit_cost_paise: value.unitCost } : {}),
        },
      },
      {
        onSuccess: () => {
          done("Item added");
        },
        onError: fail,
      },
    );
  };
  const confirmRemove = (item: LabOrderItem) => {
    setProblem(undefined);
    remove.mutate(item.id, {
      onSuccess: () => {
        done(`Item ${String(item.line_no)} removed`);
      },
      onError: fail,
    });
  };

  return (
    <section aria-labelledby="lb-d-items">
      <h3 id="lb-d-items" className="mk-flabel">
        Items
      </h3>
      <table className="lb-table">
        <thead>
          <tr>
            <th scope="col">Work</th>
            <th scope="col">Teeth</th>
            <th scope="col">Shade</th>
            <th scope="col">Material</th>
            <th scope="col">Qty</th>
            {order.costs_visible ? <th scope="col">Cost</th> : null}
            {editable ? (
              <th scope="col">
                <span className="lb-sr">Change</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) =>
            editing === item.id ? (
              <tr key={item.id}>
                <td colSpan={columns}>
                  <ItemForm
                    label={`Edit item ${String(item.line_no)}`}
                    initial={draftOf(item)}
                    costs={costs}
                    busy={update.isPending}
                    error={problem}
                    submitLabel="Save item"
                    onSubmit={(draft) => {
                      save(item, draft);
                    }}
                    onCancel={() => {
                      setEditing(undefined);
                      setProblem(undefined);
                    }}
                  />
                </td>
              </tr>
            ) : (
              <tr key={item.id}>
                <th scope="row">{item.work_type}</th>
                <td>{item.teeth.length === 0 ? "—" : item.teeth.join(", ")}</td>
                <td>{item.shade ?? "—"}</td>
                <td>{item.material ?? "—"}</td>
                <td>{item.qty}</td>
                {order.costs_visible ? <td>{item.unit_cost_paise == null ? "—" : formatRupees(item.unit_cost_paise * item.qty)}</td> : null}
                {editable ? (
                  <td>
                    {removing === item.id ? (
                      <div className="lb-actions" role="group" aria-label={`Remove ${item.work_type}?`}>
                        <span className="lb-sub">Remove this item?</span>
                        <Button variant="secondary" disabled={remove.isPending} onClick={() => { confirmRemove(item); }}>
                          {remove.isPending ? "Removing…" : "Yes, remove"}
                        </Button>
                        <Button variant="ghost" onClick={() => { setRemoving(undefined); }}>
                          Keep it
                        </Button>
                      </div>
                    ) : (
                      <div className="lb-actions">
                        <button
                          type="button"
                          className="lb-btn"
                          aria-label={`Edit ${item.work_type}`}
                          onClick={() => {
                            setEditing(item.id);
                            setRemoving(undefined);
                            setProblem(undefined);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="lb-btn"
                          aria-label={`Remove ${item.work_type}`}
                          onClick={() => {
                            setRemoving(item.id);
                            setEditing(undefined);
                            setProblem(undefined);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>
            ),
          )}
        </tbody>
      </table>
      {editing === undefined && problem !== undefined ? (
        <p role="alert" className="lb-error">
          {problem}
        </p>
      ) : null}
      {itemsLocked(order.status) ? <p className="lb-sub">This order is closed, so its items can't change.</p> : null}
      {editable ? (
        editing === "new" ? (
          <ItemForm
            label="Add an item"
            initial={blank}
            costs={costs}
            busy={add.isPending}
            error={problem}
            submitLabel="Add item"
            onSubmit={create}
            onCancel={() => {
              setEditing(undefined);
              setProblem(undefined);
            }}
          />
        ) : (
          <div className="lb-actions">
            <Button
              variant="ghost"
              icon={<Plus aria-hidden="true" size={15} />}
              onClick={() => {
                setEditing("new");
                setRemoving(undefined);
                setProblem(undefined);
              }}
            >
              Add item
            </Button>
          </div>
        )
      ) : null}
    </section>
  );
}
