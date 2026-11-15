// Aarogyam-owned. Draft: the store listings link here (Google Play needs a web page for deletion requests).
import { COMPANY, PRODUCT, SUPPORT } from "./shared";
import type { LegalDoc } from "./types";

export const accountDeletion: LegalDoc = {
  slug: "account-deletion",
  title: "Delete your Aarogyam account",
  audience: "For clinic staff who sign in to the Aarogyam app or portal.",
  summary: `How to delete your ${PRODUCT} sign-in account, in the app or by asking us, and what is deleted and what the clinic keeps.`,
  sections: [
    {
      id: "in-app",
      title: "Delete it in the app",
      blocks: [
        { kind: "ol", items: [
          `Open the ${PRODUCT} app and sign in.`,
          "Go to Profile, then Account, then Delete account.",
          "Confirm. You are signed out on every device straight away.",
        ] },
        { kind: "note", text: "If you are the only owner of a clinic, make another member an owner first (Settings, Team & roles). The app tells you which clinics need this." },
      ],
    },
    {
      id: "by-request",
      title: "Ask us to delete it",
      blocks: [
        { kind: "p", text: `If you can't use the app, email ${SUPPORT.email} from the address you sign in with, with the subject "Delete my ${PRODUCT} account". We check that the request comes from you, then delete the account within [number] days and email you when it is done.` },
      ],
    },
    {
      id: "deleted",
      title: "What is deleted",
      blocks: [
        { kind: "ul", items: [
          "Your sign-in account, so nobody can sign in as you.",
          "Your name, email address and phone number on your profile.",
          "Your devices, sessions and notification tokens.",
          "Your access to every clinic you belonged to.",
        ] },
      ],
    },
    {
      id: "kept",
      title: "What the clinic keeps",
      blocks: [
        { kind: "p", text: "Records you made while working at a clinic belong to that clinic, and the law requires clinics to keep complete medical records. So patient notes, prescriptions, bills and the clinic's record of who signed them stay with the clinic, under its retention schedule." },
        { kind: "p", text: `The audit trail of who viewed or changed patient records is kept as long as those records, so a clinic can answer a patient's questions. It holds an identifier, not your name, once your account is deleted.` },
      ],
    },
    {
      id: "patients",
      title: "If you are a patient",
      blocks: [
        { kind: "p", text: `Your medical records belong to your clinic, not to ${COMPANY}. Ask your clinic to see, correct or delete them; we help the clinic do it. When patient accounts come to the ${PRODUCT} app, you will be able to delete your sign-in there too.` },
      ],
    },
  ],
};
