import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "prescription-finish",
  title: "Prescriptions and finishing the visit",
  role: "doctor",
  as: "Dr Dev Rao",
  summary: "Write a prescription from a medicine set, issue it, and end the visit.",
  order: 1,
  steps: [
    {
      title: "Open the patient",
      highlight: "css=a[href=\"/patients\"]",
      narration: "Open Patients from the menu, then tap the patient you are about to see.",
      actions: [{ click: "css=a[href=\"/patients\"]" }],
    },
    {
      title: "Pick the patient",
      highlight: "css=a[href*=\"/patients/\"]:has-text(\"Aakash\")",
      narration: "You can also search by name. Tap the patient's row to open their file.",
      actions: [{ click: "css=a[href*=\"/patients/\"]:has-text(\"Aakash\")" }],
    },
    {
      title: "Start the visit",
      highlight: "role=button[name=\"Start visit\"]",
      narration: "On the patient's file, tap Start visit. The timer starts, and the notes panel opens on the right.",
      actions: [{ click: "role=button[name=\"Start visit\"]" }],
    },
    {
      title: "Note the complaint",
      highlight: "role=button[name=\"Toothache\"]",
      narration: "Tap a chip to note the complaint. You can also type, or speak your note.",
      actions: [{ click: "role=button[name=\"Toothache\"]" }],
    },
    {
      title: "Medicine sets",
      highlight: "role=button[name=\"Dental infection / abscess\"]",
      narration: "Scroll to Prescription. A medicine set fills in the usual medicines in one tap. Choose the set that fits.",
      actions: [{ click: "role=button[name=\"Dental infection / abscess\"]" }],
    },
    {
      title: "Check the medicines",
      highlight: "css=input[placeholder=\"Medicine name\"]",
      narration: "Check each medicine, its dose, how often, and when to take it. Change anything you need, or remove a line.",
    },
    {
      title: "Issue the prescription",
      highlight: "role=button[name=\"Issue prescription\"]",
      narration: "When it looks right, tap Issue prescription. The patient is sent a link by email or message.",
      actions: [{ click: "role=button[name=\"Issue prescription\"]" }],
    },
    {
      title: "Tell the patient the PIN",
      highlight: "text=Tell the patient this PIN",
      narration: "The patient needs this PIN to open the prescription. Tell it to them, or write it on their copy. It is shown only once.",
      actions: [{ press: "Home" }],
    },
    {
      title: "End the visit",
      highlight: "role=button[name=\"End visit\"]",
      narration: "When you are done with the patient, tap End visit.",
      actions: [{ click: "role=button[name=\"End visit\"]" }],
    },
    {
      title: "On to payment",
      highlight: "role=button[name=\"Collect payment\"]",
      narration: "The visit is closed. Now you or the front desk can tap Collect payment, or Send for payment to the patient's phone.",
    },
  ],
};

