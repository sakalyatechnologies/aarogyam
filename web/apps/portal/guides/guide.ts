// How a guide is written (docs/plans/guides-design.md §3). `pnpm guides:render` plays each guide on the fake API.
// Selectors are Playwright selectors, such as `role=button[name="Book"i]`, `css=a[href="/queue"]` or `text=Today`.
// This file holds types only, so Node can load the guides without a build step.

/** What a step does after its still is taken, to reach the next step's screen. */
export type GuideAction =
  | { click: string }
  | { fill: string; text: string }
  | { select: string; label: string }
  | { press: string }
  /** Moves to another route inside the running app (history push), so the fake API keeps its state. */
  | { goto: string }
  | { wait: number };

export type GuideRole = "getting-started" | "front-desk" | "doctor" | "billing" | "owner";

export interface GuideStep {
  /** The chapter name. */
  title: string;
  /** Spoken aloud and shown as the caption: short, plain, second person. */
  narration: string;
  /** Where the cursor and ring point on this step's screen. Omit when the whole screen is the point. */
  highlight?: string;
  /** Run after the still is taken. */
  actions?: GuideAction[];
}

export interface Guide {
  id: string;
  title: string;
  role: GuideRole;
  /** The fake-API person who signs in for the recording. */
  as: "Asha Kulkarni" | "Dr Dev Rao" | "Farah Shaikh";
  summary: string;
  /** List order within its role group. */
  order: number;
  steps: GuideStep[];
}
