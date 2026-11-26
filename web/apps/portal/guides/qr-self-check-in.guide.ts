import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "qr-self-check-in",
  title: "QR self check-in",
  role: "front-desk",
  as: "Asha Kulkarni",
  summary: "Turn on the clinic QR, see what the patient fills in, and accept them into the queue.",
  order: 3,
  steps: [
    {
      title: "Open Settings",
      highlight: "css=a[href=\"/settings\"]",
      narration: "Patient QR lives in Settings. Tap Settings in the menu.",
      actions: [{ click: "css=a[href=\"/settings\"]" }],
    },
    {
      title: "Patient QR",
      highlight: "text=Patient QR >> nth=0",
      narration: "Open the Patient QR tab.",
      actions: [{ click: "text=Patient QR >> nth=0" }],
    },
    {
      title: "Turn it on",
      highlight: "role=switch[name=\"Patient check-in by QR\"]",
      narration: "Turn on patient check-in by QR. Your clinic's code appears.",
      actions: [{ click: "role=switch[name=\"Patient check-in by QR\"]" }],
    },
    {
      title: "Print the poster",
      highlight: "role=button[name=\"Print poster\"]",
      narration: "Tap Print poster, and put the poster at the front desk or on the door.",
      actions: [{ goto: "/arrive?k=h350x9v08riv24gtrsgjpr&clinic=sunrise.localtest.me" }],
    },
    {
      title: "The patient scans the code",
      highlight: "role=textbox[name=/first name/i]",
      narration: "Now the patient's side. They scan the code with their phone and see this short form. They type their name and mobile number.",
      actions: [{ fill: "role=textbox[name=/first name/i]", text: "Asha" }, { fill: "role=textbox[name=/mobile number/i]", text: "9876543210" }],
    },
    {
      title: "Why they came",
      highlight: "role=group[name=\"What brings you in\"]",
      narration: "They tap what brings them in, such as Tooth pain.",
      actions: [{ click: "role=button[name=\"Tooth pain\"]" }],
    },
    {
      title: "Consent",
      highlight: "role=checkbox[name=/i agree/i]",
      narration: "They tick that they agree to the clinic keeping their record.",
      actions: [{ click: "role=checkbox[name=/i agree/i]" }],
    },
    {
      title: "Send",
      highlight: "role=button[name=\"Continue\"]",
      narration: "Then they tap Continue.",
      actions: [{ click: "role=button[name=\"Continue\"]" }],
    },
    {
      title: "Please take a seat",
      highlight: "text=Please take a seat",
      narration: "The patient is asked to take a seat. Nobody is in the queue yet. Back at the desk.",
      actions: [{ goto: "/queue" }],
    },
    {
      title: "Waiting to check in",
      highlight: "text=1 waiting to check in",
      narration: "On the Queue, a strip shows how many patients have scanned and are waiting. Tap Review.",
      actions: [{ click: "role=button[name=\"Review\"]" }],
    },
    {
      title: "Accept as a new patient",
      highlight: "role=button[name=\"Accept\"]",
      narration: "You see what they entered. If they are new, tap Accept. A returning patient is matched to their file.",
      actions: [{ click: "role=button[name=\"Accept\"]" }, { press: "Escape" }],
    },
    {
      title: "In the queue",
      narration: "The patient is now in the queue, and the strip is gone.",
    },
  ],
};
