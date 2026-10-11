import { Plus, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { Invoice } from "@aarogyam/api-client";
import { ApiErrorNotice, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Tabs } from "@sakalya/ui";

import { Empty, Initials, MkCard, PageHeader, StatusChip } from "../../components/mk/index.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";
import { SortHeader } from "../../components/sort-header.js";
import { useSortable, type SortColumn } from "../../components/use-sortable.js";
import { useClinic } from "../../clinic.js";
import { useTodayDate } from "../../lib/patients.js";
import { invoiceStatus } from "../../lib/invoice-status.js";
import { CHIP_TONE, FILTERS, matchesFilter, modeOf, pendingOf, type StatusFilter } from "./billing-v2-parts.js";
import { ExpensesPanel } from "./expenses-panel.js";
import { InvoiceDrawer } from "./invoice-drawer.js";
import { useInvoices } from "./queries.js";
import "./billing-v2.css";

const SHOWN = 50;

const SORT_COLUMNS: readonly SortColumn<Invoice>[] = [
  { id: "bill", kind: "text", value: (i) => i.number ?? "Draft" },
  { id: "patient", kind: "text", value: (i) => i.patient.name },
  { id: "amount", kind: "money", value: (i) => i.total_paise },
  { id: "balance", kind: "money", value: (i) => i.balance_paise },
  { id: "mode", kind: "text", value: (i) => modeOf(i) },
  { id: "status", kind: "text", value: (i) => invoiceStatus(i).label },
];

/**
 * Billing, New look: the front desk's daily tool. Pending bills with one-tap Collect, every bill with status
 * filters and sortable headers, and a drawer for one bill (lines, payments, balance, Collect, Print, Share).
 * Money reports live in Analytics. Needs `billing.read`; the Expenses tab needs `finance.view`.
 */
export function BillingV2() {
  const { can } = useClinic();
  const [params, setParams] = useSearchParams();
  useDocumentTitle("Billing", "Aarogyam");
  const today = useTodayDate();
  const finance = can("finance.view");
  const canWrite = can("billing.write");
  const invoices = useInvoices();
  const rows = useMemo(() => invoices.data?.items ?? [], [invoices.data]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [open, setOpen] = useState<{ id: Invoice["id"]; collect: boolean }>();

  const newest = useMemo(() => rows.toSorted((a, b) => (b.issued_at ?? b.created_at).localeCompare(a.issued_at ?? a.created_at)), [rows]);
  const filtered = useMemo(() => newest.filter((i) => matchesFilter(i, filter)), [newest, filter]);
  const sortable = useSortable(filtered, SORT_COLUMNS);
  const pending = useMemo(() => pendingOf(rows), [rows]);
  const owed = pending.reduce((sum, i) => sum + i.balance_paise, 0);
  const counts = (value: StatusFilter) => rows.filter((i) => matchesFilter(i, value)).length;

  const bills = (
    <div className="bl2-grid">
      <MkCard title="To collect" hint={pending.length === 0 ? undefined : `${String(pending.length)} bill${pending.length === 1 ? "" : "s"} · ${formatRupees(owed)} owed`} className="bl2-card">
        {invoices.isPending ? (
          <SkeletonRows count={3} tall label="Loading pending bills" />
        ) : pending.length === 0 ? (
          <Empty art="bill" title="Nothing to collect">
            Every issued bill is paid in full.
          </Empty>
        ) : (
          <ul className="bl2-pending" aria-label="Pending bills">
            {pending.slice(0, 12).map((i) => (
              <li key={i.id}>
                <span className="bl2-who">
                  <Initials name={i.patient.name} size="sm" />
                  <span>
                    <strong>{i.patient.name}</strong>
                    <small className="mk-mono">{i.number ?? "Draft"}</small>
                  </span>
                </span>
                <span className="bl2-due">{formatRupees(i.balance_paise)}</span>
                {canWrite ? (
                  <button
                    type="button"
                    className="bl2-btn dark"
                    aria-label={`Collect ${formatRupees(i.balance_paise)} from ${i.patient.name}`}
                    onClick={() => {
                      setOpen({ id: i.id, collect: true });
                    }}
                  >
                    <WalletCards aria-hidden="true" /> Collect
                  </button>
                ) : (
                  <button
                    type="button"
                    className="bl2-btn"
                    aria-label={`Open bill ${i.number ?? ""} for ${i.patient.name}`}
                    onClick={() => {
                      setOpen({ id: i.id, collect: false });
                    }}
                  >
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </MkCard>

      <MkCard title="Invoices" className="bl2-card">
        <div className="bl2-chips" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className="bl2-chip"
              aria-pressed={filter === f.value}
              onClick={() => {
                setFilter(f.value);
              }}
            >
              {f.label} <span className="bl2-count">{counts(f.value)}</span>
            </button>
          ))}
        </div>
        {invoices.isError ? (
          <ApiErrorNotice title="Couldn't load bills" error={invoices.error} onRetry={() => void invoices.refetch()} />
        ) : invoices.isPending ? (
          <SkeletonRows count={5} tall label="Loading bills" />
        ) : rows.length === 0 ? (
          <Empty
            art="bill"
            title="No bills yet"
            action={
              canWrite ? (
                <Link to="/billing/invoices/new" className="mk-btn mk-btn-primary">
                  <Plus aria-hidden="true" /> New bill
                </Link>
              ) : undefined
            }
          >
            Bills you issue after a visit show here with their payment status.
          </Empty>
        ) : filtered.length === 0 ? (
          <p className="bl2-sub" role="status">
            No bills match this filter.
          </p>
        ) : (
          <div className="mk-tablewrap">
            <table className="mk-table bl2-table">
              <caption className="mk-sr">Invoices</caption>
              <thead>
                <tr>
                  <SortHeader id="bill" sortable={sortable}>
                    Bill
                  </SortHeader>
                  <SortHeader id="patient" sortable={sortable}>
                    Patient
                  </SortHeader>
                  <SortHeader id="amount" sortable={sortable}>
                    Amount
                  </SortHeader>
                  <SortHeader id="balance" sortable={sortable}>
                    Balance
                  </SortHeader>
                  <SortHeader id="mode" sortable={sortable}>
                    Mode
                  </SortHeader>
                  <SortHeader id="status" sortable={sortable}>
                    Status
                  </SortHeader>
                </tr>
              </thead>
              <tbody>
                {sortable.rows.slice(0, SHOWN).map((i) => {
                  const status = invoiceStatus(i);
                  return (
                    <tr
                      key={i.id}
                      className="bl2-row"
                      onClick={() => {
                        setOpen({ id: i.id, collect: false });
                      }}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="bl2-open mk-mono"
                          aria-label={`Open bill ${i.number ?? "Draft"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpen({ id: i.id, collect: false });
                          }}
                        >
                          {i.number ?? "Draft"}
                        </button>
                      </th>
                      <td>
                        <span className="mk-pname">
                          <Initials name={i.patient.name} size="sm" />
                          {i.patient.name}
                        </span>
                      </td>
                      <td>{formatRupees(i.total_paise)}</td>
                      <td>{i.status === "issued" ? formatRupees(i.balance_paise) : "—"}</td>
                      <td>{modeOf(i)}</td>
                      <td>
                        <StatusChip tone={CHIP_TONE[status.key]}>{status.label}</StatusChip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > SHOWN ? <p className="bl2-sub">Showing {SHOWN} of {filtered.length} bills. Filter to narrow them down.</p> : null}
          </div>
        )}
      </MkCard>
    </div>
  );

  const raw = params.get("tab");
  const tab = finance && raw === "expenses" ? "expenses" : "bills";

  return (
    <div className="mk-panel bl2">
      <PageHeader
        eyebrow={`Billing · ${new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`}
        title="Billing"
        subtitle="Collect what is owed, and find any bill."
        actions={
          canWrite ? (
            <Link to="/billing/invoices/new" className="mk-btn mk-btn-primary">
              <Plus aria-hidden="true" /> New bill
            </Link>
          ) : undefined
        }
      />
      {finance ? (
        <Tabs
          className="mk-tabs4 bl-tabs"
          label="Billing"
          value={tab}
          onValueChange={(next) => {
            setParams(next === "bills" ? {} : { tab: next });
          }}
          items={[
            { value: "bills", label: "Bills", content: bills },
            { value: "expenses", label: "Expenses", content: <ExpensesPanel /> },
          ]}
        />
      ) : (
        bills
      )}
      <InvoiceDrawer
        key={open?.id}
        invoiceId={open?.id}
        collect={open?.collect ?? false}
        onClose={() => {
          setOpen(undefined);
        }}
      />
    </div>
  );
}
