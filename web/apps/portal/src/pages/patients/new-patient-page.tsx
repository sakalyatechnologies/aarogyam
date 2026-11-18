import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Button, FormActions, useToast } from "@sakalya/ui";
import { MkCard, Empty, PageHeader } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { patientPath } from "../../lib/patients.js";
import { useCreatePatient } from "../../queries.js";
import { PatientFields, patientErrorOf, toNewPatient, usePatientForm } from "./patient-form.js";

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
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const patient = await create.mutateAsync(toNewPatient(values));
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
      <MkCard className="max-w-2xl">
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
          <PatientFields form={form} />
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
