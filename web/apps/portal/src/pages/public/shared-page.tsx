import { useQuery } from "@tanstack/react-query";
import { HeartPulse, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import type { Prescription } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, Card, EmptyState, Field, Skeleton, TextInput } from "@sakalya/ui";

import { useServices } from "../../clinic.js";

const TIMING_LABEL: Readonly<Record<string, string>> = {
  before_food: "Before food",
  after_food: "After food",
  empty_stomach: "Empty stomach",
  bedtime: "Bedtime",
  sos: "As needed",
  as_directed: "As directed",
};

/**
 * The public, patient-facing page for a shared prescription (`/shared/:token`): no sign-in, a PIN
 * instead. The link works for seven days and locks after five wrong PINs.
 */
export function SharedPage() {
  useDocumentTitle("Your prescription", "Aarogyam");
  const params = useParams();
  const token = params.token ?? "";
  const services = useServices();
  const preview = useQuery({ queryKey: ["shared-preview", token], queryFn: () => services.neutral.getSharedPreview(token) });
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [prescription, setPrescription] = useState<Prescription>();

  if (preview.isPending) {
    return (
      <main className="flex min-h-full items-center justify-center px-4 py-10">
        <Skeleton shape="block" />
      </main>
    );
  }
  const result = preview.data;
  const clinicName = result?.ok === true ? result.value.clinic_name : undefined;
  const state = locked ? "locked" : result?.ok === true ? result.value.state : "missing";

  if (prescription !== undefined) {
    return (
      <main className="flex min-h-full items-center justify-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <p className="text-sm font-semibold text-muted">{clinicName}</p>
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">Your prescription</h1>
          {prescription.number == null ? null : <p className="mb-4 font-mono text-sm text-muted">{prescription.number}</p>}
          {prescription.diagnosis_text == null ? null : <p className="mb-3 text-sm">Diagnosis: {prescription.diagnosis_text}</p>}
          <ul className="divide-y divide-border">
            {prescription.items.map((item, index) => (
              <li key={index} className="py-2 text-sm">
                <p className="font-semibold text-text">
                  {item.drug_name} {item.strength}
                </p>
                <p className="text-muted">
                  {item.dose} · {item.frequency}
                  {item.timing == null ? "" : ` · ${TIMING_LABEL[item.timing] ?? item.timing}`}
                  {item.duration_days == null ? "" : ` · ${String(item.duration_days)} days`}
                </p>
              </li>
            ))}
          </ul>
          {prescription.advice == null ? null : <p className="mt-3 text-sm">Advice: {prescription.advice}</p>}
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
            <HeartPulse aria-hidden="true" className="size-6" />
          </span>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-text">{clinicName ?? "Aarogyam"}</p>
            <p className="text-xs text-muted">Your prescription</p>
          </div>
        </div>
        {state !== "usable" ? (
          <EmptyState
            icon={<ShieldAlert className="size-7" />}
            title={state === "locked" ? "This link is locked" : "This link isn't available"}
            description={
              state === "locked"
                ? "Too many wrong PINs were entered. Ask the clinic for a new link."
                : "It may have expired, or doesn't exist. Ask the clinic for a new link."
            }
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">Enter the 6-digit PIN printed on your prescription, or read out by the clinic.</p>
            <Field label="PIN" error={error} required>
              <TextInput
                inputMode="numeric"
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
              className="mt-4 w-full"
              disabled={busy || pin.length !== 6}
              onClick={() => {
                setBusy(true);
                setError(undefined);
                void services.neutral.openShared(token, pin).then((result) => {
                  setBusy(false);
                  if (result.ok) {
                    setPrescription(result.value);
                  } else if (result.error.status === 423) {
                    setLocked(true);
                  } else {
                    setError(result.error.message);
                    setPin("");
                  }
                });
              }}
            >
              {busy ? "Checking…" : "View prescription"}
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
