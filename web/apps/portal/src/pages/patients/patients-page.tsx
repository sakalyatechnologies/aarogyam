import { Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiErrorNotice, formatDate, formatDateTime, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";

import { Empty, MkAvatar, MkCard, Tag, rowLink } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import { usePatientList } from "./queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

type QuickFilter = "all" | "with_balance" | "recalls_due" | "new_this_month";

const PAGE = 20;

const FILTERS: readonly { value: QuickFilter; label: string }[] = [
  { value: "all", label: "All" },
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
  const rows = search.data?.items ?? [];
  const canWrite = can("patients.write");
  const register = canWrite ? (
    <button
      type="button"
      className="mk-btn mk-btn-primary"
      onClick={() => {
        void navigate("/patients/new");
      }}
    >
      <Plus aria-hidden="true" /> New patient
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
      <h1 className="mk-sr">Patients</h1>
      <div className="mk-ptools">
        <input
          type="search"
          className="mk-tin"
          style={{ width: "auto", minWidth: 240, flex: "0 1 300px" }}
          aria-label="Search patients"
          placeholder="Search by name, phone, file no…"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
        <div role="group" aria-label="Filter patients" style={{ display: "contents" }}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className="mk-chipf"
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
        <span className="mk-spacer" />
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
        {register}
      </div>
      <MkCard
        title={`Patients · ${search.isPending ? "…" : rows.length.toLocaleString("en-IN")} records`}
        hint="Open a patient name for Patient 360"
      >
        <p role="status" className="mk-sr">
          {search.isFetching ? "Searching" : `${String(rows.length)} patients shown`}
        </p>
        {search.isError ? (
          <ApiErrorNotice title="Couldn't search patients" error={search.error} onRetry={() => void search.refetch()} />
        ) : search.isPending ? (
          <SkeletonRows count={6} tall label="Loading patients" />
        ) : rows.length === 0 ? (
          <Empty title={empty.title}>
            {empty.text} {register}
          </Empty>
        ) : (
          <>
            <div className="mk-tablewrap">
              <table className="mk-table">
                <caption className="mk-sr">Patients</caption>
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">File no.</th>
                    <th scope="col">Last visit</th>
                    <th scope="col">Next</th>
                    <th scope="col">Balance</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((row) => (
                    <tr key={row.id} {...rowLink(() => void navigate(patientPath(row)))}>
                      <th scope="row">
                        <span className="mk-pname">
                          <MkAvatar name={row.full_name} />
                          <Link to={patientPath(row)}>{row.full_name}</Link>
                          {row.age_years == null ? null : <span className="mk-hint" style={{ margin: 0 }}>· {row.age_years}y</span>}
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
                      {/* Null without billing.read: a dash, not zero. */}
                      <td>
                        {row.balance_paise == null ? "—" : row.balance_paise > 0 ? <b style={{ color: "var(--red)" }}>{formatRupees(row.balance_paise)}</b> : formatRupees(0)}
                      </td>
                      <td>
                        <Tag tone={row.status === "active" ? "done" : "wait"}>{row.status.toUpperCase()}</Tag>
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
