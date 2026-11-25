import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "prices-staff-roles",
  title: "Prices, staff and roles",
  role: "owner",
  as: "Asha Kulkarni",
  summary: "Keep the price list, invite your team, and set what each role can do.",
  order: 1,
  steps: [
    {
      title: "Open Settings",
      highlight: "css=a[href=\"/settings\"]",
      narration: "As the clinic owner, you set up the clinic in Settings. Tap it in the menu.",
      actions: [{ click: "css=a[href=\"/settings\"]" }],
    },
    {
      title: "The sections",
      highlight: "css=nav[aria-label=\"Settings sections\"]",
      narration: "Each section is on the left. Changes here apply to everyone in the clinic.",
    },
    {
      title: "Price list",
      highlight: "role=button[name=\"Price list\"]",
      narration: "Open Price list. These are the services and fees that appear on bills.",
      actions: [{ click: "role=button[name=\"Price list\"]" }],
    },
    {
      title: "Add a service",
      highlight: "role=button[name=\"Add entry\"]",
      narration: "To add a service, tap Add entry.",
      actions: [{ click: "role=button[name=\"Add entry\"]" }],
    },
    {
      title: "Name it",
      highlight: "role=dialog >> role=textbox[name=/^Name/]",
      narration: "Type the name of the service, the way you want it on the bill.",
      actions: [{ fill: "role=dialog >> role=textbox[name=/^Name/]", text: "Teeth whitening" }],
    },
    {
      title: "Set the price",
      highlight: "role=dialog >> role=textbox[name=/^Price/]",
      narration: "Type the price in rupees. Turn on GST applies if tax is charged on it.",
      actions: [{ fill: "role=dialog >> role=textbox[name=/^Price/]", text: "4000" }],
    },
    {
      title: "Save",
      highlight: "role=button[name=\"Save\"]",
      narration: "Tap Save. The service is now on your list, and ready to use on bills.",
      actions: [{ click: "role=button[name=\"Save\"]" }, { wait: 800 }],
    },
    {
      title: "Team and roles",
      highlight: "role=button[name=\"Team & roles\"]",
      narration: "Next, open Team and roles to see who works in your clinic.",
      actions: [{ click: "role=button[name=\"Team & roles\"]" }],
    },
    {
      title: "Invite someone",
      highlight: "role=button[name=\"Invite\"]",
      narration: "To add a person, tap Invite. You choose their role, and they get a link to join.",
      actions: [{ click: "role=button[name=\"Invite\"]" }],
    },
    {
      title: "Choose a role",
      highlight: "role=dialog",
      narration: "Pick a role, such as doctor or front desk. The role decides what they can see and do.",
      actions: [{ press: "Escape" }],
    },
    {
      title: "What each role can do",
      highlight: "text=What each role can do",
      narration: "Below the team is a table of roles and areas. Tap a cell to switch an area on or off for everyone with that role. It saves at once. The owner always has full access.",
    },
  ],
};

