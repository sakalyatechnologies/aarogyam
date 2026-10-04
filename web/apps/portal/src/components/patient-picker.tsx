import { Search } from "lucide-react";
import { useState } from "react";

import type { Patient } from "@aarogyam/api-client";
import { Avatar, Field, TextInput } from "@sakalya/ui";

import { ageSex } from "../lib/patients.js";
import { usePatients } from "../queries.js";

/** Finds a patient by name, clinic number or phone (never put in a URL), then hands it back. */
export function PatientPicker({ onChoose }: { onChoose: (patient: Patient) => void }) {
  const [q, setQ] = useState("");
  const search = usePatients(q);
  const results = q.trim() === "" ? [] : (search.data?.items ?? []);
  return (
    <Field label="Find the patient" required>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
        <TextInput
          className="pl-9"
          placeholder="Name, clinic number or phone"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
          }}
        />
      </div>
      {q.trim() === "" ? null : (
        <ul className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-2xl border border-border">
          {search.isFetching ? (
            <li className="px-4 py-3 text-sm text-muted">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted">No patients match.</li>
          ) : (
            results.map((patient) => (
              <li key={patient.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChoose(patient);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-muted"
                >
                  <Avatar name={patient.full_name} size="sm" />
                  <span>
                    <span className="block text-sm font-semibold text-text">{patient.full_name}</span>
                    <span className="block text-xs text-muted">
                      {patient.number} · {ageSex(patient.age_years, patient.sex)}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </Field>
  );
}
