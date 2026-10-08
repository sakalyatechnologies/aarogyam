// Aarogyam-owned. Draft: a lawyer must review before launch.
import { COMPANY, COMPANY_ADDRESS, DATA_LOCATION, DPDP, GRIEVANCE_OFFICER, PRODUCT } from "./shared";
import type { LegalDoc } from "./types";

export const privacy: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  audience: "For everyone who visits the Aarogyam website, applies for access, or uses Aarogyam as clinic staff.",
  summary: "How Sakalya Technologies handles personal data on the Aarogyam website and in the Aarogyam clinic software.",
  sections: [
    {
      id: "who",
      title: "Who we are and our two roles",
      blocks: [
        { kind: "p", text: `${PRODUCT} is clinic software made by ${COMPANY} ("Sakalya", "we", "us"), ${COMPANY_ADDRESS}. We handle personal data in two different roles, and this policy says which applies.` },
        {
          kind: "ul",
          items: [
            "Our own role (we are the Data Fiduciary): the details of people who visit our website, ask for access, or sign in as clinic staff or Sakalya staff. We decide why and how that data is used.",
            "A clinic's role for its patients (we are the Data Processor): each clinic decides why patient data is collected and what is done with it. We store and process it only for the clinic, on its instructions, under a data processing agreement. The clinic is the Data Fiduciary for its patients.",
          ],
        },
        { kind: "note", text: "If you are a patient: your clinic is responsible for your data. Read the clinic's own privacy notice, and send requests about your records to the clinic. We will help the clinic answer you." },
      ],
    },
    {
      id: "collect",
      title: "What we collect",
      blocks: [
        {
          kind: "table",
          head: ["Who", "What", "Why"],
          rows: [
            ["Website visitors", "The pages you open and technical data your browser sends (IP address, browser type). Your theme choice is kept in your own browser.", "To show the site, keep it secure and fix faults."],
            ["People who ask for access", "Name, email, phone, role, clinic name and city, registration number, specialty.", "To review your request and contact you."],
            ["Clinic staff and Sakalya staff", "Name, email, role, sign-in records, devices and sessions.", "To sign you in, apply your permissions and keep an audit trail."],
            ["Patients (as the clinic's processor)", "Whatever the clinic records: identity and contact details, visits, notes, prescriptions, files, bills, consent records.", "Only to run the clinic's service for the clinic."],
          ],
        },
        { kind: "p", text: "We do not put patient data in our logs, web addresses, notifications or analytics. Logs carry identifiers, not names, phone numbers or diagnoses." },
      ],
    },
    {
      id: "why",
      title: "Why we may use it",
      blocks: [
        { kind: "p", text: `We use personal data where you have given consent, or for the limited purposes ${DPDP} allows without consent, such as meeting a legal obligation or responding to a medical emergency. You may withdraw consent at any time; withdrawing does not undo what was done before. We ask for consent in plain language and only for a stated purpose.` },
        { kind: "p", text: "We do not sell personal data. We do not use patient data to advertise, to train AI models, or for any purpose of our own." },
      ],
    },
    {
      id: "share",
      title: "Who else handles it",
      blocks: [
        { kind: "p", text: "We use a small number of service providers (sub-processors) who handle data for us under contract. We list them in the data processing agreement and tell clinics before adding one." },
        {
          kind: "table",
          head: ["Provider", "What it does", "Where"],
          rows: [
            ["Supabase", "Database, sign-in, file storage", "Mumbai, India (ap-south-1)"],
            ["Google Cloud (Cloud Run)", "Runs the Aarogyam server", "Mumbai, India (asia-south1)"],
            ["Cloudflare", "Hosts the website and web apps, DNS, edge security", "[Confirm: global edge network; no patient data is stored there]"],
            ["Resend", "Sends account and notification email", "[Confirm the region and whether any data leaves India]"],
          ],
        },
        { kind: "p", text: "We share personal data with authorities only when the law requires it. Clinics decide whether to share a patient's records with other clinics, and need the patient's permission to do so." },
      ],
    },
    {
      id: "where",
      title: "Where the data is kept",
      blocks: [
        { kind: "p", text: `Patient and account data is stored in India: ${DATA_LOCATION}. Backups stay with the same providers. The website's fonts load from Google Fonts, which means your browser contacts Google when you open our pages.` },
      ],
    },
    {
      id: "keep",
      title: "How long we keep it",
      blocks: [
        { kind: "ul", items: [
          "Patient records: for as long as the clinic keeps them, and then as the clinic tells us. The clinic's retention schedule decides this, and we give clinics a report of records past their retention period.",
          "Access requests that are not approved: [period, for example 12 months], then deleted.",
          "Staff account data: while the account is active, then as long as the law or the audit trail needs it.",
          "The audit trail of who changed or viewed a record: kept as long as the record, so a clinic can answer a patient's question about access.",
        ] },
        { kind: "p", text: "When a purpose is over, or consent is withdrawn and no law requires us to keep the data, we erase it or make it anonymous." },
      ],
    },
    {
      id: "security",
      title: "How we protect it",
      blocks: [
        { kind: "ul", items: [
          "Each clinic's data is separated from every other clinic's in the database itself, not only in the application.",
          "Encryption in transit; encryption at rest by our hosting providers.",
          "Every route checks the permission of the signed-in person. Clinics choose what each role can see.",
          "A record of who viewed or changed patient data.",
          "A second step (an authenticator code) for Sakalya staff who can use the support console.",
          "Backups, with a restore test before launch.",
        ] },
        { kind: "p", text: "No system is perfectly secure. If a breach affects personal data, we will tell the affected clinic quickly, and the Data Protection Board of India and affected people as the law requires." },
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      blocks: [
        { kind: "p", text: `Under ${DPDP} you may ask for a summary of the personal data held about you and who it was shared with, ask for it to be corrected, completed, updated or erased, withdraw consent, use the grievance process below, and nominate someone to exercise these rights if you die or cannot act for yourself.` },
        { kind: "p", text: "For data we hold in our own role, write to the Grievance Officer. For patient records, ask your clinic; we will help the clinic do it." },
      ],
    },
    {
      id: "children",
      title: "Children",
      blocks: [
        { kind: "p", text: "The law treats anyone under 18 as a child and requires a parent or lawful guardian's verifiable consent before their data is processed, with some exceptions for health care. Clinics record who consented for a child patient. Our own website is for adults and clinic staff." },
      ],
    },
    {
      id: "grievance",
      title: "Grievance Officer and complaints",
      blocks: [
        { kind: "table", head: ["Grievance Officer", ""], rows: [
          ["Name", GRIEVANCE_OFFICER.name],
          ["Email", GRIEVANCE_OFFICER.email],
          ["Phone", GRIEVANCE_OFFICER.phone],
          ["Available", GRIEVANCE_OFFICER.hours],
          ["Post", COMPANY_ADDRESS],
        ] },
        { kind: "p", text: "We will acknowledge a complaint within [number] days and answer within [number] days. If you are not satisfied, you may complain to the Data Protection Board of India once it is in place and after you have used this process." },
      ],
    },
    {
      id: "changes",
      title: "Changes",
      blocks: [{ kind: "p", text: "We will post changes here and tell clinics about material ones by email before they apply." }],
    },
  ],
};
