import { useSearchParams } from "react-router";

import type { Setup } from "@aarogyam/api-client";

import { ClinicStep } from "./step-clinic.js";
import { HoursStep } from "./step-hours.js";
import { LookStep } from "./step-look.js";
import { ServicesStep } from "./step-services.js";
import type { StepProps } from "./step-frame.js";
import { TeamStep } from "./step-team.js";
import { useUpdateClinicSetup } from "./queries.js";

const STEPS = [
  { key: "clinic", label: "Your clinic" },
  { key: "hours", label: "Hours and doctors" },
  { key: "services", label: "Services and fees" },
  { key: "team", label: "Team and patients" },
  { key: "look", label: "Look" },
] as const;

/** The first step still to do; the last step when every step has an answer. */
function firstOpen(setup: Setup): string {
  const open = STEPS.find((step) => setup.steps.find((s) => s.key === step.key)?.status === "todo");
  return open?.key ?? "look";
}

const statusLabel = { done: "Done", skipped: "Skipped", todo: "" } as const;

/**
 * The owner's setup, shown on its own until the last step is saved: one short screen per step, each
 * skippable but the setup as a whole not, progress saved as each step ends. The address carries the step (`?step=hours`), so Back, reload and "Finish setting up" all
 * land where the owner left off.
 */
export function OwnerWizard({ setup }: { setup: Setup }) {
  const [params, setParams] = useSearchParams();
  const update = useUpdateClinicSetup();
  const asked = params.get("step");
  const current = asked !== null && STEPS.some((s) => s.key === asked) ? asked : firstOpen(setup);
  const index = STEPS.findIndex((s) => s.key === current);

  const go = (step: string) => {
    setParams({ step }, { replace: false });
  };
  /** After a step is saved: on to the next open one. When none is left the clinic is set up and the gate shows the dashboard. */
  const next = (saved: Setup) => {
    const open = [...STEPS.slice(index + 1), ...STEPS.slice(0, index)].find((step) => saved.steps.find((s) => s.key === step.key)?.status === "todo");
    if (open !== undefined) {
      go(open.key);
    }
  };
  const props: StepProps = {
    done: async (extra) => {
      next(
        await update.mutateAsync({
          step: current,
          status: "done",
          ...(extra?.practice === undefined ? {} : { practice: extra.practice }),
        }),
      );
    },
    skip: async () => {
      next(await update.mutateAsync({ step: current, status: "skipped" }));
    },
    back:
      index > 0
        ? () => {
            go(STEPS[index - 1]?.key ?? "clinic");
          }
        : undefined,
  };

  return (
    <div className="sw mk-panel" data-step={current}>
      <div className="sw-top">
        <h1>Set up your clinic</h1>
        <p>
          Step {index + 1} of {STEPS.length}. Takes about ten minutes. You can skip a step, and your clinic opens once the last one is saved.
        </p>
      </div>
      <nav aria-label="Setup steps">
        <ol className="sw-steps">
          {STEPS.map((step, i) => {
            const status = setup.steps.find((s) => s.key === step.key)?.status ?? "todo";
            return (
              <li key={step.key}>
                <button
                  type="button"
                  data-status={status}
                  aria-current={i === index ? "step" : undefined}
                  onClick={() => {
                    go(step.key);
                  }}
                >
                  <span>{step.label}</span>
                  <small>{statusLabel[status]}</small>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {current === "clinic" ? <ClinicStep props={props} practice={setup.practice} /> : null}
      {current === "hours" ? <HoursStep props={props} /> : null}
      {current === "look" ? <LookStep props={props} /> : null}
      {current === "services" ? <ServicesStep props={props} /> : null}
      {current === "team" ? <TeamStep props={props} /> : null}
    </div>
  );
}
