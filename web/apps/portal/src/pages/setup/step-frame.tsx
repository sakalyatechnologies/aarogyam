import type { ReactNode } from "react";

import { MkCard } from "../../components/mk/index.js";

/** What a step is given: how to leave it, saving progress for the step as it goes. */
export interface StepProps {
  /** Records the step as done (with the practice, for the first step) and moves on. */
  done: (extra?: { practice?: string }) => Promise<void>;
  /** Records the step as skipped and moves on. */
  skip: () => Promise<void>;
  /** The previous step, when there is one. */
  back: (() => void) | undefined;
}

/** One screen of the wizard: a card with the step's title and the Back, Skip and Continue row. */
export function StepFrame({
  title,
  hint,
  children,
  props,
  onContinue,
  busy,
  continueLabel = "Save and continue",
  error,
  canContinue = true,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  props: StepProps;
  /** Saves what the screen holds, then calls `props.done`. */
  onContinue: () => void;
  busy: boolean;
  continueLabel?: string;
  error?: string | undefined;
  canContinue?: boolean;
}) {
  return (
    <MkCard title={title} hint={hint}>
      <div className="sw-form">{children}</div>
      {error === undefined ? null : (
        <p role="alert" className="sw-error">
          {error}
        </p>
      )}
      <div className="sw-foot">
        {props.back === undefined ? null : (
          <button type="button" className="mk-btn mk-btn-ghost" onClick={props.back} disabled={busy}>
            Back
          </button>
        )}
        <span className="sw-spacer" />
        <button
          type="button"
          className="mk-btn mk-btn-ghost"
          disabled={busy}
          onClick={() => {
            void props.skip();
          }}
        >
          Skip this step
        </button>
        <button type="button" className="mk-btn mk-btn-primary" disabled={busy || !canContinue} onClick={onContinue}>
          {busy ? "Saving…" : continueLabel}
        </button>
      </div>
    </MkCard>
  );
}

/** A labelled text field with its own error line, in the mock-up's field style. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  autoComplete,
  type = "text",
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string;
  autoComplete?: string;
  type?: "text" | "email" | "tel";
  inputMode?: "numeric" | "tel" | "text";
}) {
  return (
    <>
      <label className="mk-flabel" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="mk-tin"
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="sw-field-error">
          {error}
        </p>
      )}
    </>
  );
}
