import { Search, UserPlus, X } from "lucide-react";
import { useRef, useState } from "react";

import type { Patient } from "@aarogyam/api-client";
import { Avatar, Button, Field, TextInput } from "@sakalya/ui";

import { ageSex } from "../../lib/patients.js";
import { useClinic } from "../../clinic.js";
import { usePatients } from "../../queries.js";
import { EMPTY_PATIENT, PatientFields, usePatientForm, type PatientForm } from "../patients/patient-form.js";
import { VisitKindTag, visitKindOf } from "./visit-kind-tag.js";

const MOBILE = /^[6-9]\d{9}$/;

/**
 * The patient step's state, held by the dialog so its Book button can register a new patient and book in one press.
 * `creating` is true once "New patient" is pressed, or while the search finds nobody: the registration fields then
 * show at once, the name (or a mobile number) carried over from the search.
 */
export function usePatientPicker(canRegister: boolean) {
  const [q, setQuery] = useState("");
  const [explicit, setExplicit] = useState(false);
  const draft = usePatientForm();
  // What the search last wrote into the draft: a field still holding it (or nothing) hasn't been typed in, so it follows the search.
  const carried = useRef({ fullName: "", phone: "" });
  const search = usePatients(q);
  const results = q.trim() === "" ? [] : (search.data?.items ?? []);
  const noMatch = canRegister && q.trim() !== "" && search.data !== undefined && results.length === 0;

  const carry = (text: string) => {
    const trimmed = text.trim();
    const next = { fullName: /[a-z]/i.test(trimmed) ? trimmed : "", phone: MOBILE.test(trimmed) ? trimmed : "" };
    const follow = (key: "fullName" | "phone") => {
      const current = draft.getValues(key);
      if (current === "" || current === carried.current[key]) {
        draft.setValue(key, next[key]);
      }
    };
    follow("fullName");
    follow("phone");
    carried.current = next;
  };

  return {
    q,
    search,
    results,
    draft,
    /** "New patient" was pressed: the search is out of the way and "Back to search" brings it back. */
    explicit: canRegister && explicit,
    creating: canRegister && (explicit || noMatch),
    noMatch,
    setQ: (text: string) => {
      setQuery(text);
      carry(text);
    },
    startCreating: () => {
      carry(q);
      setExplicit(true);
    },
    backToSearch: () => {
      setExplicit(false);
    },
    reset: () => {
      setQuery("");
      setExplicit(false);
      carried.current = { fullName: "", phone: "" };
      draft.reset(EMPTY_PATIENT);
    },
  };
}

export type PatientPicker = ReturnType<typeof usePatientPicker>;

/**
 * The booking dialog's patient step. Search by name, number or phone; a chosen patient shows as a chip with
 * "Change" (and "New patient" greys out). With no match, or after "New patient", the registration fields show
 * right here and the dialog's Book button registers the patient and books.
 */
export function BookingPatient({ patient, onChange, canRegister, picker }: { patient: Patient | undefined; onChange: (patient: Patient | undefined) => void; canRegister: boolean; picker: PatientPicker }) {
  const { session } = useClinic();
  const { q, search, results } = picker;

  return (
    <section className="mk-bk-patient" aria-label="Patient">
      <div className="mk-bk-row">
        <h3 className="mk-bk-h">Patient</h3>
        {canRegister ? (
          <button type="button" className="mk-dp-link" disabled={patient !== undefined || picker.explicit} onClick={picker.startCreating}>
            <UserPlus aria-hidden="true" className="size-3.5" /> New patient
          </button>
        ) : null}
      </div>
      {patient !== undefined ? (
        <div className="mk-bk-chip">
          <span className="flex items-center gap-3">
            <Avatar name={patient.full_name} size="sm" />
            <span>
              <span className="block text-sm font-bold text-text">{patient.full_name}</span>
              <span className="block text-xs text-muted">
                {patient.number} · {ageSex(patient.age_years, patient.sex)}
              </span>
              <span className="mt-1 block">
                <VisitKindTag kind={visitKindOf(patient)} lastSeen={patient.last_visit_at} timeZone={session.clinic.timezone} />
              </span>
            </span>
          </span>
          <Button
            variant="ghost"
            icon={<X aria-hidden="true" className="size-4" />}
            onClick={() => {
              onChange(undefined);
            }}
          >
            Change
          </Button>
        </div>
      ) : picker.explicit ? (
        <NewPatientFields draft={picker.draft} onBack={picker.backToSearch} />
      ) : (
        <>
          <Field label="Find the patient" hideLabel required>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
              <TextInput
                className="pl-9"
                placeholder="Name, clinic number or phone"
                value={q}
                onChange={(event) => {
                  picker.setQ(event.target.value);
                }}
              />
            </div>
            {q.trim() === "" ? null : (
              <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
                {search.isFetching ? (
                  <li className="px-4 py-3 text-sm text-muted">Searching…</li>
                ) : results.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-muted">{picker.noMatch ? "No patients match. Add them as a new patient below." : "No patients match."}</li>
                ) : (
                  results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(p);
                          picker.setQ("");
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted"
                      >
                        <Avatar name={p.full_name} size="sm" />
                        <span>
                          <span className="block text-sm font-semibold text-text">{p.full_name}</span>
                          <span className="block text-xs text-muted">
                            {p.number} · {ageSex(p.age_years, p.sex)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </Field>
          {picker.noMatch ? <NewPatientFields draft={picker.draft} /> : null}
        </>
      )}
    </section>
  );
}

/** The full registration form inside the dialog; the dialog's Book button saves it. */
function NewPatientFields({ draft, onBack }: { draft: PatientForm; onBack?: () => void }) {
  return (
    <div className="mk-bk-new" role="group" aria-label="New patient details">
      <p className="text-xs text-muted">Registered as a new patient when you book.</p>
      <PatientFields form={draft} />
      {onBack === undefined ? null : (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onBack}>
            Back to search
          </Button>
        </div>
      )}
    </div>
  );
}
