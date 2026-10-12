/**
 * Every friendly empty-state line of Today, the Queue and the Calendar, in one place so the tone is easy to tune.
 * Keep it warm and encouraging: an empty list is a quiet moment, never a sign the clinic is doing badly.
 */
export const COPY = {
  /** Nobody is waiting (today, or on another day). */
  nobodyWaiting: "All caught up — time for a breather ☕",
  nobodyWaitingOtherDay: "All clear for this day.",
  /** Nothing booked on the chosen day. */
  calmDay: "A calm day ahead. Perfect for catching up or a walk-in.",
  calmWeek: "A calm week ahead. A good time to plan or catch up.",
  /** No finished visits yet. */
  noCompleted: "Your first finished visit will show here.",
  /** Next up, with nobody to see. */
  nextUpFree: "You're free right now — enjoy a moment",
  nextUpFreeHint: "Whoever checks in next will show up here.",
  /** Queue board columns. */
  queueHint: "Add a walk-in, or check people in from Today.",
  queueHintReadOnly: "Arrivals will show here as they check in.",
  noneCalled: "No one called just yet.",
  chairsFree: "Chairs are free for the next patient.",
  chairsFreeHint: "Seat a waiting patient to start their visit.",
  nothingToBill: "Nothing waiting to be billed. Nice and tidy.",
  doneHint: "Finished visits will collect here through the day.",
  /** Other widgets. */
  noRecent: "Your first arrival will show here.",
  noRecentHint: "Patients who arrive today will appear as they come in.",
  noLabs: "All lab work is up to date.",
  noLabsHint: "New orders will show here until they are fitted.",
  noTeam: "Add your doctors in Settings and they'll show up here.",
  noCollections: "Payments you record will show up here, week by week.",
  tasksAllDone: "All your tasks are done — nice work ✨",
  noBusyHours: "Your busiest hours will appear as the day fills up.",
  noKeyNumbers: "Pick the numbers you'd like to see in the Dashboard studio.",
  noOneWaiting: "All caught up",
  noChairsSetUp: "Chairs not set up yet",
  /** Calendar. */
  noChairs: "Let's add your first chair",
  noDoctors: "Let's add your first doctor",
  addInSettings: "Add them in Settings and the schedule will come to life here.",
} as const;

/** One line under each Studio control, saying what it does. */
export const STUDIO_HINT = {
  density: "How much space between cards",
  card: "How the cards look: a soft shadow, or a plain outline",
  side: "Which side the calendar column sits on",
  width: "How wide the calendar column is",
  widgets: "Show, hide and reorder what is on your dashboard",
} as const;
