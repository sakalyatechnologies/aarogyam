import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { apiErrorOf, patientId as parsePatientId, randomUuid, type InvoiceLineInput, type Patient } from "@aarogyam/api-client";
import { formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Avatar, Button, Card, Field, FormActions, Select, TextInput } from "@sakalya/ui";

import { PatientPicker } from "../../components/patient-picker.js";
import { ageSex } from "../../lib/patients.js";
import { usePatient } from "../../queries.js";
import { useCreateInvoice, usePriceItems } from "./queries.js";
import { PageHeader } from "../../components/mk/index.js";

interface DraftLine {
  key: string;
  priceItemId: string;
  description: string;
  quantity: string;
  unitRupees: string;
}

function emptyLine(): DraftLine {
  return { key: randomUuid(), priceItemId: "", description: "", quantity: "1", unitRupees: "" };
}

/** Starts a draft bill: pick the patient, add lines from the price list or free text. */
export function NewInvoicePage() {
  useDocumentTitle("New bill", "Billing");
  const navigate = useNavigate();
  const [picked, setPatient] = useState<Patient | null>();
  // "Complete and bill" from a visit opens this page for that patient (?patient=<id>); "Change patient" clears it.
  const [params] = useSearchParams();
  const presetId = parsePatientId.safeParse(params.get("patient") ?? undefined);
  const preset = usePatient(presetId.success && picked === undefined ? presetId.data : undefined);
  const patient = picked === null ? undefined : (picked ?? preset.data);
  const priceItems = usePriceItems();
  const create = useCreateInvoice();
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [error, setError] = useState<string>();

  if (patient === undefined) {
    return (
      <>
        <PageHeader title="New bill" subtitle="Find the patient to bill" />
        <Card className="max-w-xl">
          <PatientPicker onChoose={setPatient} />
        </Card>
      </>
    );
  }

  const priceOptions = [
    { value: "", label: "Free text" },
    ...(priceItems.data?.items.filter((p) => p.active).map((p) => ({ value: p.id, label: `${p.name} · ${formatRupees(p.price_paise)}` })) ?? []),
  ];

  const updateLine = (key: string, changes: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...changes } : line)));
  };

  const choosePriceItem = (key: string, priceItemId: string) => {
    const chosen = priceItems.data?.items.find((p) => p.id === priceItemId);
    updateLine(key, {
      priceItemId,
      description: chosen?.name ?? "",
      unitRupees: chosen === undefined ? "" : (chosen.price_paise / 100).toString(),
    });
  };

  const submit = async () => {
    setError(undefined);
    const items: InvoiceLineInput[] = [];
    for (const line of lines) {
      const description = line.description.trim();
      const quantity = Number.parseInt(line.quantity, 10);
      const unitRupees = Number.parseFloat(line.unitRupees);
      if (line.priceItemId === "" && description === "") {
        continue;
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        setError("Each line needs a quantity of at least 1.");
        return;
      }
      if (line.priceItemId === "" && (!Number.isFinite(unitRupees) || unitRupees < 0)) {
        setError("Each free-text line needs a price.");
        return;
      }
      items.push({
        price_item_id: line.priceItemId === "" ? null : line.priceItemId,
        description: line.priceItemId === "" ? description : null,
        quantity,
        unit_price_paise: line.priceItemId === "" ? Math.round(unitRupees * 100) : null,
      });
    }
    if (items.length === 0) {
      setError("Add at least one line.");
      return;
    }
    const result = await create.mutateAsync({ patient_id: patient.id, items });
    void navigate(`/billing/invoices/${result.id}`, { replace: true });
  };

  return (
    <>
      <PageHeader title="New bill" subtitle={`For ${patient.full_name} (${patient.number})`} />
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <Avatar name={patient.full_name} size="sm" />
            <div>
              <p className="font-semibold text-text">{patient.full_name}</p>
              <p className="text-xs text-muted">
                {patient.number} · {ageSex(patient.age_years, patient.sex)}
              </p>
            </div>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setPatient(null);
              }}
            >
              Change patient
            </Button>
          </div>
        </Card>
        <Card title="Lines">
          <div className="flex flex-col gap-3">
            {lines.map((line) => (
              <div key={line.key} className="grid grid-cols-1 gap-2 rounded-2xl border border-border p-3 sm:grid-cols-[2fr_2fr_80px_120px_auto]">
                <Field label="Item" hideLabel>
                  <Select
                    options={priceOptions}
                    value={line.priceItemId}
                    onValueChange={(value) => {
                      choosePriceItem(line.key, value);
                    }}
                  />
                </Field>
                <Field label="Description" hideLabel>
                  <TextInput
                    placeholder="Description"
                    disabled={line.priceItemId !== ""}
                    value={line.description}
                    onChange={(event) => {
                      updateLine(line.key, { description: event.currentTarget.value });
                    }}
                  />
                </Field>
                <Field label="Qty" hideLabel>
                  <TextInput
                    inputMode="numeric"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(event) => {
                      updateLine(line.key, { quantity: event.currentTarget.value });
                    }}
                  />
                </Field>
                <Field label="Price (₹)" hideLabel>
                  <TextInput
                    inputMode="decimal"
                    placeholder="₹"
                    disabled={line.priceItemId !== ""}
                    value={line.unitRupees}
                    onChange={(event) => {
                      updateLine(line.key, { unitRupees: event.currentTarget.value });
                    }}
                  />
                </Field>
                <Button
                  variant="ghost"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() => {
                    setLines((prev) => prev.filter((candidate) => candidate.key !== line.key));
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                setLines((prev) => [...prev, emptyLine()]);
              }}
            >
              Add line
            </Button>
          </div>
        </Card>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
        <FormActions>
          <Button
            variant="secondary"
            onClick={() => {
              void navigate("/billing");
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={create.isPending}
            onClick={() => {
              void submit().catch((thrown: unknown) => {
                setError(apiErrorOf(thrown)?.message ?? "Couldn't save this bill. Please try again.");
              });
            }}
          >
            {create.isPending ? "Saving…" : "Save as draft"}
          </Button>
        </FormActions>
      </div>
    </>
  );
}
