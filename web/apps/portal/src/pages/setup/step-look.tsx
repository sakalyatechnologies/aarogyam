import { LetterheadThemePanel } from "../settings/letterhead-theme-panel.js";
import { MkCard } from "../../components/mk/index.js";
import { useState } from "react";
import type { StepProps } from "./step-frame.js";

/** Step 3: do you have a letterhead (upload it) or pick a generated design, and the portal's palette, with a live preview. */
export function LookStep({ props }: { props: StepProps }) {
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <MkCard title="Your look" hint="Do you have a letterhead? Upload it, or pick a design made from your clinic's details. Then choose the portal's colours.">
      <LetterheadThemePanel bare />
      {error === undefined ? null : (
        <p role="alert" className="sw-error">
          {error}
        </p>
      )}
      <div className="sw-foot">
        {props.back === undefined ? null : (
          <button type="button" className="mk-btn mk-btn-ghost" onClick={props.back}>
            Back
          </button>
        )}
        <span className="sw-spacer" />
        <button
          type="button"
          className="mk-btn mk-btn-ghost"
          onClick={() => {
            props.skip().catch(() => {
              setError("Couldn't record that. Please try again.");
            });
          }}
        >
          Skip this step
        </button>
        <button
          type="button"
          className="mk-btn mk-btn-primary"
          onClick={() => {
            props.done().catch(() => {
              setError("Couldn't record that. Please try again.");
            });
          }}
        >
          Continue
        </button>
      </div>
      <p className="mk-hint" style={{ margin: "8px 0 0" }}>
        Choices on the theme save at once. Press &ldquo;Save letterhead&rdquo; to keep a letterhead change.
      </p>
    </MkCard>
  );
}
