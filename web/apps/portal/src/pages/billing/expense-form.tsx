import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { apiErrorOf, EXPENSE_CATEGORIES } from "@aarogyam/api-client";
import { Button, DateInput, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { AlertBanner } from "../../components/mk/index.js";
import { CATEGORY_LABEL } from "../../lib/expenses.js";
import { useTodayDate } from "../../lib/patients.js";
import { useRecordExpense } from "./queries.js";

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
    note: z.string().trim().max(300, "Keep the note under 300 characters."),
  });

type Values = z.input<ReturnType<typeof schemaFor>>;
type Valid = z.output<ReturnType<typeof schemaFor>>;

const FIELDS: Readonly<Record<string, keyof Values>> = { category: "category", spent_on: "spentOn", amount_paise: "rupees", note: "note" };

/** Quick add: category, day, amount and a note. Needs `expenses.write`. */
export function ExpenseForm({ onSaved }: { onSaved?: (day: string) => void }) {
  const today = useTodayDate();
  const toast = useToast();
  const record = useRecordExpense();
  const form = useForm<Values, unknown, Valid>({
    resolver: zodResolver(schemaFor(today)),
    mode: "onTouched",
    defaultValues: { category: "rent", spentOn: today, rupees: "", note: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const category = useWatch({ control: form.control, name: "category" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await record.mutateAsync({
        category: values.category,
        spent_on: values.spentOn,
        amount_paise: Math.round(values.rupees * 100),
        note: values.note === "" ? null : values.note,
      });
      toast.show({ title: `${CATEGORY_LABEL[values.category]} expense added`, tone: "success" });
      form.reset({ category: values.category, spentOn: values.spentOn, rupees: "", note: "" });
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
      <Field label="Day paid" error={errors.spentOn?.message} required>
        <DateInput {...form.register("spentOn")} max={today} min="2000-01-01" />
      </Field>
      <Field label="Amount (₹)" error={errors.rupees?.message} required>
        <TextInput inputMode="decimal" autoComplete="off" placeholder="0" {...form.register("rupees")} />
      </Field>
      <Field label="Note" error={errors.note?.message}>
        <TextInput autoComplete="off" placeholder="Optional, such as the supplier or month" {...form.register("note")} />
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
      <div className="ex-wide">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : "Add expense"}
        </Button>
      </div>
    </form>
  );
}
