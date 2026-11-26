import { useState } from "react";
import { useWatch } from "react-hook-form";
import { useNavigate } from "react-router";

import { unwrap } from "@aarogyam/api-client";
import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, FormActions, useToast } from "@sakalya/ui";
import { MkCard, Empty, PageHeader } from "../../components/mk/index.js";

import { EMPTY_PIN, type PinValue } from "../../components/pin-code-fields.js";
import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import { EMPTY_INTAKE, intakeProblems, toIntake, type IntakeValues } from "../../components/intake/intake-model.js";
import { IntakeSections } from "../../components/intake/intake-sections.js";
import { useIntakeOptions } from "../../intake-queries.js";
import { useCreatePatient } from "../../queries.js";
import { PhoneMatchCard, type FamilyPick } from "./phone-match-card.js";
import { LanguageField, PatientFields, patientErrorOf, toNewPatient, usePatientForm } from "./patient-form.js";

export function NewPatientPage() {
  const { session, can } = useClinic();
  useDocumentTitle("New patient", session.clinic.name);
  if (!can("patients.write")) {
    return <Empty title="You can't register patients">Ask the clinic's owner if you need to.</Empty>;
  }
  return <NewPatientForm />;
}

function NewPatientForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreatePatient();
  const form = usePatientForm();
  const [place, setPlace] = useState<{ line1: string; pin: PinValue }>({ line1: "", pin: EMPTY_PIN });
  const { api } = useClinic();
  const options = useIntakeOptions();
  const [intake, setIntake] = useState<IntakeValues>(EMPTY_INTAKE);
  const [family, setFamily] = useState<FamilyPick>();
  const { errors, isSubmitting } = form.formState;
  const sex = useWatch({ control: form.control, name: "sex" });
  const mobile = useWatch({ control: form.control, name: "phone" });
  const problems = intakeProblems(intake);

  const onSubmit = form.handleSubmit(async (values) => {
    if (Object.keys(problems).length > 0) return;
    const female = values.sex === "female";
    const fields = toIntake(intake, female);
    try {
      const patient = await create.mutateAsync({
        ...toNewPatient(values),
        ...(Object.keys(fields).length === 0 ? {} : { intake: fields }),
        ...(intake.health.length === 0 ? {} : { health: [...intake.health] }),
        ...(intake.allergies.trim() === "" ? {} : { allergies_text: intake.allergies.trim() }),
        ...(place.line1.trim() === "" && place.pin.pincode === "" && place.pin.city === "" ? {} : { address: { line1: place.line1.trim() || null, city: place.pin.city || null, district: place.pin.city || null, state: place.pin.state || null, pincode: place.pin.pincode || null } }),
      });
      if (family !== undefined) {
        try {
          await unwrap(api.addFamilyLink(family.of.id, { related_patient_id: patient.id, relation: family.relation }));
        } catch {
          toast.show({ title: "Registered, but the family link wasn't saved. Add it from the family card.", tone: "danger" });
        }
      }
      toast.show({ title: `Registered ${patient.number}`, tone: "success" });
      void navigate(patientPath(patient));
    } catch (thrown) {
      const message = patientErrorOf(form, thrown);
      if (message !== undefined) form.setError("root", { message });
    }
  });

  return (
    <>
      <PageHeader title="New patient" subtitle="The clinic number is given when you save." />
      <PhoneMatchCard mobile={mobile} family={family} onFamily={setFamily} />
      <MkCard className="max-w-2xl">
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
          <PatientFields form={form} address={{ ...place, onChange: setPlace }} />
          {options.data === undefined ? null : <IntakeSections value={intake} onChange={setIntake} choices={options.data} female={sex === "female"} mobile={mobile} problems={problems} contactExtra={<LanguageField form={form} />} />}
          {errors.root?.message === undefined ? null : (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
              {errors.root.message}
            </p>
          )}
          <FormActions>
            <Button
              variant="secondary"
              onClick={() => {
                void navigate("/patients");
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Register patient"}
            </Button>
          </FormActions>
        </form>
      </MkCard>
    </>
  );
}
