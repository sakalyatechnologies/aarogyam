import type { Guide } from "./guide.js";

export const guide: Guide = {
  id: "start-here",
  title: "Start here: a tour of Aarogyam",
  role: "getting-started",
  as: "Asha Kulkarni",
  summary: "The left menu, Today, search and Settings, in about two minutes.",
  order: 1,
  steps: [
    {
      title: "Welcome",
      narration: "Welcome to Aarogyam. This short tour shows you around the app. You can pause at any step, or switch to slides and go at your own pace.",
    },
    {
      title: "The left menu",
      highlight: "aside",
      narration: "On the left is your menu. Each icon opens one part of the clinic: patients, calendar, queue, billing and more. Point at an icon to see its name.",
    },
    {
      title: "Today at a glance",
      highlight: ".tv2-kpis",
      narration: "Today is your home screen. These cards show how many patients are booked, who is in the chair, and who is waiting.",
    },
    {
      title: "Next up and the day's list",
      highlight: ".tv2-body",
      narration: "Below the cards, the next patient is ready for you. Under that is the full list of today's appointments. Tap any row to open that patient.",
    },
    {
      title: "Search",
      highlight: "role=button[name=/Search patients/i]",
      narration: "Search finds a patient, a page or a bill. Tap it, or press Control and K on your keyboard, and start typing.",
      actions: [{ click: "role=button[name=/Search patients/i]" }, { wait: 600 }],
    },
    {
      title: "Type a name",
      highlight: "role=dialog",
      narration: "Type a name, a clinic number or a phone number. The matches appear as you type. Press Enter to open one.",
      actions: [{ press: "Escape" }],
    },
    {
      title: "New appointment",
      highlight: "role=button[name=\"Schedule an appointment\"]",
      narration: "This green button is always here. Tap it to book a new appointment from any page.",
    },
    {
      title: "Notifications",
      highlight: "role=button[name=/Notifications/i]",
      narration: "The bell shows what needs your attention, like new bookings and messages. The number is how many you have not read.",
    },
    {
      title: "Guides",
      highlight: "css=a[href=\"/guides\"]",
      narration: "This book icon opens Guides. Every main job in the clinic has a short guide like this one. Come back whenever you need a reminder.",
    },
    {
      title: "Settings",
      highlight: "css=a[href=\"/settings\"]",
      narration: "Settings is at the bottom. Your profile, the price list, and your team live here. That is the tour. Open the next guide when you are ready.",
    },
  ],
};

