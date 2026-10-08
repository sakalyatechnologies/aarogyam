// Aarogyam-owned. Draft template: a lawyer must review before a clinic uses it.
import { DPDP, PRODUCT } from "./shared";
import type { LegalDoc } from "./types";

export const notice: LegalDoc = {
  slug: "patient-notice",
  title: "Patient privacy notice (template)",
  audience: "For clinics to adapt and show to patients. Fill in the square brackets, then print or display it.",
  summary: "A plain-language privacy notice a clinic can show to its patients, with the consent choices Aarogyam records.",
  sections: [
    {
      id: "who",
      title: "Who looks after your information",
      blocks: [
        { kind: "p", text: "[Clinic name] ([address]) keeps a record of your visits and care. Under the Digital Personal Data Protection Act, 2023, we are the \"Data Fiduciary\": we decide why and how your information is used, and we are responsible for it." },
        { kind: "p", text: `We keep your records in ${PRODUCT}, software run by Sakalya Technologies, which stores them for us in India and may use them only for us.` },
        { kind: "table", head: ["Notice version", "Date"], rows: [["[v1 2026-10: write the label staff will record, for example v1 and the month]", "[date]"]] },
      ],
    },
    {
      id: "what",
      title: "What we collect",
      blocks: [
        { kind: "ul", items: [
          "Who you are: name, date of birth or age, sex, phone number, email, address, and any number we give you.",
          "Your health: why you came, examinations, diagnoses, treatment, prescriptions, X-rays, photographs, test reports and notes by our doctors.",
          "Money: bills and payments.",
          "Your choices: the permissions you give us, and when you change your mind.",
        ] },
        { kind: "p", text: "If you are a child or cannot decide for yourself, a parent or lawful guardian gives permission for you and we note who." },
      ],
    },
    {
      id: "why",
      title: "Why we use it",
      blocks: [
        { kind: "ul", items: [
          "To treat you and keep a medical record, as doctors must (this is the reason we need your permission to keep your record).",
          "To book appointments and to bill you.",
          "To remind you of appointments and check-ups, if you agree.",
          "To send offers, only if you agree separately. Saying no does not change your care.",
          "To share your records with another doctor or clinic you name, only if you agree.",
          "To use your information without your name for research or teaching, only if you agree.",
          "To follow the law, or to protect your life in an emergency.",
        ] },
      ],
    },
    {
      id: "who-sees",
      title: "Who can see it",
      blocks: [
        { kind: "p", text: "Our doctors and staff see what their job needs; for example, reception does not see clinical notes unless we allow it. Sakalya Technologies stores the information for us. We do not sell your information. We do not share it with anyone else without your permission unless the law requires it." },
      ],
    },
    {
      id: "where",
      title: "Where it is kept and for how long",
      blocks: [
        { kind: "p", text: "Your records are stored in India (Mumbai). We keep medical records for [number] years after your last visit, or longer if the law requires, and [number] years for bills. Then we delete them or remove your name." },
      ],
    },
    {
      id: "rights",
      title: "Your rights",
      blocks: [
        { kind: "ul", items: [
          "Ask what information we hold about you and who we shared it with.",
          "Ask us to correct or complete it.",
          "Ask us to erase it. We may have to keep medical records for the period the law sets; we will tell you.",
          "Take back any permission you gave, at any time. Your past care is not affected. You can tell us on paper, in words at the front desk, or in the app.",
          "Name someone to use these rights for you if you cannot.",
          "Complain to us, and if we do not solve it, to the Data Protection Board of India.",
        ] },
        { kind: "p", text: "To use any right, ask at reception or contact: [Name of the clinic's contact person for privacy], [phone], [email]." },
      ],
    },
    {
      id: "choices",
      title: "Your choices (tick and sign)",
      blocks: [
        { kind: "p", text: "Staff record these in Aarogyam with the notice version above, the date, and how you gave them (paper, in words, or app)." },
        { kind: "ul", items: [
          "☐ Care and records. I agree that the clinic keeps my record and treats me. (Needed for us to treat you.)",
          "☐ Reminders. I agree to appointment and check-up reminders by SMS, WhatsApp or email.",
          "☐ Offers. I agree to receive offers and promotions.",
          "☐ Sharing. I agree that my records may be shared with: [name of the doctor or clinic].",
          "☐ Research. I agree that my information, without my name, may be used for research or teaching.",
        ] },
        { kind: "table", head: ["Patient or guardian", "Staff member", "Date"], rows: [["[Name and signature]", "[Name]", "[Date]"]] },
      ],
    },
    {
      id: "law",
      title: "About this notice",
      blocks: [
        { kind: "p", text: `This notice follows ${DPDP}. It is a template: the clinic must check it matches what it really does before showing it.` },
      ],
    },
  ],
};
