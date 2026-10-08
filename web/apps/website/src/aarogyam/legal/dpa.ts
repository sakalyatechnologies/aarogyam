// Aarogyam-owned. Draft outline: a lawyer must review and complete before launch.
import { COMPANY, DATA_LOCATION, DPDP, PRODUCT } from "./shared";
import type { LegalDoc } from "./types";

export const dpa: LegalDoc = {
  slug: "dpa",
  title: "Data Processing Agreement (outline)",
  audience: "For clinics (the Data Fiduciary). Sakalya Technologies is the Data Processor.",
  summary: "An outline of the contract under which Sakalya processes patient data for a clinic. DPDP Act, section 8(2).",
  sections: [
    {
      id: "parties",
      title: "1. Parties and purpose",
      blocks: [
        { kind: "p", text: `This agreement is between the clinic named in the order (the "Fiduciary") and ${COMPANY} (the "Processor"). Under ${DPDP}, a Data Fiduciary may engage a Data Processor to process personal data on its behalf only under a valid contract. This is that contract for ${PRODUCT}.` },
        { kind: "note", text: "Outline only. Each numbered section says what the final clause must cover. Square brackets are choices to make." },
      ],
    },
    {
      id: "scope",
      title: "2. What is processed, and why",
      blocks: [
        {
          kind: "table",
          head: ["Item", "Description"],
          rows: [
            ["Subject and purpose", "Hosting and operating the Aarogyam software so the Fiduciary can run its clinic: records, appointments, prescriptions, billing, consent records, messages, reports."],
            ["People concerned", "The Fiduciary's patients and their contacts; the Fiduciary's staff."],
            ["Kinds of data", "Identity and contact details; health data (visits, notes, diagnoses, prescriptions, charts, images, reports); bills and payments; consent and access records; staff account data."],
            ["Nature of processing", "Storing, retrieving, displaying, backing up, exporting, and sending messages the Fiduciary asks for."],
            ["Duration", "While the Fiduciary has an account, plus the return and deletion period in section 12."],
          ],
        },
      ],
    },
    {
      id: "instructions",
      title: "3. Instructions",
      blocks: [
        { kind: "ul", items: [
          "The Processor acts only on the Fiduciary's documented instructions: this agreement, the settings and actions of the Fiduciary's staff in the software, and later written instructions.",
          "The Processor uses the data for no purpose of its own, does not sell it, does not use it to train AI models, and does not combine it with other clinics' data.",
          "The Processor tells the Fiduciary if it thinks an instruction breaks the law.",
        ] },
      ],
    },
    {
      id: "staff",
      title: "4. People and confidentiality",
      blocks: [
        { kind: "p", text: "Only Processor staff who need access to give support or run the service may open the Fiduciary's data, all under a confidentiality duty. Support access is by the support console, needs a second authentication step, and is recorded." },
      ],
    },
    {
      id: "security",
      title: "5. Security measures",
      blocks: [
        { kind: "p", text: "The Processor keeps reasonable security safeguards, at least these:" },
        { kind: "ul", items: [
          "Tenant separation: every clinic's data is separated in the database by row-level security and keys that include the clinic, tested for cross-clinic access.",
          "Access control: permissions checked on every route; roles chosen by the Fiduciary; second step (TOTP) for Processor staff in the console.",
          "Encryption in transit; encryption at rest by the hosting providers.",
          "Audit trail: a record of who viewed and who changed patient data, kept as long as the data.",
          "No patient data in logs, web addresses, notifications or analytics.",
          "Backups and a tested restore.",
          "Changes to the system reviewed and tested before release; secrets kept out of the code.",
        ] },
        { kind: "note", text: "[A lawyer and the Processor's engineers should agree a security annex; keep it to what is true and can be shown.]" },
      ],
    },
    {
      id: "subprocessors",
      title: "6. Sub-processors",
      blocks: [
        { kind: "p", text: "The Fiduciary agrees the Processor may use the sub-processors below. The Processor has a contract with each that gives the same protection as this one, stays responsible for them, and tells the Fiduciary [30] days before adding or replacing one. The Fiduciary may object on reasonable grounds; if the Processor cannot meet the objection, the Fiduciary may end the agreement." },
        {
          kind: "table",
          head: ["Sub-processor", "Role", "Location"],
          rows: [
            ["Supabase", "Database, sign-in, file storage", "Mumbai, India (ap-south-1)"],
            ["Google Cloud", "Server (Cloud Run)", "Mumbai, India (asia-south1)"],
            ["Cloudflare", "Website hosting, DNS, edge security; no patient data stored", "[Confirm]"],
            ["Resend", "Email delivery for account and notification email", "[Confirm]"],
          ],
        },
      ],
    },
    {
      id: "location",
      title: "7. Where the data is",
      blocks: [
        { kind: "p", text: `Patient data is stored in India: ${DATA_LOCATION}. The Processor will not move patient data outside India without the Fiduciary's written agreement and compliance with the law on transfers (DPDP Act, section 16).` },
      ],
    },
    {
      id: "rights",
      title: "8. Patients' requests",
      blocks: [
        { kind: "p", text: "The Processor gives the Fiduciary the tools to find, export, correct and erase a patient's data, and the consent record, and helps within [number] working days if the Fiduciary asks. A patient who writes to the Processor is sent back to the Fiduciary, unless the law says otherwise." },
      ],
    },
    {
      id: "breach",
      title: "9. Personal data breach",
      blocks: [
        { kind: "p", text: "The Processor tells the Fiduciary without undue delay, and within [48] hours of becoming aware, of a breach affecting the Fiduciary's data, with what it knows: what happened, which data, the likely effect, what has been done, and a contact. It helps the Fiduciary give the notices the law requires to the Data Protection Board of India and to affected patients, and keeps the Fiduciary informed until the matter is closed." },
      ],
    },
    {
      id: "retention",
      title: "10. Retention and erasure during the term",
      blocks: [
        { kind: "p", text: "The Fiduciary sets how long each kind of record is kept. The Processor provides a report of records past their retention period, and erases or anonymises records when the Fiduciary tells it to, unless the law requires them to be kept. Erased data leaves backups within [number] days." },
      ],
    },
    {
      id: "audit",
      title: "11. Information and audits",
      blocks: [
        { kind: "p", text: "The Processor gives the Fiduciary the information it reasonably needs to check compliance, and allows an audit [once a year, or after a breach] on [number] days' notice, during working hours, limited to this service, at the Fiduciary's cost, under confidentiality." },
      ],
    },
    {
      id: "end",
      title: "12. Return and deletion at the end",
      blocks: [
        { kind: "p", text: "At the end the Processor returns the Fiduciary's data in a common format on request within [30] days, then erases it and confirms in writing, except where the law requires it to be kept, in which case it stays protected and is used for nothing else." },
      ],
    },
    {
      id: "liability",
      title: "13. Liability, term and law",
      blocks: [
        { kind: "p", text: "[Liability: see the Terms of Service; a lawyer should settle whether data protection claims have their own cap.] This agreement lasts as long as the Processor processes the Fiduciary's data. It is governed by the laws of India, with the same dispute process as the Terms of Service." },
      ],
    },
  ],
};
