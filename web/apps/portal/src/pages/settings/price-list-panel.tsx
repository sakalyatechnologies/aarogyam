import { Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type PriceItem } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import {
  Button,
  DataTable,
  Dialog,
  Field,
  Pill,
  Select,
  Skeleton,
  Switch,
  TextInput,
  useToast,
  type DataTableColumn,
} from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useAddPriceItem, useChangePriceItem, usePriceItems } from "../billing/queries.js";

const GST_RATES = [
  { value: "0", label: "0% (exempt)" },
  { value: "5", label: "5%" },
  { value: "12", label: "12%" },
  { value: "18", label: "18%" },
];

const CATEGORIES = [
  { value: "consultation", label: "Consultation" },
  { value: "preventive", label: "Preventive" },
  { value: "restorative", label: "Restorative" },
  { value: "endodontics", label: "Endodontics" },
  { value: "oral_surgery", label: "Oral surgery" },
  { value: "orthodontics", label: "Orthodontics" },
  { value: "medicines", label: "Medicines" },
  { value: "other", label: "Other" },
];

interface Values {
  name: string;
  code: string;
  category: string;
  rupees: string;
  taxable: boolean;
  gstRate: string;
  sacHsn: string;
  active: boolean;
}

const EMPTY: Values = { name: "", code: "", category: "", rupees: "", taxable: false, gstRate: "0", sacHsn: "9993", active: true };

function toValues(item: PriceItem): Values {
  return {
    name: item.name,
    code: item.code ?? "",
    category: item.category ?? "",
    rupees: (item.price_paise / 100).toString(),
    taxable: item.taxable,
    gstRate: String(item.gst_rate),
    sacHsn: item.sac_hsn ?? "",
    active: item.active,
  };
}

/** Settings -> Price list: the clinic's billable items, their GST treatment, for billing. Needs `settings.manage`. */
export function PriceListPanel() {
  const { can } = useClinic();
  const canManage = can("settings.manage");
  const items = usePriceItems();
  const [dialog, setDialog] = useState<{ item?: PriceItem } | undefined>(undefined);

  if (items.isPending) {
    return <Skeleton shape="block" />;
  }
  if (items.isError) {
    return <ApiErrorNotice title="Couldn't load the price list" error={items.error} onRetry={() => void items.refetch()} />;
  }

  const columns: readonly DataTableColumn<PriceItem>[] = [
    {
      id: "name",
      header: "Name",
      cell: (p) =>
        canManage ? (
          <button
            type="button"
            onClick={() => {
              setDialog({ item: p });
            }}
            className="font-semibold text-text hover:underline"
          >
            {p.name}
          </button>
        ) : (
          <span className="font-semibold text-text">{p.name}</span>
        ),
      sortValue: (p) => p.name,
    },
    { id: "code", header: "Code", cell: (p) => <span className="font-mono text-xs">{p.code ?? "—"}</span> },
    { id: "category", header: "Category", cell: (p) => CATEGORIES.find((c) => c.value === p.category)?.label ?? (p.category ?? "—") },
    { id: "price", header: "Price", align: "end", cell: (p) => formatRupees(p.price_paise), sortValue: (p) => p.price_paise },
    { id: "gst", header: "GST", align: "end", cell: (p) => (p.taxable ? `${String(p.gst_rate)}%` : "Exempt") },
    { id: "status", header: "Status", cell: (p) => <Pill tone={p.active ? "success" : "neutral"}>{p.active ? "Active" : "Inactive"}</Pill> },
  ];

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            icon={<Plus aria-hidden="true" className="size-4" />}
            onClick={() => {
              setDialog({});
            }}
          >
            Add entry
          </Button>
        </div>
      ) : null}
      <DataTable
        caption="Price list"
        columns={columns}
        rows={items.data.items}
        rowKey={(p) => p.id}
        empty={{ title: "No price list entries yet", description: "Add what you bill for: consultations, procedures and medicines." }}
      />
      <PriceItemDialog
        dialog={dialog}
        onClose={() => {
          setDialog(undefined);
        }}
      />
    </div>
  );
}

function PriceItemDialog({ dialog, onClose }: { dialog: { item?: PriceItem } | undefined; onClose: () => void }) {
  const add = useAddPriceItem();
  const change = useChangePriceItem();
  const toast = useToast();
  const [values, setValues] = useState<Values>(EMPTY);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});

  const item = dialog?.item;
  const open = dialog !== undefined;

  // Loads the chosen item's values into the form each time a different (or no) item opens.
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);
  const key = item?.id ?? "new";
  if (open && loadedFor !== key) {
    setValues(item === undefined ? EMPTY : toValues(item));
    setLoadedFor(key);
  }

  const close = () => {
    onClose();
    setError(undefined);
    setFieldErrors({});
    setLoadedFor(undefined);
  };

  const submit = () => {
    setError(undefined);
    setFieldErrors({});
    const rupees = Number.parseFloat(values.rupees);
    if (!Number.isFinite(rupees) || rupees < 0) {
      setFieldErrors({ rupees: "Enter a price of 0 or more." });
      return;
    }
    const input = {
      name: values.name.trim(),
      code: values.code.trim() === "" ? null : values.code.trim(),
      category: values.category === "" ? null : values.category,
      price_paise: Math.round(rupees * 100),
      taxable: values.taxable,
      gst_rate: values.taxable ? Number.parseInt(values.gstRate, 10) : 0,
      sac_hsn: values.sacHsn.trim() === "" ? null : values.sacHsn.trim(),
      active: values.active,
    };
    const onError = (thrown: unknown) => {
      const apiError = apiErrorOf(thrown);
      if (apiError?.field === "code") {
        setFieldErrors({ code: apiError.message });
      } else if (apiError?.status === 409) {
        setFieldErrors({ code: "Another entry already uses this code." });
      } else {
        setError(apiError?.message ?? "Couldn't save this entry. Please try again.");
      }
    };
    if (item === undefined) {
      add.mutate(input, {
        onSuccess: () => {
          toast.show({ title: `Added ${input.name}`, tone: "success" });
          close();
        },
        onError,
      });
    } else {
      change.mutate(
        { id: item.id, input },
        {
          onSuccess: () => {
            toast.show({ title: `Saved ${input.name}`, tone: "success" });
            close();
          },
          onError,
        },
      );
    }
  };

  const pending = add.isPending || change.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={item === undefined ? "Add a price list entry" : "Edit price list entry"}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || values.name.trim() === ""}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          <TextInput
            value={values.name}
            onChange={(event) => {
              setValues((prev) => ({ ...prev, name: event.currentTarget.value }));
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" hint="Short, unique in the clinic" error={fieldErrors.code}>
            <TextInput
              value={values.code}
              onChange={(event) => {
                setValues((prev) => ({ ...prev, code: event.currentTarget.value }));
              }}
            />
          </Field>
          <Field label="Category">
            <Select
              options={[{ value: "", label: "None" }, ...CATEGORIES]}
              value={values.category}
              onValueChange={(category) => {
                setValues((prev) => ({ ...prev, category }));
              }}
            />
          </Field>
        </div>
        <Field label="Price (₹)" error={fieldErrors.rupees} required>
          <TextInput
            inputMode="decimal"
            value={values.rupees}
            onChange={(event) => {
              setValues((prev) => ({ ...prev, rupees: event.currentTarget.value }));
            }}
          />
        </Field>
        <Switch
          label="GST applies"
          checked={values.taxable}
          onCheckedChange={(taxable) => {
            setValues((prev) => ({ ...prev, taxable }));
          }}
        />
        {values.taxable ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GST rate">
              <Select options={GST_RATES} value={values.gstRate} onValueChange={(gstRate) => { setValues((prev) => ({ ...prev, gstRate })); }} />
            </Field>
            <Field label="SAC / HSN">
              <TextInput
                value={values.sacHsn}
                onChange={(event) => {
                  setValues((prev) => ({ ...prev, sacHsn: event.currentTarget.value }));
                }}
              />
            </Field>
          </div>
        ) : null}
        <Switch
          label="Offered"
          checked={values.active}
          onCheckedChange={(active) => {
            setValues((prev) => ({ ...prev, active }));
          }}
        />
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
