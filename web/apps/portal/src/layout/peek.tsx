import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import type { PatientId } from "@aarogyam/api-client";
import { formatDate, formatRupees } from "@aarogyam/app-kit";

import { Empty, MkCard, MkDrawer } from "../components/mk/index.js";
import { useClinic } from "../clinic.js";
import { ageSex, patientPath } from "../lib/patients.js";
import { usePendingReport } from "../pages/billing/queries.js";
import { useClinicalFlags, usePatient, useVisits } from "../queries.js";

export interface PeekRef {
  id: PatientId;
  name: string;
  number: string;
}

const PeekContext = createContext<((patient: PeekRef) => void) | null>(null);

/** Opens the Patient 360 quick look from anywhere inside the shell. */
export function usePatientPeek(): (patient: PeekRef) => void {
  const open = useContext(PeekContext);
  if (open === null) {
    throw new Error("usePatientPeek must be used inside PeekProvider");
  }
  return open;
}

export function PeekProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PeekRef | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const show = useCallback((next: PeekRef) => {
    setPatient(next);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <PeekContext value={value}>
      {children}
      <PatientPeekDrawer patient={patient} open={open} onClose={close} />
    </PeekContext>
  );
}

function PatientPeekDrawer({ patient, open, onClose }: { patient: PeekRef | undefined; open: boolean; onClose: () => void }) {
  return (
    <MkDrawer open={open} onClose={onClose} eyebrow="PATIENT 360" title={patient?.name ?? "Patient"} meta={patient?.number}>
      {patient === undefined ? null : <PeekBody patient={patient} onNavigate={onClose} />}
    </MkDrawer>
  );
}

function PeekBody({ patient, onNavigate }: { patient: PeekRef; onNavigate: () => void }) {
  const { can } = useClinic();
  const record = usePatient(patient.id);
  const clinical = can("clinical.read");
  const flags = useClinicalFlags(clinical ? patient.id : undefined);
  const visits = useVisits(clinical ? patient.id : undefined);
  const pending = usePendingReport(can("billing.read"));
  const owed = pending.data?.items.filter((item) => item.patient.id === patient.id).reduce((sum, item) => sum + item.balance_paise, 0);
  const p = record.data;
  const flagText =
    !clinical || flags.data === undefined
      ? "Clinical flags are visible to clinical staff."
      : flags.data.details_hidden
        ? "Details are hidden for your role."
        : [...flags.data.allergies.map((a) => `${a.substance} allergy`), ...flags.data.conditions.map((c) => c.display_text)].join(" · ") || "None recorded";
  const recent = (visits.data?.items ?? []).slice(0, 3);
  return (
    <>
      <MkCard title="⚠ Clinical flags" className="mk-flat">
        <p className="mk-hint" style={{ marginBottom: 0 }}>
          {flagText}
        </p>
      </MkCard>
      <div className="mk-kv">
        <span>Age · sex</span>
        <b>{p === undefined ? "—" : ageSex(p.age_years, p.sex)}</b>
      </div>
      <div className="mk-kv">
        <span>Last visit</span>
        <b>{p?.last_visit_at == null ? "—" : formatDate(p.last_visit_at)}</b>
      </div>
      <div className="mk-kv">
        <span>Next appointment</span>
        <b>—</b>
      </div>
      <div className="mk-kv">
        <span>Lifetime value</span>
        <b>—</b>
      </div>
      <div className="mk-kv">
        <span>Outstanding</span>
        <b>{owed === undefined ? "—" : owed === 0 ? "Nil" : formatRupees(owed)}</b>
      </div>
      <div className="mk-kv" style={{ borderBottom: 0 }}>
        <span>Consent</span>
        <b>Not recorded</b>
      </div>
      <h3>Recent visits</h3>
      {recent.length === 0 ? (
        <Empty title="No visits yet" />
      ) : (
        <ul className="mk-att">
          {recent.map((v) => (
            <li key={v.id}>
              <span className="mk-pri low" />
              <div>
                <b>{v.chief_complaint ?? "Visit"}</b>
                <p>
                  {formatDate(v.started_at)} · {v.number}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Link to={patientPath(patient)} onClick={onNavigate} className="mk-btn mk-btn-primary" style={{ flex: 1 }}>
          Open full record
        </Link>
        {can("appointments.write") ? (
          <Link to="/calendar?book=1" onClick={onNavigate} className="mk-btn mk-btn-ghost" style={{ flex: 1 }}>
            + Follow-up
          </Link>
        ) : null}
      </div>
    </>
  );
}
