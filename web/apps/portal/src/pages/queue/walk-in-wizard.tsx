import { Check } from "lucide-react";
import { useState } from "react";

import { apiErrorOf } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, useToast } from "@sakalya/ui";

import { useRegisterWalkIn } from "../../walk-in-queries.js";
import { AllergyFields, ConsentFields, EMPTY_INTAKE, type Intake } from "./intake-fields.js";
import { EMPTY_NEW_WALK_IN, NewWalkInFields, type NewWalkIn } from "./new-walk-in-fields.js";
import { PhoneLookup, type Who } from "./phone-lookup.js";
import { ReasonField } from "./reason-field.js";
import { walkInRequest } from "./walk-in-dialog.js";
import "../../components/quick-picks.css";

const STEPS = ["Details", "Health", "Consent"] as const;

/** The walk-in in three steps (details, health, consent), the same request the one-step dialog sends. */
export function WalkInWizard({
  open,
  onOpenChange,
  practitioners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitioners: readonly { id: string; display_name: string }[];
}) {
  const [step, setStep] = useState(0);
  const [mobile, setMobile] = useState("");
  const [who, setWho] = useState<Who>({ kind: "none" });
  const [fresh, setFresh] = useState<NewWalkIn>(EMPTY_NEW_WALK_IN);
  const [intake, setIntake] = useState<Intake>(EMPTY_INTAKE);
  const [practitionerId, setPractitionerId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const register = useRegisterWalkIn();
  const toast = useToast();
  const showNew = who.kind === "new" || (mobile === "" && who.kind === "none");

  const close = () => {
    onOpenChange(false);
    setStep(0);
    setMobile("");
    setWho({ kind: "none" });
    setFresh(EMPTY_NEW_WALK_IN);
    setIntake(EMPTY_INTAKE);
    setPractitionerId("");
    setReason("");
    setError(undefined);
  };

  const request = walkInRequest(mobile, who, fresh, intake, practitionerId, reason);
  const next = () => {
    if (step === 0 && typeof request === "string") {
      setError(request);
      return;
    }
    setError(undefined);
    setStep(step + 1);
  };
  const submit = () => {
    if (typeof request === "string") {
      setError(request);
      return;
    }
    setError(undefined);
    register.mutate(request, {
      onSuccess: (done) => {
        toast.show({ title: `${done.patient.full_name}: token #${String(done.token.token_number)}`, tone: "success" });
        close();
      },
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't add the walk-in. Please try again.");
      },
    });
  };
  const summaryName = who.kind === "existing" ? who.name : fresh.fullName.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
      title="Walk-in (no booking)"
      description="Register the patient, note their health, take consent, and add them to the queue."
      dismissOnOutsidePress={false}
      footer={
        <>
          {step > 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setError(undefined);
                setStep(step - 1);
              }}
            >
              Back
            </Button>
          ) : (
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>
              Next
            </Button>
          ) : (
            <Button onClick={submit} disabled={register.isPending}>
              {register.isPending ? "Adding…" : "Add to queue"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ol className="fd-steps" aria-label="Walk-in steps">
          {STEPS.map((label, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined} data-done={index < step ? "true" : undefined}>
              <span aria-hidden="true">{index < step ? <Check className="size-3.5" /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {step === 0 ? (
          <>
            <PhoneLookup mobile={mobile} onMobile={setMobile} who={who} onWho={setWho} />
            {showNew ? <NewWalkInFields value={fresh} onChange={setFresh} /> : null}
            <ReasonField value={reason} onChange={setReason} />
          </>
        ) : null}
        {step === 1 ? (
          <>
            <AllergyFields value={intake} onChange={setIntake} />
            <div className="wi-section">
              <Field label="Doctor" hint="Optional">
                <Select options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))} value={practitionerId} onValueChange={setPractitionerId} placeholder="Not yet known" />
              </Field>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <p className="fd-summary">
              <b>{summaryName === "" ? "New patient" : summaryName}</b>
              <span>
                Allergies: {intake.allergies.length > 0 ? intake.allergies.join(", ") : intake.noKnownAllergies ? "none known" : "not asked"}
              </span>
            </p>
            <ConsentFields value={intake} onChange={setIntake} />
          </>
        ) : null}
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
