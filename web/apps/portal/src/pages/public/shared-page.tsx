import { useQuery } from "@tanstack/react-query";
import { Printer, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import type { Prescription } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, EmptyState, Field, Skeleton, TextInput } from "@sakalya/ui";

import { useServices } from "../../clinic.js";
import { LetterheadSheet } from "../../components/letterhead/letterhead.js";
import { plainLetterhead } from "../../components/letterhead/sample.js";
import "./shared-page.css";

const TIMING_LABEL: Readonly<Record<string, string>> = {
  before_food: "Before food",
  after_food: "After food",
  empty_stomach: "Empty stomach",
  bedtime: "Bedtime",
  sos: "As needed",
  as_directed: "As directed",
};

function doctorLine(print: Prescription["print"]): string | undefined {
  const doctor = print?.doctor;
  if (doctor === undefined) {
    return undefined;
  }
  const name = doctor["display_name"];
  const registration = doctor["registration_number"];
  if (typeof name !== "string" || name === "") {
    return undefined;
  }
  return typeof registration === "string" && registration !== ""
    ? `${name} · Reg. no. ${registration}`
    : name;
}

const formatDay = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/**
 * The public, patient-facing page for a shared prescription (`/shared/:token`): a full page of its
 * own, not a dialog over the portal. No sign-in, a PIN instead; the link works for seven days and
 * locks after five wrong PINs. The clinic's letterhead sits on top before and after the PIN, the
 * sheet is A4-like on a desktop and reflows on a phone, and Print / Save as PDF uses the browser.
 */
export function SharedPage() {
  useDocumentTitle("Your prescription", "Aarogyam");
  const params = useParams();
  const token = params.token ?? "";
  const services = useServices();
  const preview = useQuery({
    queryKey: ["shared-preview", token],
    queryFn: () => services.neutral.getSharedPreview(token),
  });
  const letterhead = useQuery({
    queryKey: ["shared-letterhead", token],
    queryFn: () => services.neutral.getSharedLetterhead(token),
  });
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [prescription, setPrescription] = useState<Prescription>();

  if (preview.data === undefined || letterhead.data === undefined) {
    return (
      <main className="shp">
        <div
          className="shp-page"
          role="status"
          aria-label="Loading your prescription"
        >
          <Skeleton shape="block" />
        </div>
      </main>
    );
  }
  const result = preview.data;
  const clinicName = result.ok ? result.value.clinic_name : undefined;
  const document = letterhead.data.ok
    ? letterhead.data.value
    : plainLetterhead(clinicName ?? "Aarogyam");
  const state = locked ? "locked" : result.ok ? result.value.state : "missing";

  const Toolbar =
    prescription === undefined ? null : (
      <div className="shp-bar">
        <span>Your prescription</span>
        <Button
          icon={<Printer aria-hidden="true" className="size-4" />}
          onClick={() => {
            window.print();
          }}
        >
          Print / Save as PDF
        </Button>
      </div>
    );

  return (
    <main className="shp">
      {Toolbar}
      <div className="shp-page">
        <LetterheadSheet document={document}>
          {prescription === undefined ? (
            <PinGate
              state={state}
              pin={pin}
              setPin={setPin}
              busy={busy}
              error={error}
              onOpen={() => {
                setBusy(true);
                setError(undefined);
                void services.neutral.openShared(token, pin).then((opened) => {
                  setBusy(false);
                  if (opened.ok) {
                    setPrescription(opened.value);
                  } else if (opened.error.status === 423) {
                    setLocked(true);
                  } else {
                    setError(opened.error.message);
                    setPin("");
                  }
                });
              }}
            />
          ) : (
            <PrescriptionBody prescription={prescription} />
          )}
        </LetterheadSheet>
      </div>
    </main>
  );
}

function PinGate({
  state,
  pin,
  setPin,
  busy,
  error,
  onOpen,
}: {
  state: string;
  pin: string;
  setPin: (pin: string) => void;
  busy: boolean;
  error: string | undefined;
  onOpen: () => void;
}) {
  if (state !== "usable") {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-7" />}
        title={
          state === "locked"
            ? "This link is locked"
            : "This link isn't available"
        }
        description={
          state === "locked"
            ? "Too many wrong PINs were entered. Ask the clinic for a new link."
            : "It may have expired, or doesn't exist. Ask the clinic for a new link."
        }
      />
    );
  }
  return (
    <form
      className="shp-pin"
      onSubmit={(event) => {
        event.preventDefault();
        if (pin.length === 6 && !busy) {
          onOpen();
        }
      }}
    >
      <h1 className="shp-title">Your prescription</h1>
      <p className="shp-muted">
        Enter the 6-digit PIN printed on your prescription, or read out by the
        clinic.
      </p>
      <Field label="PIN" error={error} required>
        <TextInput
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          className="font-mono text-lg tracking-widest"
          value={pin}
          onChange={(event) => {
            setPin(event.currentTarget.value.replace(/\D/g, "").slice(0, 6));
          }}
        />
      </Field>
      <Button
        type="submit"
        className="mt-4 w-full"
        disabled={busy || pin.length !== 6}
      >
        {busy ? "Checking…" : "View prescription"}
      </Button>
    </form>
  );
}

function PrescriptionBody({ prescription }: { prescription: Prescription }) {
  const doctor = doctorLine(prescription.print);
  return (
    <div className="shp-rx">
      <div className="shp-meta">
        <div>
          <b>{prescription.patient.name}</b>
          <div className="shp-muted">{prescription.patient.number}</div>
        </div>
        <div className="shp-right">
          {prescription.number == null ? null : (
            <b className="shp-mono">{prescription.number}</b>
          )}
          {prescription.issued_at == null ? null : (
            <div className="shp-muted">{formatDay(prescription.issued_at)}</div>
          )}
        </div>
      </div>
      {prescription.diagnosis_text == null ? null : (
        <p className="shp-line">Diagnosis: {prescription.diagnosis_text}</p>
      )}
      <h1 className="shp-title">Rx</h1>
      <ol className="shp-items">
        {prescription.items.map((item, index) => (
          <li key={index}>
            <b>
              {item.drug_name} {item.strength}
            </b>
            <div className="shp-muted">
              {item.dose} · {item.frequency}
              {item.timing == null
                ? ""
                : ` · ${TIMING_LABEL[item.timing] ?? item.timing}`}
              {item.duration_days == null
                ? ""
                : ` · ${String(item.duration_days)} days`}
            </div>
            {item.instructions == null || item.instructions === "" ? null : (
              <div className="shp-muted">{item.instructions}</div>
            )}
          </li>
        ))}
      </ol>
      {prescription.advice == null ? null : (
        <p className="shp-line">Advice: {prescription.advice}</p>
      )}
      {prescription.follow_up_on == null ? null : (
        <p className="shp-line">
          Follow up: {formatDay(prescription.follow_up_on)}
        </p>
      )}
      {doctor === undefined ? null : (
        <p className="shp-doctor">Prescribed by {doctor}</p>
      )}
    </div>
  );
}
