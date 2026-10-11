import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Patient } from "@aarogyam/api-client";
import { Button, Dialog, DateInput, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { PatientPicker } from "../../components/patient-picker.js";
import { useTodayDate } from "../../lib/patients.js";
import { useCreateLabOrder, useLabVendors } from "./queries.js";
import { WORK_TYPES, parseTeeth } from "./stages.js";

interface Row {
  key: number;
  work: string;
  teeth: string;
  shade: string;
  material: string;
  qty: string;
  cost: string;
}

let rowKey = 0;
const blankRow = (): Row => ({ key: (rowKey += 1), work: WORK_TYPES[0], teeth: "", shade: "", material: "", qty: "1", cost: "" });

const plusDays = (day: string, days: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Sends work to a lab in as few taps as it takes: the lab and a contact are chosen for you, the due date is a week out,
 * and the first item is ready to fill in. Needs `labs.write`.
 */
export function NewOrderDialog({ open, onClose, initialPatient }: { open: boolean; onClose: () => void; initialPatient?: Patient | undefined }) {
  const { can } = useClinic();
  const toast = useToast();
  const today = useTodayDate();
  const vendors = useLabVendors(open);
  const create = useCreateLabOrder();
  const [patient, setPatient] = useState<Patient | undefined>(initialPatient);
  const [vendorId, setVendorId] = useState("");
  const [contactId, setContactId] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blankRow()]);
  const [due, setDue] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string>();
  const costs = can("finance.view");

  const labs = vendors.data?.items ?? [];
  const lab = labs.find((v) => v.id === vendorId) ?? labs[0];
  const contacts = lab?.contacts ?? [];
  const contact = contacts.find((c) => c.id === contactId) ?? contacts[0];
  const dueOn = due === "" ? plusDays(today, 7) : due;

  const change = (key: number, field: keyof Row, value: string) => {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };
  const close = () => {
    onClose();
    setPatient(initialPatient);
    setVendorId("");
    setContactId("");
    setRows([blankRow()]);
    setDue("");
    setInstructions("");
    setError(undefined);
  };

  const submit = () => {
    setError(undefined);
    if (patient === undefined) {
      setError("Find the patient first.");
      return;
    }
    if (lab === undefined) {
      setError("Add a lab first, on the Labs tab.");
      return;
    }
    const items = [];
    for (const row of rows) {
      const teeth = parseTeeth(row.teeth);
      const qty = Number(row.qty);
      const rupees = row.cost.trim() === "" ? null : Number(row.cost);
      if (row.work.trim() === "") {
        setError("Write the kind of work for every item.");
        return;
      }
      if (teeth === null) {
        setError("Write tooth numbers such as 36 or 36, 37.");
        return;
      }
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        setError("Quantity must be a whole number from 1 to 99.");
        return;
      }
      if (rupees !== null && (!Number.isFinite(rupees) || rupees < 0)) {
        setError("Cost must be an amount in rupees.");
        return;
      }
      items.push({
        work_type: row.work.trim(),
        teeth,
        qty,
        ...(row.shade.trim() === "" ? {} : { shade: row.shade.trim() }),
        ...(row.material.trim() === "" ? {} : { material: row.material.trim() }),
        ...(rupees === null ? {} : { unit_cost_paise: Math.round(rupees * 100) }),
      });
    }
    create.mutate(
      {
        vendor_id: lab.id,
        patient_id: patient.id,
        ...(contact === undefined ? {} : { contact_id: contact.id }),
        due_on: dueOn,
        send: true,
        items,
        ...(instructions.trim() === "" ? {} : { instructions: instructions.trim() }),
      },
      {
        onSuccess: (order) => {
          toast.show({ title: `${order.number} sent to ${lab.name}`, tone: "success" });
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't send this order. Please try again.");
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
      title="Send work to a lab"
      description="The patient, the work and when you need it back."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={submit}>
            {create.isPending ? "Sending…" : "Send to lab"}
          </Button>
        </>
      }
    >
      <div className="lb-form">
        {patient === undefined ? (
          <PatientPicker onChoose={setPatient} />
        ) : (
          <div className="lb-picked">
            <span>
              <b>{patient.full_name}</b> · {patient.number}
            </span>
            <button
              type="button"
              className="lb-btn"
              onClick={() => {
                setPatient(undefined);
              }}
            >
              Change patient
            </button>
          </div>
        )}
        {labs.length === 0 && !vendors.isPending ? (
          <p role="alert" className="lb-error">
            There are no labs yet. Add one on the Labs tab first.
          </p>
        ) : (
          <div className="lb-two">
            <Field label="Lab" required>
              <Select
                options={labs.map((v) => ({ value: v.id, label: v.name }))}
                value={lab?.id ?? ""}
                onValueChange={(value) => {
                  setVendorId(value);
                  setContactId("");
                }}
              />
            </Field>
            <Field label="Contact">
              <Select
                options={contacts.length === 0 ? [{ value: "", label: "No contacts yet" }] : contacts.map((c) => ({ value: c.id, label: c.name }))}
                value={contact?.id ?? ""}
                onValueChange={setContactId}
              />
            </Field>
          </div>
        )}
        <fieldset className="lb-rows">
          <legend className="mk-flabel">Items in this order</legend>
          {rows.map((row, index) => (
            <div key={row.key} className="lb-row" role="group" aria-label={`Item ${String(index + 1)}`}>
              <Field label="Work" required>
                <TextInput
                  list="lb-work-types"
                  value={row.work}
                  onChange={(event) => {
                    change(row.key, "work", event.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="Teeth" hint="Such as 36 or 36, 37">
                <TextInput
                  inputMode="numeric"
                  value={row.teeth}
                  onChange={(event) => {
                    change(row.key, "teeth", event.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="Shade">
                <TextInput
                  value={row.shade}
                  maxLength={20}
                  onChange={(event) => {
                    change(row.key, "shade", event.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="Material">
                <TextInput
                  value={row.material}
                  maxLength={60}
                  onChange={(event) => {
                    change(row.key, "material", event.currentTarget.value);
                  }}
                />
              </Field>
              <Field label="Qty">
                <TextInput
                  inputMode="numeric"
                  value={row.qty}
                  onChange={(event) => {
                    change(row.key, "qty", event.currentTarget.value);
                  }}
                />
              </Field>
              {costs ? (
                <Field label="Cost each (₹)">
                  <TextInput
                    inputMode="decimal"
                    value={row.cost}
                    onChange={(event) => {
                      change(row.key, "cost", event.currentTarget.value);
                    }}
                  />
                </Field>
              ) : null}
              {rows.length > 1 ? (
                <button
                  type="button"
                  className="lb-iconbtn"
                  aria-label={`Remove item ${String(index + 1)}`}
                  onClick={() => {
                    setRows((current) => current.filter((r) => r.key !== row.key));
                  }}
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              ) : null}
            </div>
          ))}
          <datalist id="lb-work-types">
            {WORK_TYPES.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
          <Button
            variant="ghost"
            icon={<Plus aria-hidden="true" size={15} />}
            onClick={() => {
              setRows((current) => [...current, blankRow()]);
            }}
          >
            Add another item
          </Button>
        </fieldset>
        <div className="lb-two">
          <Field label="Due back" required>
            <DateInput value={dueOn} min={today} onValueChange={setDue} />
          </Field>
          <Field label="Instructions">
            <TextInput
              value={instructions}
              maxLength={1000}
              onChange={(event) => {
                setInstructions(event.currentTarget.value);
              }}
            />
          </Field>
        </div>
        {error === undefined ? null : (
          <p role="alert" className="lb-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
