import { useNavigate, useSearchParams } from "react-router";

import type { Setup } from "@aarogyam/api-client";

import { ClinicStep } from "./step-clinic.js";
import { HoursStep } from "./step-hours.js";
import { LookStep } from "./step-look.js";
import { ReadyStep } from "./step-ready.js";
import { ServicesStep } from "./step-services.js";
import type { StepProps } from "./step-frame.js";
import { TeamStep } from "./step-team.js";
import { useUpdateClinicSetup } from "./queries.js";
import { rememberLater } from "./later.js";

const STEPS = [
  { key: "clinic", label: "Your clinic" },
  { key: "hours", label: "Hours and doctors" },
  { key: "look", label: "Look" },
  { key: "services", label: "Services and fees" },
  { key: "team", label: "Team and patients" },
] as const;

const READY = "ready";

/** The first step still to do, or the finish when every step has an answer. */
function firstOpen(setup: Setup): string {
  const open = STEPS.find((step) => setup.steps.find((s) => s.key === step.key)?.status === "todo");
  return open?.key ?? READY;
}

const statusLabel = { done: "Done", skipped: "Skipped", todo: "" } as const;

/**
 * The owner's setup: one short screen per step, every step skippable, progress saved as each step
 * ends. The address carries the step (`?step=hours`), so Back, reload and "Finish setting up" all
 * land where the owner left off.
 */
export function OwnerWizard({ setup }: { setup: Setup }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const update = useUpdateClinicSetup();
  const asked = params.get("step");
  const current = asked !== null && (asked === READY || STEPS.some((s) => s.key === asked)) ? asked : firstOpen(setup);
  const index = STEPS.findIndex((s) => s.key === current);

  const go = (step: string) => {
    setParams({ step }, { replace: false });
  };
  const next = () => {
    const after = STEPS[index + 1];
    go(after === undefined ? READY : after.key);
  };
  const props: StepProps = {
    done: async (extra) => {
      await update.mutateAsync({ step: current, status: "done", ...(extra?.practice === undefined ? {} : { practice: extra.practice }) });
      next();
    },
    skip: async () => {
      await update.mutateAsync({ step: current, status: "skipped" });
      next();
    },
    back:
      index > 0
        ? () => {
            go(STEPS[index - 1]?.key ?? "clinic");
          }
        : undefined,
  };

  return (
    <div className="sw mk-panel">
      <div className="sw-top">
        <h1>{current === READY ? "All set" : "Set up your clinic"}</h1>
        {current === READY ? null : (
          <p>
            Step {index + 1} of {STEPS.length}. Takes about ten minutes, and you can skip anything.
          </p>
        )}
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
      {current === "hours" ? <HoursStep props={props} practice={setup.practice} /> : null}
      {current === "look" ? <LookStep props={props} /> : null}
      {current === "services" ? <ServicesStep props={props} /> : null}
      {current === "team" ? <TeamStep props={props} /> : null}
      {current === READY ? <ReadyStep /> : null}
      {current === READY ? null : (
        <p style={{ textAlign: "right", margin: "12px 0 0" }}>
          <button
            type="button"
            className="sw-link"
            onClick={() => {
              rememberLater();
              void navigate("/today");
            }}
          >
            Finish later
          </button>
        </p>
      )}
    </div>
  );
}
