import { visitId as visitIdSchema, type Invoice, type InvoiceLine, type LetterheadDocument } from "@aarogyam/api-client";

import { usePractitioners, useVisit } from "../../queries.js";

/** The doctor a bill names: who saw the patient on the visit it bills. */
export interface BillDoctor {
  name: string;
  qualifications: string | undefined;
  registration: string | undefined;
}

const present = (text: string | null | undefined): text is string => text != null && text.trim() !== "";

/**
 * The treating doctor and the teeth treated, from the visit a bill links (`encounter_id`). Uses only what the API returns
 * already: the visit's clinician, matched to a practitioner (or a letterhead doctor of the same name) for the registration
 * number. A bill with no visit, or a visit the role can't read, names no doctor. `settled` turns true once nothing is loading.
 */
export function useBillDoctor(invoice: Invoice | undefined, letterheadDoctors: LetterheadDocument["doctors"] = []) {
  const parsed = visitIdSchema.safeParse(invoice?.encounter_id ?? undefined);
  const visit = useVisit(parsed.success ? parsed.data : undefined);
  const practitioners = usePractitioners();
  const detail = visit.data;

  let doctor: BillDoctor | undefined;
  if (detail !== undefined) {
    const clinician = detail.visit.clinician;
    const practitioner = practitioners.data?.items.find((p) => p.membership_id === clinician.id);
    const name = practitioner?.display_name ?? clinician.name;
    const onLetterhead = letterheadDoctors.find((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase());
    const qualifications = practitioner?.qualifications ?? onLetterhead?.qualifications;
    const registration = practitioner?.registration_number ?? onLetterhead?.registration_number;
    doctor = { name, qualifications: present(qualifications) ? qualifications : undefined, registration: present(registration) ? registration : undefined };
  }

  const teeth = new Map<string, number>();
  for (const procedure of detail?.procedures ?? []) {
    if (procedure.tooth != null) teeth.set(procedure.id, procedure.tooth);
  }
  const toothOf = (line: InvoiceLine): number | undefined => (line.procedure_id == null ? undefined : teeth.get(line.procedure_id));

  return { doctor, toothOf, settled: !visit.isLoading && !practitioners.isLoading };
}
