import { Plus } from "lucide-react";
import { useState } from "react";

import { apiErrorOf, type Practitioner, type PractitionerId, type WorkingHours } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { useAddPractitioner, useChangePractitioner, usePractitioners, useSetWorkingHours, useWorkingHours } from "../../queries.js";
import { StepFrame, TextField, type StepProps } from "./step-frame.js";
import { WeekHours, defaultWeek, hoursFromWeek, weekFromHours, weekProblem, type WeekHoursValue } from "./week-hours.js";

interface DoctorRow {
  key: string;
  id: PractitionerId | undefined;
  /** Set for the owner's own row, so the new doctor is the owner's account. */
  membership_id: string | undefined;
  name: string;
  qualifications: string;
  registration: string;
}

function rowOf(doctor: Practitioner): DoctorRow {
  return {
    key: doctor.id,
    id: doctor.id,
    membership_id: doctor.membership_id ?? undefined,
    name: doctor.display_name,
    qualifications: doctor.qualifications ?? "",
    registration: doctor.registration_number ?? "",
  };
}

/** Step 2: clinic hours (split shifts allowed) and the doctors, with the owner as the first. */
export function HoursStep({ props, practice }: { props: StepProps; practice: string | null | undefined }) {
  const doctors = usePractitioners();
  const first = doctors.data?.items.find((d) => d.active);
  const hours = useWorkingHours(first?.id);
  if (doctors.isPending || (first !== undefined && hours.isPending)) {
    return <Skeleton shape="block" />;
  }
  if (doctors.isError) {
    return <ApiErrorNotice title="Couldn't load your doctors" error={doctors.error} onRetry={() => void doctors.refetch()} />;
  }
  return <HoursForm props={props} doctors={doctors.data.items.filter((d) => d.active)} hours={hours.data} solo={practice === "solo"} />;
}

function HoursForm({ props, doctors, hours, solo }: { props: StepProps; doctors: readonly Practitioner[]; hours: WorkingHours | undefined; solo: boolean }) {
  const { session } = useClinic();
  const add = useAddPractitioner();
  const change = useChangePractitioner();
  const setHours = useSetWorkingHours();
  const [week, setWeek] = useState<WeekHoursValue>(() => (hours !== undefined && hours.shifts.length > 0 ? weekFromHours(hours) : defaultWeek()));
  const [rows, setRows] = useState<DoctorRow[]>(() => {
    const existing = doctors.map(rowOf);
    if (existing.some((row) => row.membership_id === session.membership.id)) {
      return existing;
    }
    // The owner is the clinic's first doctor, ready to confirm.
    return [{ key: "owner", id: undefined, membership_id: session.membership.id, name: session.user.display_name, qualifications: "", registration: "" }, ...existing];
  });
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const edit = (key: string, changes: Partial<DoctorRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  };

  const save = async () => {
    setError(undefined);
    const problem = weekProblem(week) ?? (rows.some((row) => row.name.trim() === "") ? "Every doctor needs a name." : undefined);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const shifts = hoursFromWeek(week);
      for (const row of rows) {
        const fields = { display_name: row.name.trim(), qualifications: row.qualifications.trim(), registration_number: row.registration.trim() };
        const saved =
          row.id === undefined
            ? await add.mutateAsync({ ...fields, ...(row.membership_id === undefined ? {} : { membership_id: row.membership_id }) })
            : await change.mutateAsync({ id: row.id, changes: fields });
        await setHours.mutateAsync({ id: saved.id, hours: shifts });
      }
      await props.done();
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save the hours and doctors. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      title="Hours and doctors"
      hint="When patients can be booked, and who sees them. Split shifts are fine."
      props={props}
      onContinue={() => void save()}
      busy={busy}
      error={error}
    >
      <h3 className="mk-flabel" style={{ marginTop: 0 }}>
        Clinic hours
      </h3>
      <WeekHours value={week} onChange={setWeek} idPrefix="sw-hours" />
      <p className="mk-hint" style={{ marginBottom: 0 }}>
        These hours apply to every doctor below. Change one doctor&rsquo;s own week later in Settings &rarr; Chairs and doctors.
      </p>

      <h3 className="mk-flabel">Doctors</h3>
      <ul className="sw-doctors">
        {rows.map((row, index) => (
          <li key={row.key} className="sw-doctor">
            <div className="sw-doctor-head">
              <b>{row.membership_id === session.membership.id ? "You" : `Doctor ${String(index + 1)}`}</b>
              {row.id === undefined && row.membership_id === undefined ? (
                <button
                  type="button"
                  className="sw-link"
                  onClick={() => {
                    setRows((prev) => prev.filter((r) => r.key !== row.key));
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
            <TextField id={`sw-doc-${row.key}-name`} label="Name" value={row.name} onChange={(name) => { edit(row.key, { name }); }} />
            <div className="sw-two">
              <div>
                <TextField id={`sw-doc-${row.key}-quals`} label="Qualifications" value={row.qualifications} placeholder="BDS, MDS" onChange={(qualifications) => { edit(row.key, { qualifications }); }} />
              </div>
              <div>
                <TextField id={`sw-doc-${row.key}-reg`} label="Registration number" value={row.registration} placeholder="Medical or dental council number" onChange={(registration) => { edit(row.key, { registration }); }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {solo ? null : (
        <button
          type="button"
          className="sw-link"
          onClick={() => {
            setRows((prev) => [...prev, { key: `new-${String(prev.length)}-${String(Date.now())}`, id: undefined, membership_id: undefined, name: "", qualifications: "", registration: "" }]);
          }}
        >
          <Plus aria-hidden="true" /> Add another doctor
        </button>
      )}
    </StepFrame>
  );
}
