import { ListTodo, UserPlus, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";

import type { ClinicalFlags, Patient } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";

import { EmptyState, Initials, MkCard, PageHeader, SkeletonList, StatusChip, rowLink } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import { recentPatientIds } from "../../lib/recent-patients.js";
import { usePatientList } from "./queries.js";

type QuickFilter = "all" | "active_care" | "with_balance" | "recalls_due" | "new_this_month";
const SORTS = ["recent", "name", "last_visit"] as const;
type Sort = (typeof SORTS)[number];

const PAGE = 20;

const FILTERS: readonly { value: QuickFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active_care", label: "Active care" },
  { value: "with_balance", label: "With balance" },
  { value: "recalls_due", label: "Recalls due" },
  { value: "new_this_month", label: "New this month" },
];

/** Find a patient by name, clinic number or phone. The search never goes in the page URL. */
export function PatientsPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Patients", session.clinic.name);
  const navigate = useNavigate();
  const [shown, setShown] = useState(PAGE);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  // Search once typing pauses, not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed.trim());
      setShown(PAGE);
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const [filter, setFilter] = useState<QuickFilter>("all");
  const search = usePatientList(q, {
    withBalance: filter === "with_balance",
    recallsDue: filter === "recalls_due",
    newThisMonth: filter === "new_this_month",
  });
  const [sort, setSort] = useState<Sort>("recent");
  const loaded = search.data?.items;
  // Active care (an upcoming visit booked) and the sort narrow the loaded page here; the rest is the server's.
  const rows = useMemo(() => {
    const list = (loaded ?? []).filter((row) => filter !== "active_care" || row.next_appointment != null);
    return sort === "name"
      ? [...list].sort((a, b) => a.full_name.localeCompare(b.full_name))
      : sort === "last_visit"
        ? [...list].sort((a, b) => (b.last_visit_at ?? "").localeCompare(a.last_visit_at ?? ""))
        : list;
  }, [loaded, filter, sort]);
  const canWrite = can("patients.write");
  const register = canWrite ? (
    <button
      type="button"
      className="mk-btn mk-btn-primary"
      onClick={() => {
        void navigate("/patients/new");
      }}
    >
      <UserPlus aria-hidden="true" /> New patient
    </button>
  ) : undefined;
  const empty =
    q !== ""
      ? { title: "No patients match your search", text: "Check the spelling, or search by clinic number or the last digits of the phone." }
      : filter === "new_this_month"
        ? { title: "No patients registered this month", text: "Switch back to All to see everyone." }
        : filter === "with_balance"
          ? { title: "No patients with a balance", text: "Switch back to All to see everyone." }
          : filter === "recalls_due"
            ? { title: "No recalls due", text: "Switch back to All to see everyone." }
            : { title: "No patients yet", text: "Registered patients show here." };

  return (
    <div className="mk-panel">
      <PageHeader
        eyebrow="Patient directory"
        title="Patients"
        subtitle="Recent records, ongoing care and recalls."
        actions={
          <>
            {canWrite ? (
              <button
                type="button"
                className="mk-btn mk-btn-ghost"
                onClick={() => {
                  void navigate("/patients/import");
                }}
              >
                <Upload aria-hidden="true" /> Import
              </button>
            ) : null}
            <button
              type="button"
              className="mk-btn mk-btn-ghost"
              onClick={() => {
                void navigate("/patients/incomplete");
              }}
            >
              <ListTodo aria-hidden="true" /> Missing details
            </button>
            {register}
          </>
        }
      />
      <RecentlyViewed />
      <div className="mk-dir-tools">
        <input
          type="search"
          className="mk-tin mk-dir-search"
          aria-label="Search patients"
          placeholder="Search name, patient ID or phone"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
        <div role="group" aria-label="Filter patients" className="mk-seg">
          {FILTERS.filter((f) => f.value !== "with_balance" || can("billing.read")).map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => {
                setFilter(f.value);
                setShown(PAGE);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="mk-sort">
          <span>Sort</span>
          <select
            className="mk-tin"
            value={sort}
            onChange={(event) => {
              const next = SORTS.find((option) => option === event.target.value);
              if (next !== undefined) setSort(next);
            }}
          >
            <option value="recent">Recent first</option>
            <option value="name">Name A–Z</option>
            <option value="last_visit">Last visit</option>
          </select>
        </label>
      </div>
      <MkCard
        title={q === "" && filter === "all" ? "Recent patients" : "Results"}
        action={<span className="mk-hint" style={{ margin: 0 }}>{search.isPending ? "…" : `${rows.length.toLocaleString("en-IN")} records`}</span>}
      >
        <p role="status" className="mk-sr">
          {search.isFetching ? "Searching" : `${String(rows.length)} patients shown`}
        </p>
        {search.isError ? (
          <ApiErrorNotice title="Couldn't search patients" error={search.error} onRetry={() => void search.refetch()} />
        ) : search.isPending ? (
          <SkeletonList count={6} label="Loading patients" />
        ) : rows.length === 0 ? (
          <EmptyState compact art={q === "" ? "patients" : "search"} title={empty.title} description={empty.text} action={register} />
        ) : (
          <>
            <div className="mk-tablewrap">
              <table className="mk-table mk-dir">
                <caption className="mk-sr">Patients</caption>
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">Patient ID</th>
                    <th scope="col">Last visit</th>
                    <th scope="col">Next</th>
                    {can("billing.read") ? <th scope="col">Balance</th> : null}
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((row) => (
                    <tr key={row.id} {...rowLink(() => void navigate(patientPath(row)))}>
                      <th scope="row">
                        <span className="mk-pname">
                          <Initials name={row.full_name} size="sm" />
                          <span className="mk-dir-name">
                            <Link to={patientPath(row)}>{row.full_name}</Link>
                            <small>{row.age_years == null ? "Age not recorded" : `${String(row.age_years)} years`}</small>
                          </span>
                        </span>
                      </th>
                      <td className="mk-mono">{row.number}</td>
                      <td>{row.last_visit_at == null ? "—" : formatDate(row.last_visit_at)}</td>
                      <td>
                        {row.next_appointment == null ? (
                          "—"
                        ) : (
                          <span title={row.next_appointment.practitioner}>{formatDateTime(row.next_appointment.starts_at)}</span>
                        )}
                      </td>
                      {can("billing.read") ? (
                        <td>
                          {row.balance_paise == null ? "—" : row.balance_paise > 0 ? <b style={{ color: "var(--red)" }}>{formatRupees(row.balance_paise)}</b> : formatRupees(0)}
                        </td>
                      ) : null}
                      <td>
                        <PatientChips patient={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > shown ? (
              <p style={{ textAlign: "center", margin: "14px 0 0" }}>
                <button
                  type="button"
                  className="mk-btn mk-btn-ghost"
                  onClick={() => {
                    setShown(shown + PAGE);
                  }}
                >
                  Show more ({rows.length - shown} left)
                </button>
              </p>
            ) : null}
          </>
        )}
      </MkCard>
    </div>
  );
}

/** Allergy (when the record's flags are already loaded), recall and status chips. Never fetches. */
function PatientChips({ patient }: { patient: Patient }) {
  const { access } = useClinic();
  const queryClient = useQueryClient();
  const flags = queryClient.getQueryData<ClinicalFlags>(["clinical-flags", access.org_id, patient.id]);
  return (
    <span className="mk-chips">
      {flags !== undefined && flags.allergy_count > 0 ? <StatusChip tone="noshow">Allergy</StatusChip> : null}
      {patient.recall_due ? <StatusChip tone="waiting">Recall due</StatusChip> : null}
      <StatusChip tone={patient.status === "active" ? "ready" : "done"}>{patient.status === "active" ? "Active" : patient.status === "inactive" ? "Inactive" : patient.status === "deceased" ? "Deceased" : "Merged"}</StatusChip>
    </span>
  );
}

/** Cards for the patients opened recently in this tab, from records already loaded. */
function RecentlyViewed() {
  const { access } = useClinic();
  const queryClient = useQueryClient();
  const recent = recentPatientIds(access.org_id)
    .map((id) => queryClient.getQueryData<Patient>(["patient", access.org_id, id]))
    .filter((patient): patient is Patient => patient !== undefined);
  if (recent.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="recently-viewed" style={{ marginBottom: 18 }}>
      <div className="mk-sech" style={{ marginTop: 0 }}>
        <h2 id="recently-viewed">Recently viewed</h2>
      </div>
      <ul className="mk-recent">
        {recent.map((patient) => (
          <li key={patient.id}>
            <Link to={patientPath(patient)} className="mk-recent-card">
              <Initials name={patient.full_name} />
              <span>
                <strong>{patient.full_name}</strong>
                <small>
                  {patient.number}
                  {patient.last_visit_at == null ? "" : ` · Last visit ${formatDate(patient.last_visit_at)}`}
                </small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
