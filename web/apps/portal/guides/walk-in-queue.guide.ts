import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "walk-in-queue",
  title: "Walk-in, the queue and calling a patient in",
  role: "front-desk",
  as: "Farah Shaikh",
  summary: "Register someone with no booking, then run the waiting list.",
  order: 2,
  steps: [
    {
      title: "Open the queue",
      highlight: "css=a[href=\"/queue\"]",
      narration: "The Queue is your front desk board. Tap it in the menu.",
      actions: [{ click: "css=a[href=\"/queue\"]" }],
    },
    {
      title: "Add to queue",
      highlight: "role=button[name=\"Add to queue\"]",
      narration: "Patients move across the board as they wait, go to the chair and finish. To add someone, tap Add to queue.",
      actions: [{ click: "role=button[name=\"Add to queue\"]" }],
    },
    {
      title: "Walk-in or booking",
      highlight: "role=button[name=/Register a walk-in/]",
      narration: "If the patient has a booking today, choose Check in a booking. With no booking, choose Register a walk-in.",
      actions: [{ click: "role=button[name=/Register a walk-in/]" }],
    },
    {
      title: "Mobile number",
      highlight: "role=dialog >> input >> nth=0",
      narration: "Start with the mobile number. If the family is already registered, you can pick the right person from the list.",
      actions: [{ fill: "role=dialog >> input >> nth=0", text: "9876501234" }],
    },
    {
      title: "Someone new",
      highlight: "role=button[name=/Someone new/]",
      narration: "If nobody has this number yet, tap Someone new to register them.",
      actions: [{ click: "role=button[name=/Someone new/]" }],
    },
    {
      title: "Name",
      highlight: "role=dialog >> input >> nth=1",
      narration: "For a new patient, type the name.",
      actions: [{ fill: "role=dialog >> input >> nth=1", text: "Rohan Patil" }],
    },
    {
      title: "Age and sex",
      highlight: "role=group[name=\"Sex\"]",
      narration: "Add the age in years, and tap the sex. An estimate is fine for age.",
      actions: [{ fill: "role=dialog >> input >> nth=2", text: "34" }, { click: "role=group[name=\"Sex\"] >> role=button[name=\"Male\"]" }],
    },
    {
      title: "Reason for visit",
      highlight: "role=group[name=\"Reason for visit\"]",
      narration: "Tap the reason for the visit, such as toothache. This is optional but helps the doctor.",
      actions: [{ click: "role=group[name=\"Reason for visit\"] >> role=button >> nth=0" }, { click: "role=button[name=\"Next\"]" }],
    },
    {
      title: "Health",
      highlight: "role=group[name=\"Allergies\"]",
      narration: "Next, ask about allergies. Tap the ones the patient has, or tap No known allergies.",
      actions: [{ click: "role=button[name=/No known allergies/]" }, { click: "role=button[name=\"Next\"]" }],
    },
    {
      title: "Consent",
      highlight: "role=dialog",
      narration: "Last, take consent. Read the points to the patient, tick them, then tap Add to queue.",
      actions: [{ click: "role=button[name=\"Add to queue\"]" }],
    },
    {
      title: "On the board",
      highlight: "xpath=//li[.//*[normalize-space(text())=\"Rohan Patil\"]]",
      narration: "The patient now waits on the board with a token number. Booked patients and walk-ins sit in the same list, in the order they arrived.",
    },
    {
      title: "Send to the chair",
      highlight: "xpath=//li[.//*[normalize-space(text())=\"Rohan Patil\"]]//button[normalize-space()=\"To chair\"]",
      narration: "When the doctor is ready, tap To chair and the patient moves to the In chair column. After the visit they go to Ready to bill, then Done. If someone leaves unseen, tap Left.",
      actions: [{ click: "xpath=//li[.//*[normalize-space(text())=\"Rohan Patil\"]]//button[normalize-space()=\"To chair\"]" }],
    },
  ],
};

