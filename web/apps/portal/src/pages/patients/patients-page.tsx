import { Plus, Upload, UserRoundSearch } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { Patient } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, ChipFilterGroup, DataTable, Link, Pill, SearchInput, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import { usePatientList } from "./queries.js";

type QuickFilter = "all" | "with_balance" | "recalls_due" | "new_this_month";

/** Mock-up palette for the initials tile; chosen from the patient number so it stays the same between visits. */
const TILE_COLOURS = ["#1b734a", "#a86e0f", "#4338ca", "#136650", "#be123c", "#0ea5e9", "#7c3aed"] as const;

function tileColour(key: string): string {
  let sum = 0;
  for (const ch of key) {
    sum += ch.charCodeAt(0);
  }
  return TILE_COLOURS[sum % TILE_COLOURS.length] ?? TILE_COLOURS[0];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase())
    .join("")
    .slice(0, 3);
}

const COLUMNS: readonly DataTableColumn<Patient>[] = [
  {
    id: "name",
    header: "Patient",
    sortValue: (row) => row.full_name,
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        {/* The tile is decoration: the name beside it is the accessible label. */}
        <span
          aria-hidden="true"
          className="grid size-8 flex-none place-items-center rounded-[11px] text-xs font-extrabold text-white"
          style={{ background: tileColour(row.number) }}
        >
          {initials(row.full_name)}
        </span>
        <Link href={patientPath(row)} className="font-semibold text-text hover:underline">
          {row.full_name}
        </Link>
        {row.age_years == null ? null : <span className="font-normal text-muted">· {row.age_years}y</span>}
      </span>
    ),
  },
  { id: "number", header: "File no.", cell: (row) => <span className="font-mono">{row.number}</span> },
  { id: "visit", header: "Last visit", sortValue: (row) => row.last_visit_at, cell: (row) => (row.last_visit_at == null ? "—" : formatDate(row.last_visit_at)) },
  {
    id: "next",
    header: "Next",
    sortValue: (row) => row.next_appointment?.starts_at,
    cell: (row) =>
      row.next_appointment == null ? (
        "—"
      ) : (
        <span title={row.next_appointment.practitioner}>{formatDateTime(row.next_appointment.starts_at)}</span>
      ),
  },
  {
    id: "balance",
    header: "Balance",
    sortValue: (row) => row.balance_paise,
    // Null without billing.read: a dash, not zero.
    cell: (row) => (row.balance_paise == null ? "—" : row.balance_paise > 0 ? <span className="font-semibold text-danger">{formatRupees(row.balance_paise)}</span> : formatRupees(0)),
  },
  {
    id: "status",
    header: "Status",
    cell: (row) => (
      <Pill tone={row.status === "active" ? "success" : "warning"}>{row.status === "active" ? "ACTIVE" : row.status.toUpperCase()}</Pill>
    ),
  },
];

/** Find a patient by name, clinic number or phone. The search never goes in the page URL. */
export function PatientsPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Patients", session.clinic.name);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<readonly QuickFilter[]>(["all"]);
  const search = usePatientList(q, {
    withBalance: filter[0] === "with_balance",
    recallsDue: filter[0] === "recalls_due",
    newThisMonth: filter[0] === "new_this_month",
  });
  const rows = search.data?.items ?? [];
  const register = can("patients.write") ? (
    <Button
      icon={<Plus aria-hidden="true" className="size-4" />}
      onClick={() => {
        void navigate("/patients/new");
      }}
    >
      New patient
    </Button>
  ) : undefined;
  const actions = can("patients.write") ? (
    <>
      <Button
        variant="secondary"
        icon={<Upload aria-hidden="true" className="size-4" />}
        onClick={() => {
          void navigate("/patients/import");
        }}
      >
        Import
      </Button>
      {register}
    </>
  ) : undefined;

  return (
    <>
      <h1 className="sr-only">Patients</h1>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <SearchInput
          label="Search patients"
          placeholder="Search by name, phone, file no…"
          value={q}
          onValueChange={setQ}
          className="w-full sm:w-auto sm:min-w-60"
        />
        <ChipFilterGroup
          label="Filter patients"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "with_balance", label: "With balance" },
            { value: "recalls_due", label: "Recalls due" },
            { value: "new_this_month", label: "New this month" },
          ]}
        />
        <div className="flex flex-wrap gap-2 sm:ms-auto">{actions}</div>
      </div>
      <Card>
        <h2 className="text-[15px] font-extrabold tracking-tight text-text">
          Patients <span className="font-medium text-muted">· {search.isPending ? "…" : rows.length.toLocaleString("en-IN")} records</span>
        </h2>
        <p className="mb-4 mt-1 text-[12.5px] text-muted">Open a patient name for Patient 360</p>
        <p role="status" className="sr-only">
          {search.isFetching ? "Searching" : `${String(rows.length)} patients shown`}
        </p>
        {search.isError ? (
          <ApiErrorNotice title="Couldn't search patients" error={search.error} onRetry={() => void search.refetch()} />
        ) : (
          <DataTable
            caption="Patients"
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            loading={search.isPending}
            pageSize={20}
            empty={
              q !== ""
                ? {
                    title: "No patients match your search",
                    description: "Check the spelling, or search by clinic number or the last digits of the phone.",
                    icon: <UserRoundSearch className="size-7" />,
                    action: register,
                  }
                : filter[0] === "new_this_month"
                  ? { title: "No patients registered this month", description: "Switch back to All to see everyone.", action: register }
                  : filter[0] === "with_balance"
                    ? { title: "No patients with a balance", description: "Switch back to All to see everyone." }
                    : filter[0] === "recalls_due"
                      ? { title: "No recalls due", description: "Switch back to All to see everyone." }
                      : { title: "No patients yet", description: "Registered patients show here.", action: register }
            }
          />
        )}
      </Card>
    </>
  );
}
