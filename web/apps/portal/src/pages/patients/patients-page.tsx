import { Plus, UserRoundSearch } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import type { PatientListItem } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, DataTable, Link, PageHeader, SearchInput, type DataTableColumn } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { ageSex, patientPath } from "../../lib/patients.js";
import { usePatientSearch } from "../../queries.js";

const COLUMNS: readonly DataTableColumn<PatientListItem>[] = [
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
  { id: "phone", header: "Phone", cell: (row) => row.phone_masked ?? "—" },
  { id: "visit", header: "Last visit", align: "end", cell: (row) => (row.last_visit_at == null ? "Not yet" : formatDate(row.last_visit_at)) },
];

/** Find a patient by name, clinic number or phone. The search never goes in the page URL. */
export function PatientsPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Patients", session.clinic.name);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const search = usePatientSearch(q);
  const rows = search.data?.pages.flatMap((page) => page.items) ?? [];
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
      <PageHeader title="Patients" {...(q === "" ? { subtitle: "Most recent visits first" } : {})} end={register} />
      <Card>
        <SearchInput
          label="Search patients"
          placeholder="Name, clinic number or phone"
          value={q}
          onValueChange={setQ}
          className="mb-4 max-w-xl"
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
              // Pages come from the API ("Show more"). Infinity here renders no rows (sakalya-web bug).
              pageSize={10_000}
              empty={
                q === ""
                  ? { title: "No patients yet", description: "Registered patients show here.", action: register }
                  : {
                      title: "No patients match your search",
                      description: "Check the spelling, or search by clinic number or the last digits of the phone.",
                      icon: <UserRoundSearch className="size-7" />,
                      action: register,
                    }
              }
            />
            {search.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" disabled={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>
                  {search.isFetchingNextPage ? "Loading…" : "Show more"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
