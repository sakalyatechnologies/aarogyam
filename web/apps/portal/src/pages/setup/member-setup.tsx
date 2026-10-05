import { useState } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { TextField } from "./step-frame.js";
import { useChangeMyPractitioner, useMyPractitioner, useMyWorkingHours, useSetMyWorkingHours, useUpdateMySetup } from "./queries.js";
import { WeekHours, defaultWeek, hoursFromWeek, weekFromHours, weekProblem, type WeekHoursValue } from "./week-hours.js";
import { rememberLater } from "./later.js";

/** An invited doctor's one screen: their name, qualifications, registration number and working hours. */
export function MemberSetup() {
  const doctor = useMyPractitioner();
  const hours = useMyWorkingHours(doctor.data != null);
  if (doctor.isPending || (doctor.data != null && hours.isPending)) {
    return (
      <div className="sw mk-panel" role="status" aria-label="Loading your setup">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (doctor.isError) {
    return <ApiErrorNotice title="Couldn't load your details" error={doctor.error} onRetry={() => void doctor.refetch()} />;
  }
  return <MemberForm doctor={doctor.data} hours={hours.data} />;
}

function MemberForm({ doctor, hours }: { doctor: ReturnType<typeof useMyPractitioner>["data"]; hours: ReturnType<typeof useMyWorkingHours>["data"] }) {
  const { session, can } = useClinic();
  const navigate = useNavigate();
  const change = useChangeMyPractitioner();
  const setHours = useSetMyWorkingHours();
  const mySetup = useUpdateMySetup();
  const [name, setName] = useState(doctor?.display_name ?? session.user.display_name);
  const [qualifications, setQualifications] = useState(doctor?.qualifications ?? "");
  const [registration, setRegistration] = useState(doctor?.registration_number ?? "");
  const [week, setWeek] = useState<WeekHoursValue>(() => (hours !== undefined && hours.shifts.length > 0 ? weekFromHours(hours) : defaultWeek()));
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const isDoctor = can("prescriptions.issue");

  const finish = async (status: "done" | "skipped") => {
    await mySetup.mutateAsync({ step: "profile", status });
    void navigate("/today");
  };
  const save = async () => {
    setError(undefined);
    const problem = name.trim() === "" ? "Please add your name." : weekProblem(week);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await change.mutateAsync({ display_name: name.trim(), qualifications: qualifications.trim(), registration_number: registration.trim() });
      await setHours.mutateAsync(hoursFromWeek(week));
      await finish("done");
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save your details. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw mk-panel">
      <div className="sw-top">
        <h1>Welcome to {session.clinic.name}</h1>
        <p>One screen, about a minute. You can skip it.</p>
      </div>
      <MkCard title="About you" hint="Printed under your name on prescriptions, and used to book your patients.">
        <div className="sw-form">
          <TextField id="sw-me-name" label="Your name" value={name} onChange={setName} autoComplete="name" />
          {isDoctor ? (
            <div className="sw-two">
              <div>
                <TextField id="sw-me-quals" label="Qualifications" value={qualifications} placeholder="BDS, MDS" onChange={setQualifications} />
              </div>
              <div>
                <TextField id="sw-me-reg" label="Registration number" value={registration} placeholder="Council registration number" onChange={setRegistration} />
              </div>
            </div>
          ) : null}
          <h3 className="mk-flabel">Your working hours</h3>
          <WeekHours value={week} onChange={setWeek} idPrefix="sw-me-hours" />
        </div>
        {error === undefined ? null : (
          <p role="alert" className="sw-error">
            {error}
          </p>
        )}
        <div className="sw-foot">
          <span className="sw-spacer" />
          <button
            type="button"
            className="mk-btn mk-btn-ghost"
            disabled={busy}
            onClick={() => {
              rememberLater();
              finish("skipped").catch(() => {
                void navigate("/today");
              });
            }}
          >
            Skip for now
          </button>
          <button type="button" className="mk-btn mk-btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </MkCard>
    </div>
  );
}
