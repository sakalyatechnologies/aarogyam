import { useNewLook } from "../../lib/new-look.js";
import { PatientPage } from "./patient-page.js";
import { Patient360 } from "./v2/patient-360.js";

/** `/patients/:id`: the redesigned Patient 360 when the New look is on, the existing page otherwise. */
export function PatientRoute() {
  const [newLook] = useNewLook();
  return newLook ? <Patient360 /> : <PatientPage />;
}
