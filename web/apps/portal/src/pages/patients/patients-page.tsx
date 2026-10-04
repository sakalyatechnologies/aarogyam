import { Plus, UserRoundSearch } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { Patient } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, ChipFilterGroup, DataTable, Link, PageHeader, SearchInput, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageSex, maskPhone, patientPath } from "../../lib/patients.js";
import { usePatients } from "../../queries.js";

type QuickFilter = "all" | "new_this_month";

/** The start of this calendar month, in the viewer's local time, as an ISO instant. */
function startOfThisMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

const COLUMNS: readonly DataTableColumn<Patient>[] = [
  {
    id: "name",
    header: "Patient",
    cell: (row) => (
      <Link href={patientPath(row)} className="font-semibold text-primary-text hover:underline">
        {row.full_name}
      </Link>
    ),
  },
  { id: "number", header: "Number", cell: (row) => <span className="font-mono text-xs">{row.number}</span> },
  { id: "age", header: "Age and sex", cell: (row) => ageSex(row.age_years, row.sex) },
  // Lists show phones masked; Patient 360 reveals them on request.
  { id: "phone", header: "Phone", cell: (row) => (row.phone == null ? "—" : maskPhone(row.phone)) },
  { id: "visit", header: "Last visit", align: "end", cell: (row) => (row.last_visit_at == null ? "Not yet" : formatDate(row.last_visit_at)) },
];

/** Find a patient by name, clinic number or phone. The search never goes in the page URL. */
export function PatientsPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Patients", session.clinic.name);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<readonly QuickFilter[]>(["all"]);
  const search = usePatients(q);
  const monthStart = startOfThisMonth();
  const rows = (search.data?.items ?? []).filter((row) => filter[0] !== "new_this_month" || row.created_at >= monthStart);
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

  return (
    <>
      <PageHeader title="Patients" {...(q === "" ? { subtitle: "Recently seen first" } : {})} end={register} />
      <Card>
        <SearchInput
          label="Search patients"
          placeholder="Name, clinic number or phone"
          value={q}
          onValueChange={setQ}
          className="mb-4 max-w-xl"
        />
        <ChipFilterGroup
          label="Filter patients"
          value={filter}
          onValueChange={setFilter}
          className="mb-4"
          options={[
            { value: "all", label: "All" },
            { value: "new_this_month", label: "New this month" },
          ]}
        />
        <p role="status" className="sr-only">
          {search.isFetching ? "Searching" : `${String(rows.length)} patients shown`}
        </p>
        {search.isError ? (
          <ApiErrorNotice title="Couldn't search patients" error={search.error} onRetry={() => void search.refetch()} />
        ) : (
          <>
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
                    : { title: "No patients yet", description: "Registered patients show here.", action: register }
              }
            />
          </>
        )}
      </Card>
    </>
  );
}
