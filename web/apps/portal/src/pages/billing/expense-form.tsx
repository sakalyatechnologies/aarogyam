import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { apiErrorOf, EXPENSE_CATEGORIES, type Expense } from "@aarogyam/api-client";
import { formatRupees } from "@aarogyam/app-kit";
import { Button, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { DatePicker } from "../../components/mk/date-picker.js";
import { AlertBanner } from "../../components/mk/index.js";
import { BILL_ACCEPT, billProblem, CATEGORY_LABEL, PAID_BY, PAID_BY_VALUES } from "../../lib/expenses.js";
import { useTodayDate } from "../../lib/patients.js";
import { useRecordExpense, useUploadExpenseBill } from "./queries.js";

const OPTIONS = EXPENSE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] }));
/** The API's cap: 1,00,00,000 rupees. */
const MAX_RUPEES = 10_000_000;

const schemaFor = (today: string) =>
  z.object({
    category: z.enum(EXPENSE_CATEGORIES),
    spentOn: z.iso.date("Pick the day it was paid.").refine((day) => day <= today, "Pick today or an earlier day."),
    rupees: z
      .string()
      .trim()
      .regex(/^\d[\d,]*(\.\d{1,2})?$/, "Enter an amount in rupees, such as 1250 or 1,250.50.")
      .transform((text) => Number.parseFloat(text.replaceAll(",", "")))
      .refine((n) => n > 0 && n <= MAX_RUPEES, "Enter more than ₹0 and at most ₹1,00,00,000."),
    method: z.enum(PAID_BY_VALUES),
    note: z.string().trim().max(300, "Keep the note under 300 characters."),
  });

type Values = z.input<ReturnType<typeof schemaFor>>;
type Valid = z.output<ReturnType<typeof schemaFor>>;

const FIELDS: Readonly<Record<string, keyof Values>> = { category: "category", spent_on: "spentOn", amount_paise: "rupees", method: "method", note: "note" };

/** Quick add: category, day, amount, how it was paid, a note and an optional bill photo. Needs `expenses.write`. */
export function ExpenseForm({ onSaved }: { onSaved?: (day: string) => void }) {
  const today = useTodayDate();
  const toast = useToast();
  const record = useRecordExpense();
  const uploadBill = useUploadExpenseBill();
  const form = useForm<Values, unknown, Valid>({
    resolver: zodResolver(schemaFor(today)),
    mode: "onTouched",
    defaultValues: { category: "rent", spentOn: today, rupees: "", method: "upi", note: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const category = useWatch({ control: form.control, name: "category" });
  /** Bumped to remount (and so empty) the file field after an expense is added. */
  const [billField, setBillField] = useState(0);
  const [bill, setBill] = useState<File>();
  const [billError, setBillError] = useState<string>();
  /** An expense that was added but whose bill didn't upload: offered a retry. */
  const [failed, setFailed] = useState<{ expense: Expense; file: File; message: string }>();

  /** Uploads the bill of a just-added expense; a failure keeps the expense and offers a retry. */
  const sendBill = (expense: Expense, file: File, added: string) => {
    setFailed(undefined);
    uploadBill.mutate(
      { id: expense.id, file },
      {
        onSuccess: () => {
          toast.show({ title: `${added} with its bill`, tone: "success" });
        },
        onError: (thrown) => {
          setFailed({ expense, file, message: apiErrorOf(thrown)?.message ?? "Please try again." });
        },
      },
    );
  };

  const onSubmit = form.handleSubmit(async (values) => {
    const attached = bill;
    try {
      const expense = await record.mutateAsync({
        category: values.category,
        spent_on: values.spentOn,
        amount_paise: Math.round(values.rupees * 100),
        method: values.method,
        note: values.note === "" ? null : values.note,
      });
      const added = `${CATEGORY_LABEL[values.category]} expense added`;
      if (attached === undefined) {
        toast.show({ title: added, tone: "success" });
      } else {
        sendBill(expense, attached, added);
      }
      form.reset({ category: values.category, spentOn: values.spentOn, rupees: "", method: values.method, note: "" });
      setBill(undefined);
      setBillError(undefined);
      setBillField((n) => n + 1);
      onSaved?.(values.spentOn);
    } catch (thrown) {
      const apiError = apiErrorOf(thrown);
      const field = apiError?.field === undefined ? undefined : FIELDS[apiError.field];
      if (apiError !== undefined && field !== undefined) {
        form.setError(field, { message: apiError.message }, { shouldFocus: true });
      } else {
        form.setError("root", { message: apiError?.message ?? "Couldn't add the expense. Please try again." });
      }
    }
  });

  return (
    <form noValidate aria-label="Add an expense" className="ex-form" onSubmit={(event) => void onSubmit(event)}>
      <Field label="Category" error={errors.category?.message} required>
        <Select options={OPTIONS} {...form.register("category")} />
      </Field>
      <Field label="Day paid" error={errors.spentOn?.message} required id="ex-day">
        <Controller
          control={form.control}
          name="spentOn"
          render={({ field }) => <DatePicker id="ex-day" label="Day paid" value={field.value} min="2000-01-01" max={today} today={today} onChange={field.onChange} />}
        />
      </Field>
      <Field label="Amount (₹)" error={errors.rupees?.message} required>
        <TextInput inputMode="decimal" autoComplete="off" placeholder="0" {...form.register("rupees")} />
      </Field>
      <Field label="Paid by" error={errors.method?.message} required>
        <Select options={PAID_BY} {...form.register("method")} />
      </Field>
      <Field label="Note" error={errors.note?.message}>
        <TextInput autoComplete="off" placeholder="Optional, such as the supplier or month" {...form.register("note")} />
      </Field>
      <Field label="Bill photo" error={billError} hint="Optional. A JPEG or PNG photo, or a PDF, up to 10 MB.">
        <input
          key={billField}
          type="file"
          accept={BILL_ACCEPT}
          aria-label="Bill photo"
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            setBill(undefined);
            setBillError(undefined);
            if (file === undefined) return;
            const problem = billProblem(file);
            if (problem !== undefined) {
              input.value = "";
              setBillError(problem);
              return;
            }
            setBill(file);
          }}
        />
      </Field>
      {category === "material" ? (
        <div className="ex-wide">
          <AlertBanner tone="info">
            Stock deliveries are already counted as material automatically. Add only material bought outside Stock, or it counts twice.
          </AlertBanner>
        </div>
      ) : null}
      {errors.root?.message === undefined ? null : (
        <p role="alert" className="ex-wide ex-error">
          {errors.root.message}
        </p>
      )}
      {failed === undefined ? null : (
        <div role="alert" className="ex-wide ex-error ex-retry">
          <span>
            The expense of {formatRupees(failed.expense.amount_paise)} is added, but its bill didn't upload. {failed.message}
          </span>
          <div className="ex-retry-actions">
            <Button
              variant="secondary"
              disabled={uploadBill.isPending}
              onClick={() => {
                sendBill(failed.expense, failed.file, `${CATEGORY_LABEL[failed.expense.category]} expense added`);
              }}
            >
              Try the bill again
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFailed(undefined);
              }}
            >
              Skip it
            </Button>
          </div>
        </div>
      )}
      <div className="ex-wide">
        <Button type="submit" disabled={isSubmitting || uploadBill.isPending}>
          {isSubmitting ? "Adding…" : "Add expense"}
        </Button>
      </div>
    </form>
  );
}
