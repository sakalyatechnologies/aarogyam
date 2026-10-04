import { useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Card, PageHeader } from "@sakalya/ui";

import { PatientPicker } from "../../components/patient-picker.js";
import { patientPath } from "../../lib/patients.js";

/** Entry point: find the patient, then see or write their prescriptions. */
export function PrescriptionsPage() {
  useDocumentTitle("Prescriptions", "Aarogyam");
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Prescriptions" subtitle="Find the patient" />
      <Card className="max-w-xl">
        <PatientPicker
          onChoose={(patient) => {
            void navigate(`${patientPath(patient)}/prescriptions`);
          }}
        />
      </Card>
    </>
  );
}
