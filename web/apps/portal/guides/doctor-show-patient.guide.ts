import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "doctor-show-patient",
  title: "Show patient: explain the treatment",
  role: "doctor",
  as: "Dr Dev Rao",
  summary: "Open Show patient, walk the patient through the picture and the options, and change the plan on the spot.",
  order: 3,
  steps: [
    {
      title: "Open the visit",
      highlight: "role=button[name=\"Start next visit\"]",
      narration: "Start the visit from Today, as usual.",
      actions: [{ click: "role=button[name=\"Start next visit\"]" }],
    },
    {
      title: "Tap Show patient",
      highlight: "role=button[name=\"Show patient\"]",
      narration: "When you are ready to explain, tap Show patient. Turn the screen towards the patient.",
      actions: [{ click: "role=button[name=\"Show patient\"]" }],
    },
    {
      title: "The story cards",
      narration: "The patient sees their mouth as simple cards. Tap the arrow to go to the next card.",
      actions: [{ click: "role=button[name=\"Next card\"]" }],
    },
    {
      title: "What we found",
      highlight: "role=button[name=\"All cards\"]",
      narration: "Each tooth gets its own card, with its pictures. Tap All cards to jump to any card, such as Usual options.",
      actions: [{ click: "role=button[name=\"All cards\"]" }, { click: "css=.ps-jump:has-text(\"Usual options\") >> nth=0" }],
    },
    {
      title: "Usual options",
      highlight: "css=summary:has-text(\"Other ways to treat it\")",
      narration: "This tooth already has a treatment under way. Tap Other ways to treat it to compare the usual options.",
      actions: [{ click: "css=summary:has-text(\"Other ways to treat it\")" }],
    },
    {
      title: "Option cards",
      highlight: "css=.ps-opts",
      narration: "The options appear as cards, each with its picture. Your own suggestion comes first.",
    },
    {
      title: "Open More",
      highlight: "role=button[name=\"More\"]",
      narration: "The pictures can match the patient's own teeth. Open More.",
      actions: [{ click: "role=button[name=\"More\"]" }],
    },
    {
      title: "Match the tooth colour",
      highlight: "role=slider[name=\"Tooth colour\"]",
      narration: "Slide the tooth colour lighter or deeper until it looks like their teeth.",
      actions: [{ fill: "role=slider[name=\"Tooth colour\"]", text: "70" }, { click: "role=button[name=\"More\"]" }],
    },
    {
      title: "Go with this",
      highlight: "role=button[name=\"Go with this\"] >> nth=0",
      narration: "If the patient prefers another option, tap Go with this. The plan changes at once.",
      actions: [{ click: "role=button[name=\"Go with this\"] >> nth=0" }],
    },
    {
      title: "Undo",
      highlight: "role=button[name=\"Undo\"]",
      narration: "Undo stays on screen for a few seconds, in case you tapped the wrong card.",
      actions: [{ click: "role=button[name=\"All cards\"]" }, { click: "css=.ps-jump:has-text(\"front tooth\") >> nth=0" }],
    },
    {
      title: "Edit the tooth",
      highlight: "role=button[name=\"Edit tooth 21\"]",
      narration: "To change anything else, tap Edit. The tooth opens in a side sheet, so you never leave Show patient.",
      actions: [{ click: "role=button[name=\"Edit tooth 21\"]" }],
    },
    {
      title: "Back to the patient",
      narration: "Tap the chips you need, such as a treatment or a condition. Each one is saved at once. Then close the sheet and carry on explaining.",
    },
  ],
};
