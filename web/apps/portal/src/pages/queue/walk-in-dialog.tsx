import { useState } from "react";

import { apiErrorOf, type WalkInRequest } from "@aarogyam/api-client";
import { Button, Dialog, Field, Select, useToast } from "@sakalya/ui";

import { useRegisterWalkIn } from "../../walk-in-queries.js";
import { EMPTY_INTAKE, IntakeFields, type Intake } from "./intake-fields.js";
import { EMPTY_NEW_WALK_IN, NewWalkInFields, newWalkInProblem, type NewWalkIn } from "./new-walk-in-fields.js";
import { PhoneLookup, type Who } from "./phone-lookup.js";
import "../../components/quick-picks.css";

/** Builds the one-step walk-in request from what the desk entered, or says what is missing. */
export function walkInRequest(mobile: string, who: Who, fresh: NewWalkIn, intake: Intake, practitionerId: string): WalkInRequest | string {
  const consents: WalkInRequest["consents"] = [{ purpose: "care", method: "verbal" }];
  if (intake.reminders) consents.push({ purpose: "reminders", method: "verbal" });
  const common = {
    allergies: [...intake.allergies],
    no_known_allergies: intake.noKnownAllergies,
    consents,
    ...(practitionerId === "" ? {} : { practitioner_id: practitionerId }),
  };
  if (who.kind === "existing") return { ...common, patient_id: who.id };
  if (who.kind === "none" && mobile !== "") return "Pick the patient, or choose Someone new.";
  const problem = newWalkInProblem(fresh);
  if (problem !== undefined) return problem;
  return {
    ...common,
    patient: {
      full_name: fresh.fullName.trim(),
      ...(mobile === "" ? {} : { phone: `+91${mobile}` }),
      ...(fresh.age === "" ? {} : { age_years: Number(fresh.age) }),
      ...(fresh.sex === null ? {} : { sex: fresh.sex }),
    },
  };
}

export function WalkInDialog({ open, onOpenChange, practitioners }: { open: boolean; onOpenChange: (open: boolean) => void; practitioners: readonly { id: string; display_name: string }[] }) {
  const [mobile, setMobile] = useState("");
  const [who, setWho] = useState<Who>({ kind: "none" });
  const [fresh, setFresh] = useState<NewWalkIn>(EMPTY_NEW_WALK_IN);
  const [intake, setIntake] = useState<Intake>(EMPTY_INTAKE);
  const [practitionerId, setPractitionerId] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const register = useRegisterWalkIn();
  const toast = useToast();
  // No number at all (some walk-ins have no phone): go straight to registering someone new.
  const showNew = who.kind === "new" || (mobile === "" && who.kind === "none");

  const close = () => {
    onOpenChange(false);
    setMobile("");
    setWho({ kind: "none" });
    setFresh(EMPTY_NEW_WALK_IN);
    setIntake(EMPTY_INTAKE);
    setPractitionerId("");
    setError(undefined);
  };

  const submit = () => {
    const request = walkInRequest(mobile, who, fresh, intake, practitionerId);
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Walk-in"
      description="Register, note allergies and consent, and add to the queue in one step."
      dismissOnOutsidePress={false}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={register.isPending}>
            {register.isPending ? "Adding…" : "Add to queue"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <PhoneLookup mobile={mobile} onMobile={setMobile} who={who} onWho={setWho} />
        {showNew ? <NewWalkInFields value={fresh} onChange={setFresh} /> : null}
        <IntakeFields value={intake} onChange={setIntake} />
        <div className="wi-section">
          <Field label="Doctor" hint="Optional">
            <Select options={practitioners.map((p) => ({ value: p.id, label: p.display_name }))} value={practitionerId} onValueChange={setPractitionerId} placeholder="Not yet known" />
          </Field>
        </div>
        {error === undefined ? null : (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
