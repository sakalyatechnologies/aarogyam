import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { EXPENSE_CATEGORIES, type Expense } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees } from "@aarogyam/app-kit";
import { Button, Dialog, Field, TextArea } from "@sakalya/ui";

import { Empty, MkCard, StatusChip } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { useClinic } from "../../clinic.js";
import { useTodayDate } from "../../lib/patients.js";
import { CATEGORY_LABEL, ExpenseForm } from "./expense-form.js";
import { useExpenses, useVoidExpense } from "./queries.js";
import "./expenses.css";

/** `2026-10` → first and last day of that month. */
function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 2000, mon ?? 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(month: string, by: number): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year ?? 2000, (mon ?? 1) - 1 + by, 1)).toISOString().slice(0, 7);
}

const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Billing → Expenses: a quick-add form (with `expenses.write`) and one month's expenses grouped by
 * category with totals (`?month=`); voiding takes a reason. Needs `finance.view`.
 */
export function ExpensesPanel() {
  const { can } = useClinic();
  const today = useTodayDate();
  const [params, setParams] = useSearchParams();
  // The shown month is `?month=YYYY-MM` (this month by default), so links and back land on it.
  const asked = params.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(asked) && asked <= today.slice(0, 7) ? asked : today.slice(0, 7);
  const setMonth = (next: string) => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set("month", next);
      return updated;
    });
  };
  const expenses = useExpenses(monthRange(month), can("finance.view"));
  const [voiding, setVoiding] = useState<Expense>();

  if (!can("finance.view")) {
    return <Empty title="Expenses are for the owner">Ask the clinic's owner if you need to see them.</Empty>;
  }
  const items = expenses.data?.items ?? [];
  const live = items.filter((e) => e.status !== "void");
  const total = live.reduce((sum, e) => sum + e.amount_paise, 0);
  const groups = EXPENSE_CATEGORIES.map((category) => ({ category, rows: items.filter((e) => e.category === category) })).filter((g) => g.rows.length > 0);

  return (
    <div className="ex-layout">
      {can("expenses.write") ? (
        <MkCard title="Add an expense" hint="Rent, salaries, bills and anything bought outside Stock">
          <ExpenseForm onSaved={(day) => { setMonth(day.slice(0, 7)); }} />
        </MkCard>
      ) : null}
      <MkCard
        title={monthLabel(month)}
        hint={expenses.isSuccess ? `${formatRupees(total)} spent · ${String(live.length)} ${live.length === 1 ? "entry" : "entries"}` : undefined}
        action={
          <div className="ex-month" role="group" aria-label="Month">
            <button type="button" className="mk-iconbtn" aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); }}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="mk-iconbtn" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => { setMonth(shiftMonth(month, 1)); }}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        }
      >
        {expenses.isError ? (
          <ApiErrorNotice title="Couldn't load expenses" error={expenses.error} onRetry={() => void expenses.refetch()} />
        ) : expenses.isPending ? (
          <SkeletonRows count={5} label="Loading expenses" />
        ) : groups.length === 0 ? (
          <Empty art="bill" title="No expenses this month">Expenses you add show here by category. Stock deliveries count as material on their own.</Empty>
        ) : (
          <div className="ex-groups">
            {groups.map(({ category, rows }) => (
              <section key={category} className="ex-group" aria-labelledby={`ex-${category}`}>
                <header className="ex-group-head">
                  <h3 id={`ex-${category}`}>{CATEGORY_LABEL[category]}</h3>
                  <span className="ex-sum">{formatRupees(rows.filter((e) => e.status !== "void").reduce((s, e) => s + e.amount_paise, 0))}</span>
                </header>
                <ul className="ex-rows">
                  {rows.map((e) => (
                    <li key={e.id} className={e.status === "void" ? "ex-row is-void" : "ex-row"}>
                      <span className="ex-day">{dayLabel(e.spent_on)}</span>
                      <span className="ex-note">{e.status === "void" ? `Void: ${e.void_reason ?? ""}` : (e.note ?? "—")}</span>
                      <span className="ex-amt">{formatRupees(e.amount_paise)}</span>
                      {e.status === "void" ? (
                        <StatusChip tone="noshow">Void</StatusChip>
                      ) : (
                        <button type="button" className="mk-link" onClick={() => { setVoiding(e); }} aria-label={`Void ${CATEGORY_LABEL[e.category]} expense of ${formatRupees(e.amount_paise)}`}>
                          Void
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </MkCard>
      <VoidExpenseDialog expense={voiding} onClose={() => { setVoiding(undefined); }} />
    </div>
  );
}

function VoidExpenseDialog({ expense, onClose }: { expense: Expense | undefined; onClose: () => void }) {
  const voidExpense = useVoidExpense();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const close = () => {
    setReason("");
    setError(undefined);
    onClose();
  };
  const confirm = () => {
    if (expense === undefined) return;
    voidExpense.mutate(
      { id: expense.id, reason: reason.trim() },
      { onSuccess: close, onError: (thrown) => { setError(thrown instanceof Error ? thrown.message : "Couldn't void it. Please try again."); } },
    );
  };
  return (
    <Dialog
      open={expense !== undefined}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Void this expense"
      description="It stays on the list, marked void, and stops counting in reports."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="secondary" className="border-danger text-danger-text hover:bg-danger-soft" disabled={voidExpense.isPending || reason.trim().length < 3} onClick={confirm}>
            {voidExpense.isPending ? "Voiding…" : "Void expense"}
          </Button>
        </>
      }
    >
      <Field label="Reason" error={error} required>
        <TextArea rows={3} value={reason} onChange={(event) => { setReason(event.target.value); }} placeholder="Such as: entered twice" />
      </Field>
    </Dialog>
  );
}
