import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "doctor-tooth-chart",
  title: "Open a visit, chart a tooth and record what you found",
  role: "doctor",
  as: "Dr Dev Rao",
  summary: "Start the visit from Today, plan a treatment in one tap, and record a finding on the chart.",
  order: 2,
  steps: [
    {
      title: "Open the visit from Today",
      highlight: "role=button[name=\"Start next visit\"]",
      narration: "Today shows who is waiting. Tap Start next visit to bring in the next patient and open their visit.",
      actions: [{ click: "role=button[name=\"Start next visit\"]" }],
    },
    {
      title: "The dental chart",
      highlight: "css=[data-tooth=\"36\"]",
      narration: "The visit is open and the timer is running. The dental chart shows every tooth. Teeth with treatment planned or done are marked.",
    },
    {
      title: "Tap a tooth",
      highlight: "css=[data-tooth=\"36\"]",
      narration: "Tap the tooth you are looking at.",
      actions: [{ click: "css=[data-tooth=\"36\"]" }],
    },
    {
      title: "One-tap treatment",
      highlight: "role=group[name=\"Plan a treatment\"]",
      narration: "The tooth panel opens. To plan a treatment, tap one chip, such as Root canal or Crown. It is saved at once, and you can tap Undo.",
      actions: [{ click: "role=group[name=\"Plan a treatment\"] >> role=button[name=\"Root canal\"]" }],
    },
    {
      title: "Why",
      highlight: "role=group[name=\"Why\"]",
      narration: "One more tap records why. This helps the patient understand, and Show patient uses it to explain the plan.",
      actions: [{ click: "role=group[name=\"Why\"] >> role=button >> nth=0" }],
    },
    {
      title: "Record a finding",
      highlight: "role=button[name=\"Record a finding\"]",
      narration: "To note what you found on the tooth, tap Record a finding.",
      actions: [{ click: "role=button[name=\"Record a finding\"]" }],
    },
    {
      title: "Choose the finding",
      highlight: "role=form[name=/Record a finding/]",
      narration: "Tap the finding, such as Caries. Then tap the surfaces and how deep it goes, if you want to.",
      actions: [{ click: "role=form[name=/Record a finding/] >> role=group >> role=button >> nth=0" }],
    },
    {
      title: "Save",
      highlight: "role=form[name=/Record a finding/] >> role=button[name=/Save|Record/]",
      narration: "Tap Save to record it.",
      actions: [{ click: "role=form[name=/Record a finding/] >> role=button[name=/Save|Record/]" }],
    },
    {
      title: "It is on the chart",
      highlight: "css=[data-tooth=\"36\"]",
      narration: "The tooth now shows the finding and the planned treatment on the chart, and in the notes for this visit.",
    },
  ],
};
