/** The fake of first-run setup: step statuses per clinic and per member, with the real API's checks. */

import type * as C from "../contract.js";

export const CLINIC_STEPS = ["clinic", "hours", "services", "team", "look"] as const;
export const MEMBER_STEPS = ["profile"] as const;

export interface FakeSetup {
  /** `clinic:<clinic id>` or `member:<membership id>`. */
  key: string;
  practice: "solo" | "team" | "multi" | null;
  steps: Record<string, "done" | "skipped">;
  dismissed: boolean;
}

/**
 * A new, nothing-answered setup for a clinic or member. Fixtures start without any entry, which the
 * fake reads as dismissed (a clinic that existed before the wizard); tests that exercise the wizard
 * push an entry made here.
 */
export function freshSetup(key: string): FakeSetup {
  return { key, practice: null, steps: {}, dismissed: false };
}

type Store = { setups?: FakeSetup[] };

/** The stored setup, or a dismissed one for people who joined before the wizard. */
export function setupOf(state: Store, key: string): FakeSetup {
  state.setups ??= [];
  return state.setups.find((s) => s.key === key) ?? { key, practice: null, steps: {}, dismissed: true };
}

function save(state: Store, setup: FakeSetup): void {
  state.setups ??= [];
  const at = state.setups.findIndex((s) => s.key === setup.key);
  if (at === -1) {
    state.setups.push(setup);
  } else {
    state.setups[at] = setup;
  }
}

export function wireSetup(setup: FakeSetup, keys: readonly string[]): C.Setup {
  const answered = keys.filter((k) => setup.steps[k] !== undefined).length;
  const standing: C.Setup["standing"] = setup.dismissed
    ? "dismissed"
    : answered === keys.length
      ? "complete"
      : answered === 0
        ? "new"
        : "in_progress";
  return {
    standing,
    practice: setup.practice,
    steps: keys.map((key) => ({ key, status: setup.steps[key] ?? "todo" })),
  };
}

/** Applies an update as the API does; a string is the message of the 400 it would answer. */
export function applySetup(state: Store, key: string, keys: readonly string[], update: C.SetupUpdate, clinicLevel: boolean): C.Setup | string {
  const setup = structuredClone(setupOf(state, key));
  if ((update.step != null) !== (update.status != null)) {
    return "step: needs both a step and a status";
  }
  if (update.step != null && update.status != null) {
    if (!keys.includes(update.step)) return "step: not a setup step";
    if (update.status === "todo") {
      setup.steps = Object.fromEntries(Object.entries(setup.steps).filter(([k]) => k !== update.step));
    } else if (update.status === "done" || update.status === "skipped") {
      setup.steps[update.step] = update.status;
    } else {
      return "status: must be done, skipped or todo";
    }
  }
  if (update.practice != null) {
    if (!clinicLevel) return "practice: only the clinic has one";
    if (update.practice !== "solo" && update.practice !== "team" && update.practice !== "multi") {
      return "practice: must be solo, team or multi";
    }
    setup.practice = update.practice;
  }
  if (update.dismissed != null) setup.dismissed = update.dismissed;
  save(state, setup);
  return wireSetup(setup, keys);
}
