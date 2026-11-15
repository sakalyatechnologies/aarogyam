// Aarogyam-owned. Draft: the store listings link here as the support page.
import { GRIEVANCE_OFFICER, PRODUCT, SUPPORT } from "./shared";
import type { LegalDoc } from "./types";

export const support: LegalDoc = {
  slug: "support",
  title: "Aarogyam support",
  audience: "For clinic staff who use the Aarogyam app, portal or clinic website.",
  summary: `How to get help with ${PRODUCT}: signing in, the app, your clinic's setup and your account.`,
  sections: [
    {
      id: "contact",
      title: "Contact us",
      blocks: [
        { kind: "table", head: ["", ""], rows: [
          ["Email", SUPPORT.email],
          ["WhatsApp", SUPPORT.whatsapp],
          ["Hours", SUPPORT.hours],
        ] },
        { kind: "p", text: "Tell us your clinic's name and what you were doing. Never send patient names, phone numbers or photos of records: a screenshot of the screen without patient details is enough." },
      ],
    },
    {
      id: "common",
      title: "Common questions",
      blocks: [
        { kind: "ul", items: [
          "I don't get the sign-in code: check spam, wait a minute and ask for a new code, or ask your clinic's owner to check your email address in Team & roles.",
          "I can't see a screen my colleague sees: what you can see depends on your role. The clinic owner changes roles in Settings, Team & roles.",
          "I changed phones: sign in on the new phone; the old one is signed out from Settings, Sessions.",
        ] },
      ],
    },
    {
      id: "account",
      title: "Your account and your data",
      blocks: [
        { kind: "p", text: "To delete your account, see Delete your Aarogyam account (/account-deletion). For questions about personal data, write to the Grievance Officer:" },
        { kind: "p", text: GRIEVANCE_OFFICER.email },
      ],
    },
  ],
};
