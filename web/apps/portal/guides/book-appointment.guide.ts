import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "book-appointment",
  title: "Book an appointment",
  role: "front-desk",
  as: "Farah Shaikh",
  summary: "Find the patient, pick a doctor and a time, and book.",
  order: 1,
  steps: [
    {
      title: "Start a booking",
      highlight: "role=button[name=\"Schedule an appointment\"]",
      narration: "To book an appointment, tap New appointment. You can do this from any page.",
      actions: [{ click: "role=button[name=\"Schedule an appointment\"]" }],
    },
    {
      title: "Find the patient",
      highlight: "css=input[placeholder^=\"Name, clinic\"]",
      narration: "Patient comes first. Type a name, a clinic number or a phone number. The matching patients appear as you type.",
      actions: [{ fill: "css=input[placeholder^=\"Name, clinic\"]", text: "Aakash" }],
    },
    {
      title: "Pick the patient",
      highlight: "role=button[name=/Aakash Kulkarni/]",
      narration: "Tap the right person in the list. Check the age and the file number to be sure it is the right one. If they are new, tap New patient instead and add them first.",
      actions: [{ click: "role=button[name=/Aakash Kulkarni/]" }],
    },
    {
      title: "Choose the doctor",
      highlight: "role=dialog >> select >> nth=0",
      narration: "Now choose the doctor. Once you do, the free times for that doctor appear below.",
      actions: [{ select: "role=dialog >> select >> nth=0", label: "Dr Dev Rao" }],
    },
    {
      title: "Set the time",
      highlight: "css=input[placeholder=\"HH:MM\"]",
      narration: "Type the start time. The date is today unless you change it. Use the duration list for a longer visit.",
      actions: [{ fill: "css=input[placeholder=\"HH:MM\"]", text: "17:30" }],
    },
    {
      title: "What kind of visit",
      highlight: "role=dialog >> select >> nth=2",
      narration: "Choose the kind of visit: new patient, follow-up, procedure or emergency. This helps the doctor prepare.",
      actions: [{ select: "role=dialog >> select >> nth=2", label: "Follow-up" }],
    },
    {
      title: "Add details",
      highlight: "text=Add details",
      narration: "If you need to, tap Add details to note the reason for the visit. This is optional, so you can skip it when you are in a hurry.",
    },
    {
      title: "Book it",
      highlight: "role=button[name=\"Book appointment\"]",
      narration: "Check the details, then tap Book appointment.",
      actions: [{ click: "role=button[name=\"Book appointment\"]" }],
    },
    {
      title: "On the calendar",
      narration: "Done. A message at the bottom confirms it. The appointment is now on the calendar, and on the doctor's Today screen. The patient can be reminded by message before the visit.",
    },
  ],
};

