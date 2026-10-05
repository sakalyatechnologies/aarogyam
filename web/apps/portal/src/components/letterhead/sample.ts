// moves to sakalya-web
import type { LetterheadDocument } from "@aarogyam/api-client";

/**
 * A made-up page for previews. It holds no patient data: the patient is "Sample Patient" and the
 * medicines are common ones.
 */
export const SAMPLE_PRESCRIPTION = {
  patient: "Sample Patient",
  number: "SP-0001",
  date: "12/03/2026",
  diagnosis: "Sample diagnosis",
  items: [
    {
      name: "Amoxicillin 500 mg",
      dose: "1 capsule · 1-0-1 · After food · 5 days",
    },
    {
      name: "Paracetamol 650 mg",
      dose: "1 tablet · SOS · After food · 3 days",
    },
  ],
  advice: "Warm saline rinses. Avoid very hot food for two days.",
} as const;

/** The document with sample doctors added when the clinic has none yet, so a design never previews empty. */
export function withSampleDoctors(
  document: LetterheadDocument,
): LetterheadDocument {
  if (document.doctors.length > 0) {
    return document;
  }
  return {
    ...document,
    doctors: [
      {
        name: "Dr Asha Rao",
        qualifications: "BDS, MDS",
        registration_number: "A-12345",
        specialty: null,
      },
      {
        name: "Dr Vikram Rao",
        qualifications: "BDS",
        registration_number: "A-67890",
        specialty: null,
      },
    ],
  };
}

/** A header with only the clinic's name, for when the letterhead could not be loaded: a document must still print. */
export function plainLetterhead(name: string): LetterheadDocument {
  return {
    clinic: { name, address: {} },
    letterhead: {
      mode: "template",
      template: "classic",
      show: {
        logo: false,
        doctors: false,
        registration: false,
        address: false,
        phone: false,
        email: false,
        timings: false,
        gstin: false,
      },
      doctor_ids: [],
      has_image: false,
      has_logo: false,
    },
    doctors: [],
    expires_at: "2099-01-01T00:00:00Z",
  };
}
