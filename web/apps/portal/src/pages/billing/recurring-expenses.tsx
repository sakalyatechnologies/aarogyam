import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { Controller, useForm, useWatch, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import { apiErrorOf, EXPENSE_CATEGORIES, type RecurringExpense } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { DatePicker } from "../../components/mk/date-picker.js";
import { Empty, MkCard, StatusChip } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { useClinic } from "../../clinic.js";
import { CATEGORY_LABEL, ordinal, PAID_BY, PAID_BY_VALUES, paidByLabel, scheduleLabel, shortDay, WEEKDAYS } from "../../lib/expenses.js";
import { useTodayDate } from "../../lib/patients.js";
import { useCreateRecurringExpense, useRecurringAction, useRecurringExpenses, useUpdateRecurringExpense } from "./queries.js";

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABEL[value] }));
const CADENCE_OPTIONS = [
  { value: "monthly", label: "Every month" },
  { value: "weekly", label: "Every week" },
];
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }));
const WEEKDAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i + 1), label }));
/** The API's cap: 1,00,00,000 rupees. */
const MAX_RUPEES = 10_000_000;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const rupees = z
  .string()
  .trim()
  .regex(/^\d[\d,]*(\.\d{1,2})?$/, "Enter an amount in rupees, such as 30000 or 30,000.")
  .transform((text) => Number.parseFloat(text.replaceAll(",", "")))
  .refine((n) => n > 0 && n <= MAX_RUPEES, "Enter more than ₹0 and at most ₹1,00,00,000.");
const note = z.string().trim().max(300, "Keep the note under 300 characters.");

const addSchemaFor = (today: string) =>
  z.object({
    category: z.enum(EXPENSE_CATEGORIES),
    rupees,
    method: z.enum(PAID_BY_VALUES),
    note,
    cadence: z.enum(["monthly", "weekly"]),
    dayOfMonth: z.string(),
    weekday: z.string(),
    startsOn: z.iso
      .date("Pick the first day.")
      .refine((day) => day >= addDays(today, -90) && day <= addDays(today, 366), "Pick a day from 90 days ago to a year ahead."),
  });
type AddValues = z.input<ReturnType<typeof addSchemaFor>>;
type AddValid = z.output<ReturnType<typeof addSchemaFor>>;

const editSchema = z.object({
  rupees,
  method: z.enum(PAID_BY_VALUES),
  note,
  dayOfMonth: z.string(),
  weekday: z.string(),
  endsOn: z.union([z.literal(""), z.iso.date("Pick the last day.")]),
});
type EditValues = z.input<typeof editSchema>;
type EditValid = z.output<typeof editSchema>;

/** The API's field names, mapped to each form's, so a refusal shows under its field. */
const ADD_FIELDS: Readonly<Partial<Record<string, keyof AddValues>>> = {
  category: "category",
  amount_paise: "rupees",
  method: "method",
  note: "note",
  cadence: "cadence",
  day_of_month: "dayOfMonth",
  weekday: "weekday",
  starts_on: "startsOn",
};
const EDIT_FIELDS: Readonly<Partial<Record<string, keyof EditValues>>> = {
  amount_paise: "rupees",
  method: "method",
  note: "note",
  day_of_month: "dayOfMonth",
  weekday: "weekday",
  ends_on: "endsOn",
};

/** An API refusal: the form field it is about, if any, and what to say. */
function refusalOf<K extends string>(thrown: unknown, fields: Readonly<Partial<Record<string, K>>>, fallback: string): { field: K | undefined; message: string } {
  const apiError = apiErrorOf(thrown);
  return { field: apiError?.field === undefined ? undefined : fields[apiError.field], message: apiError?.message ?? fallback };
}

/** "Rent · ₹30,000 · monthly on the 1st · next 1 Dec · UPI" */
export function recurringSummary(rule: RecurringExpense, today: string): string {
  const when =
    rule.status === "stopped"
      ? "stopped"
      : rule.status === "ended"
        ? `ended ${shortDay(rule.ends_on ?? rule.next_due_on, today)}`
        : rule.status === "paused"
          ? "paused"
          : `next ${shortDay(rule.next_due_on, today)}`;
  return [CATEGORY_LABEL[rule.category], formatRupees(rule.amount_paise), scheduleLabel(rule), when, rule.method == null ? undefined : paidByLabel(rule.method)]
    .filter((part) => part !== undefined)
    .join(" · ");
}

const CHIP: Readonly<Record<string, { tone: "waiting" | "noshow" | "done"; label: string } | undefined>> = {
  paused: { tone: "waiting", label: "Paused" },
  stopped: { tone: "noshow", label: "Stopped" },
  ended: { tone: "done", label: "Ended" },
};

/**
 * Billing → Expenses → Recurring: rent, salaries and other amounts recorded every month or week.
 * Listing needs `finance.view`; adding, editing, pausing and stopping need `expenses.write`.
 */
export function RecurringExpensesCard() {
  const { can } = useClinic();
  const today = useTodayDate();
  const canWrite = can("expenses.write");
  const rules = useRecurringExpenses();
  const action = useRecurringAction();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense>();
  const [stopping, setStopping] = useState<RecurringExpense>();
  const items = rules.data?.items ?? [];

  const run = (rule: RecurringExpense, kind: "pause" | "resume") => {
    action.mutate(
      { id: rule.id, action: kind },
      {
        onSuccess: () => {
          toast.show({ title: kind === "pause" ? `${CATEGORY_LABEL[rule.category]} paused` : `${CATEGORY_LABEL[rule.category]} resumed`, tone: "success" });
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't change it. Please try again.", tone: "danger" });
        },
      },
    );
  };

  return (
    <MkCard
      title="Recurring"
      hint="Rent, salaries and bills recorded for you on their day"
      action={
        canWrite ? (
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add recurring expense
          </Button>
        ) : undefined
      }
    >
      {rules.isError ? (
        <ApiErrorNotice title="Couldn't load recurring expenses" error={rules.error} onRetry={() => void rules.refetch()} />
      ) : rules.isPending ? (
        <SkeletonRows count={2} label="Loading recurring expenses" />
      ) : items.length === 0 ? (
        <Empty title="No recurring expenses">Add rent or a salary once, and it is recorded every month or week on its day.</Empty>
      ) : (
        <ul className="ex-rec-list" aria-label="Recurring expenses">
          {items.map((rule) => {
            const chip = CHIP[rule.status];
            const name = `${CATEGORY_LABEL[rule.category]} of ${formatRupees(rule.amount_paise)}`;
            return (
              <li key={rule.id} className={rule.status === "stopped" ? "ex-rec is-stopped" : "ex-rec"}>
                <div className="ex-rec-main">
                  <span className="ex-rec-line">{recurringSummary(rule, today)}</span>
                  {rule.note == null ? null : <span className="ex-rec-note">{rule.note}</span>}
                </div>
                {chip === undefined ? null : <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
                {canWrite && rule.status !== "stopped" ? (
                  <div className="ex-rec-actions">
                    {rule.status === "paused" ? (
                      <button type="button" className="mk-link" disabled={action.isPending} aria-label={`Resume ${name}`} onClick={() => { run(rule, "resume"); }}>
                        Resume
                      </button>
                    ) : (
                      <button type="button" className="mk-link" disabled={action.isPending} aria-label={`Pause ${name}`} onClick={() => { run(rule, "pause"); }}>
                        Pause
                      </button>
                    )}
                    <button type="button" className="mk-link" aria-label={`Edit ${name}`} onClick={() => { setEditing(rule); }}>
                      Edit
                    </button>
                    <button type="button" className="mk-link ex-rec-stop" aria-label={`Stop ${name}`} onClick={() => { setStopping(rule); }}>
                      Stop
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {adding ? <AddRecurringDialog onClose={() => { setAdding(false); }} /> : null}
      {editing === undefined ? null : <EditRecurringDialog rule={editing} onClose={() => { setEditing(undefined); }} />}
      <StopRecurringDialog rule={stopping} onClose={() => { setStopping(undefined); }} />
    </MkCard>
  );
}

/** The day field: a day of the month for a monthly rule, a weekday for a weekly one. */
function DayField({ cadence, day, weekday, errors }: { cadence: string; day: UseFormRegisterReturn; weekday: UseFormRegisterReturn; errors: { dayOfMonth?: string | undefined; weekday?: string | undefined } }) {
  return cadence === "weekly" ? (
    <Field label="On" error={errors.weekday} required>
      <Select options={WEEKDAY_OPTIONS} {...weekday} />
    </Field>
  ) : (
    <Field label="On day" error={errors.dayOfMonth} hint="A shorter month uses its last day." required>
      <Select options={DAY_OPTIONS} {...day} />
    </Field>
  );
}

function AddRecurringDialog({ onClose }: { onClose: () => void }) {
  const today = useTodayDate();
  const toast = useToast();
  const create = useCreateRecurringExpense();
  const formId = useId();
  const form = useForm<AddValues, unknown, AddValid>({
    resolver: zodResolver(addSchemaFor(today)),
    mode: "onTouched",
    defaultValues: { category: "rent", rupees: "", method: "upi", note: "", cadence: "monthly", dayOfMonth: today.slice(8, 10).replace(/^0/, ""), weekday: "1", startsOn: today },
  });
  const { errors, isSubmitting } = form.formState;
  const cadence = useWatch({ control: form.control, name: "cadence" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        category: values.category,
        amount_paise: Math.round(values.rupees * 100),
        method: values.method,
        note: values.note === "" ? null : values.note,
        cadence: values.cadence,
        ...(values.cadence === "monthly" ? { day_of_month: Number(values.dayOfMonth) } : { weekday: Number(values.weekday) }),
        starts_on: values.startsOn,
      });
      toast.show({ title: `Recurring ${CATEGORY_LABEL[values.category].toLowerCase()} added`, tone: "success" });
      onClose();
    } catch (thrown) {
      const refusal = refusalOf(thrown, ADD_FIELDS, "Couldn't add it. Please try again.");
      if (refusal.field === undefined) form.setError("root", { message: refusal.message });
      else form.setError(refusal.field, { message: refusal.message }, { shouldFocus: true });
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add recurring expense"
      description="It is recorded as an expense on each due day, until you pause or stop it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add recurring expense"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate aria-label="Add recurring expense" className="ex-form" onSubmit={(event) => void onSubmit(event)}>
        <Field label="Category" error={errors.category?.message} required>
          <Select options={CATEGORY_OPTIONS} {...form.register("category")} />
        </Field>
        <Field label="Amount (₹)" error={errors.rupees?.message} required>
          <TextInput inputMode="decimal" autoComplete="off" placeholder="0" {...form.register("rupees")} />
        </Field>
        <Field label="Paid by" error={errors.method?.message} required>
          <Select options={PAID_BY} {...form.register("method")} />
        </Field>
        <Field label="Note" error={errors.note?.message}>
          <TextInput autoComplete="off" placeholder="Optional, such as the landlord or staff member" {...form.register("note")} />
        </Field>
        <Field label="Repeats" error={errors.cadence?.message} required>
          <Select options={CADENCE_OPTIONS} {...form.register("cadence")} />
        </Field>
        <DayField cadence={cadence} day={form.register("dayOfMonth")} weekday={form.register("weekday")} errors={{ dayOfMonth: errors.dayOfMonth?.message, weekday: errors.weekday?.message }} />
        <Field label="Starting" error={errors.startsOn?.message} hint="An earlier day records the days already gone." required id="ex-rec-start">
          <Controller
            control={form.control}
            name="startsOn"
            render={({ field }) => <DatePicker id="ex-rec-start" label="Starting" value={field.value} min={addDays(today, -90)} max={addDays(today, 366)} today={today} onChange={field.onChange} />}
          />
        </Field>
        {errors.root?.message === undefined ? null : (
          <p role="alert" className="ex-error">
            {errors.root.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function EditRecurringDialog({ rule, onClose }: { rule: RecurringExpense; onClose: () => void }) {
  const today = useTodayDate();
  const toast = useToast();
  const update = useUpdateRecurringExpense();
  const formId = useId();
  const method = PAID_BY_VALUES.find((m) => m === rule.method) ?? "upi";
  const form = useForm<EditValues, unknown, EditValid>({
    resolver: zodResolver(editSchema),
    mode: "onTouched",
    defaultValues: {
      rupees: String(rule.amount_paise / 100),
      method,
      note: rule.note ?? "",
      dayOfMonth: String(rule.day_of_month ?? 1),
      weekday: String(rule.weekday ?? 1),
      endsOn: rule.ends_on ?? "",
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        id: rule.id,
        changes: {
          amount_paise: Math.round(values.rupees * 100),
          method: values.method,
          note: values.note === "" ? null : values.note,
          ...(rule.cadence === "monthly" ? { day_of_month: Number(values.dayOfMonth) } : { weekday: Number(values.weekday) }),
          ends_on: values.endsOn === "" ? null : values.endsOn,
        },
      });
      toast.show({ title: `${CATEGORY_LABEL[rule.category]} updated`, tone: "success" });
      onClose();
    } catch (thrown) {
      const refusal = refusalOf(thrown, EDIT_FIELDS, "Couldn't save it. Please try again.");
      if (refusal.field === undefined) form.setError("root", { message: refusal.message });
      else form.setError(refusal.field, { message: refusal.message }, { shouldFocus: true });
    }
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Edit recurring ${CATEGORY_LABEL[rule.category].toLowerCase()}`}
      description="Changes apply to expenses recorded from now on. Ones already recorded stay as they are."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate aria-label="Edit recurring expense" className="ex-form" onSubmit={(event) => void onSubmit(event)}>
        <Field label="Amount (₹)" error={errors.rupees?.message} required>
          <TextInput inputMode="decimal" autoComplete="off" {...form.register("rupees")} />
        </Field>
        <Field label="Paid by" error={errors.method?.message} required>
          <Select options={PAID_BY} {...form.register("method")} />
        </Field>
        <Field label="Note" error={errors.note?.message}>
          <TextInput autoComplete="off" {...form.register("note")} />
        </Field>
        <DayField cadence={rule.cadence} day={form.register("dayOfMonth")} weekday={form.register("weekday")} errors={{ dayOfMonth: errors.dayOfMonth?.message, weekday: errors.weekday?.message }} />
        <Field label="Last day" error={errors.endsOn?.message} hint="Optional. Nothing is recorded after it." id="ex-rec-end">
          <Controller
            control={form.control}
            name="endsOn"
            render={({ field }) => (
              <DatePicker id="ex-rec-end" label="Last day" value={field.value} min={rule.starts_on} today={today} clearable placeholder="No end" onChange={field.onChange} />
            )}
          />
        </Field>
        {errors.root?.message === undefined ? null : (
          <p role="alert" className="ex-error">
            {errors.root.message}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function StopRecurringDialog({ rule, onClose }: { rule: RecurringExpense | undefined; onClose: () => void }) {
  const today = useTodayDate();
  const action = useRecurringAction();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const close = () => {
    setError(undefined);
    onClose();
  };
  const confirm = () => {
    if (rule === undefined) return;
    action.mutate(
      { id: rule.id, action: "stop" },
      {
        onSuccess: () => {
          toast.show({ title: `${CATEGORY_LABEL[rule.category]} stopped`, tone: "success" });
          close();
        },
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't stop it. Please try again.");
        },
      },
    );
  };
  return (
    <Dialog
      open={rule !== undefined}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Stop this recurring expense?"
      description="Nothing more is recorded for it, and it can't be restarted. Expenses it already recorded stay. To skip a while, pause it instead."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Keep it
          </Button>
          <Button variant="secondary" className="border-danger text-danger-text hover:bg-danger-soft" disabled={action.isPending} onClick={confirm}>
            {action.isPending ? "Stopping…" : "Stop for good"}
          </Button>
        </>
      }
    >
      {rule === undefined ? null : <p className="ex-rec-line">{recurringSummary(rule, today)}</p>}
      {error === undefined ? null : (
        <p role="alert" className="ex-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
