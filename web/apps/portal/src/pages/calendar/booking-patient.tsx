import { Search, UserPlus, X } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Patient } from "@aarogyam/api-client";
import { Avatar, Button, Field, TextInput } from "@sakalya/ui";

import { ageSex } from "../../lib/patients.js";
import { useCreatePatient, usePatients } from "../../queries.js";

/**
 * The booking dialog's patient step. Search by name, number or phone; a chosen patient shows as a chip with
 * "Change" (and "New patient" greys out); with no match, "New patient" registers one inline.
 */
export function BookingPatient({ patient, onChange, canRegister }: { patient: Patient | undefined; onChange: (patient: Patient | undefined) => void; canRegister: boolean }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const search = usePatients(q);
  const results = q.trim() === "" ? [] : (search.data?.items ?? []);
  const noMatch = q.trim() !== "" && !search.isFetching && results.length === 0;

  return (
    <section className="mk-bk-patient" aria-label="Patient">
      <div className="mk-bk-row">
        <h3 className="mk-bk-h">Patient</h3>
        {canRegister ? (
          <button
            type="button"
            className="mk-dp-link"
            disabled={patient !== undefined}
            onClick={() => {
              setCreating(true);
            }}
          >
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
      ) : creating ? (
        <NewPatientInline
          initialName={q}
          onCancel={() => {
            setCreating(false);
          }}
          onCreated={(created) => {
            setCreating(false);
            onChange(created);
          }}
        />
      ) : (
        <Field label="Find the patient" hideLabel required>
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
                <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
                  No patients match.
                  {noMatch && canRegister ? (
                    <Button
                      variant="secondary"
                      icon={<UserPlus aria-hidden="true" className="size-4" />}
                      onClick={() => {
                        setCreating(true);
                      }}
                    >
                      Register “{q.trim()}”
                    </Button>
                  ) : null}
                </li>
              ) : (
                results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(p);
                        setQ("");
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
      )}
    </section>
  );
}

/** Name, phone and age: the least that registers a patient; the rest can be filled in later. */
function NewPatientInline({ initialName, onCancel, onCreated }: { initialName: string; onCancel: () => void; onCreated: (patient: Patient) => void }) {
  const looksLikeName = /[a-z]/i.test(initialName);
  const [name, setName] = useState(looksLikeName ? initialName.trim() : "");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const create = useCreatePatient();
  const ageOk = /^\d{1,3}$/.test(age.trim()) && Number(age) <= 130;
  const phoneOk = phone === "" || /^[6-9]\d{9}$/.test(phone);
  const ready = name.trim().length >= 2 && ageOk && phoneOk;
  const save = () => {
    setError(undefined);
    create.mutate(
      { full_name: name.trim(), sex: "unknown", age_years: Number(age), ...(phone === "" ? {} : { phone: `+91${phone}` }) },
      {
        onSuccess: onCreated,
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't register the patient. Please try again.");
        },
      },
    );
  };
  return (
    <div className="mk-bk-new">
      <div className="grid gap-3 sm:grid-cols-[2fr_1.4fr_1fr]">
        <Field label="Full name" required>
          <TextInput autoComplete="off" value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label="Mobile" error={phoneOk ? undefined : "10 digits"}>
          <TextInput inputMode="numeric" autoComplete="off" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "").slice(0, 10)); }} />
        </Field>
        <Field label="Age" required>
          <TextInput inputMode="numeric" autoComplete="off" value={age} onChange={(event) => { setAge(event.target.value); }} />
        </Field>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Back to search
        </Button>
        <Button onClick={save} disabled={!ready || create.isPending}>
          {create.isPending ? "Saving…" : "Register patient"}
        </Button>
      </div>
    </div>
  );
}
