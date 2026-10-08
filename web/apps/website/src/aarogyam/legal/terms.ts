// Aarogyam-owned. Draft: a lawyer must review before launch.
import { COMPANY, COMPANY_ADDRESS, COMPANY_ENTITY, GRIEVANCE_OFFICER, PRODUCT } from "./shared";
import type { LegalDoc } from "./types";

export const terms: LegalDoc = {
  slug: "terms",
  title: "Terms of Service for clinics",
  audience: "For clinics, hospitals and practitioners who use Aarogyam (the \"Clinic\").",
  summary: "The agreement between Sakalya Technologies and a clinic that uses the Aarogyam software.",
  sections: [
    {
      id: "agreement",
      title: "This agreement",
      blocks: [
        { kind: "p", text: `These terms are between ${COMPANY} (${COMPANY_ENTITY}), ${COMPANY_ADDRESS} ("Sakalya") and the clinic named in the application or order (the "Clinic"). They apply from the day the Clinic's access is approved or it first uses ${PRODUCT}, whichever is earlier. The person accepting them says they may bind the Clinic.` },
        { kind: "p", text: "These terms are read with the Data Processing Agreement and the Privacy Policy. If they disagree about personal data, the Data Processing Agreement wins." },
      ],
    },
    {
      id: "service",
      title: "The service",
      blocks: [
        { kind: "p", text: `${PRODUCT} is software for running a clinic: patients and their records, appointments, visits and notes, prescriptions, billing and reports, with a web portal and phone apps. We improve it continuously and may change or retire a feature; we will tell the Clinic in advance of any change that removes something it relies on.` },
        { kind: "ul", items: [
          "Pilot clinics: during the pilot the service is provided free of charge and on a best-effort basis, with no uptime promise. Pricing after the pilot will be agreed in writing before any charge starts.",
          "Support: by [email and hours]. We aim to reply within [number] working days.",
        ] },
      ],
    },
    {
      id: "accounts",
      title: "Accounts and staff",
      blocks: [
        { kind: "ul", items: [
          "The Clinic's owner chooses who may sign in and what each role may see and do. The Clinic is responsible for what its staff do in the service.",
          "Each person uses their own sign-in and keeps it private. The Clinic removes people who leave.",
          "The Clinic gives us accurate details and tells us when they change.",
        ] },
      ],
    },
    {
      id: "clinic-duties",
      title: "The Clinic's responsibilities",
      blocks: [
        { kind: "p", text: "The Clinic is the Data Fiduciary for its patients' personal data. This means the Clinic, not Sakalya, decides why and how patient data is used, and must:" },
        { kind: "ul", items: [
          "give each patient a clear notice and take consent where the law requires it, and record that in the service (Aarogyam has a consent record for this; the template notice on this site is a starting point, not legal advice);",
          "collect only what it needs, keep it accurate, and keep it no longer than needed;",
          "answer patients' requests to see, correct or erase their data, and their complaints, and publish a contact for them;",
          "get a parent's or guardian's consent for children where the law requires it;",
          "tell us at once of anything that suggests the service or an account is misused or breached;",
          "follow the laws that apply to its profession, including its record-keeping, confidentiality and advertising rules.",
        ] },
        { kind: "p", text: "Aarogyam supports clinical work; it does not give medical advice and does not replace professional judgment. Any text drafted by software, including from voice recordings, is a draft: a clinician must review it before it becomes part of the record." },
      ],
    },
    {
      id: "use",
      title: "What you may not do",
      blocks: [
        { kind: "ul", items: [
          "Use the service to break the law, or to send messages patients have not agreed to receive.",
          "Try to read another clinic's data, or to bypass the permissions, limits or security of the service.",
          "Upload malware, or content you have no right to share.",
          "Resell the service or let someone outside the Clinic use the Clinic's accounts.",
          "Use patient data from the service for any purpose other than the Clinic's own care and business.",
        ] },
      ],
    },
    {
      id: "data",
      title: "The Clinic's data",
      blocks: [
        { kind: "ul", items: [
          "The Clinic owns its data. We use it only to provide the service to the Clinic, as set out in the Data Processing Agreement.",
          "The data is kept in India (see the Privacy Policy).",
          "The Clinic can export its patient data while it has an account. Exports are logged.",
          "We keep backups so we can recover from a failure. Data deleted by the Clinic leaves backups within [number] days.",
        ] },
      ],
    },
    {
      id: "fees",
      title: "Fees and tax",
      blocks: [
        { kind: "p", text: "[Pricing, billing cycle and payment terms for paid plans. GST is added where it applies. Nothing is charged to pilot clinics.]" },
      ],
    },
    {
      id: "ip",
      title: "Ownership of the software",
      blocks: [
        { kind: "p", text: `${COMPANY} keeps all rights in ${PRODUCT}, its design and its code. The Clinic gets a limited, non-exclusive right to use it for its own clinic while these terms apply. If the Clinic gives us feedback, we may use it freely.` },
      ],
    },
    {
      id: "confidential",
      title: "Confidentiality",
      blocks: [
        { kind: "p", text: "Each side keeps the other's non-public information confidential and uses it only for this agreement, unless the law requires disclosure. Patient data is also protected by the Data Processing Agreement. Our staff can open a clinic's data only to give support the Clinic asked for, with a record of the access." },
      ],
    },
    {
      id: "warranty",
      title: "Disclaimers and liability",
      blocks: [
        { kind: "p", text: "[A lawyer should write this section. It normally says the service is provided as is, excludes indirect loss, caps Sakalya's total liability at a stated amount, and carves out what the law does not let either side exclude. Consider the cap's interaction with the penalties in the DPDP Act and the Clinic's insurance.]" },
      ],
    },
    {
      id: "indemnity",
      title: "Indemnity",
      blocks: [
        { kind: "p", text: "[A lawyer should write this section: each side's responsibility for claims caused by its own breach, in particular the Clinic's duties as Data Fiduciary and Sakalya's duties as Data Processor.]" },
      ],
    },
    {
      id: "end",
      title: "Ending the agreement",
      blocks: [
        { kind: "ul", items: [
          "The Clinic may stop at any time by telling us. We may end the agreement on [number] days' notice, or at once for serious misuse or non-payment.",
          "We may pause an account that puts patients or the service at risk, and will tell the Clinic why as soon as we can.",
          "After the end, the Clinic has [number] days to export its data. We then erase it, and tell the Clinic when we have done so, except where the law requires us to keep something.",
        ] },
      ],
    },
    {
      id: "law",
      title: "Law, disputes and notices",
      blocks: [
        { kind: "p", text: "These terms are governed by the laws of India. Disputes go first to the two sides' senior contacts; then to [arbitration seat and rules, or the courts of a named city]. Notices go to the email address in the Clinic's application, and to the Grievance Officer at " + GRIEVANCE_OFFICER.email + " for privacy matters." },
        { kind: "p", text: "We may change these terms with [number] days' notice by email. If the Clinic does not agree, it may stop using the service before the change applies." },
      ],
    },
  ],
};
