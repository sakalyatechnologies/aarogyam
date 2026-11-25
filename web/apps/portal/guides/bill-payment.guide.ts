import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "bill-payment",
  title: "Make a bill and collect a payment",
  role: "billing",
  as: "Asha Kulkarni",
  summary: "Find what is owed, take the money, and give the receipt.",
  order: 1,
  steps: [
    {
      title: "Open Billing",
      highlight: "css=a[href=\"/billing\"]",
      narration: "Open Billing from the menu. This is where every bill and payment lives.",
      actions: [{ click: "css=a[href=\"/billing\"]" }],
    },
    {
      title: "Who owes money",
      highlight: "text=To collect",
      narration: "On the left, To collect lists the patients who still owe money, with the amount. On the right are all the bills. Tap a status to filter them.",
    },
    {
      title: "Open a bill",
      highlight: "role=button[name=/Open bill SD\\/26-27\\/000002 for/]",
      narration: "Tap a bill to see what it is made of. You will see each line, what was paid, and what is left.",
      actions: [{ click: "role=button[name=/Open bill SD\\/26-27\\/000002 for/]" }],
    },
    {
      title: "Read the bill",
      highlight: "role=dialog",
      narration: "The balance is at the bottom of the totals. You can print the bill, or send it by WhatsApp or email.",
    },
    {
      title: "Collect",
      highlight: "role=dialog >> role=button[name=\"Collect\"]",
      narration: "To take a payment, tap Collect.",
      actions: [{ click: "role=dialog >> role=button[name=\"Collect\"]" }],
    },
    {
      title: "Amount",
      highlight: "role=dialog >> input >> nth=0",
      narration: "The amount starts as the full balance. If the patient pays part now, type the smaller amount.",
    },
    {
      title: "How they paid",
      highlight: "role=button[name=\"UPI\"]",
      narration: "Choose how they paid: cash, UPI or card.",
      actions: [{ click: "role=button[name=\"UPI\"]" }],
    },
    {
      title: "Record it",
      highlight: "role=button[name=/Record/]",
      narration: "Tap Record. The payment is saved and a receipt is made.",
      actions: [{ click: "role=button[name=/Record/]" }, { wait: 800 }],
    },
    {
      title: "Receipt",
      highlight: "role=dialog",
      narration: "The bill now shows as paid, with the receipt number. You can print the receipt or send it to the patient.",
      actions: [{ press: "Escape" }],
    },
    {
      title: "A new bill",
      highlight: "role=link[name=\"New bill\"]",
      narration: "To make a bill from scratch, tap New bill, choose the patient, add the services, and issue it.",
    },
  ],
};

