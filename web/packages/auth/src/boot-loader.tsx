import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { AuthBrandStyle } from "./auth-shell.js";

/** What went wrong and what to do about it; shown on the loader's own surface. */
export interface BootFailure {
  message: string;
  /** Left out when retrying can't help (say, a one-time code that is already used). */
  onRetry?: (() => void) | undefined;
  onBack: () => void;
}

/** The loader's whole state: one line of text, or a failure. */
export interface BootState {
  text: string;
  failure?: BootFailure | undefined;
}

/** The failure, in its own alert so it is announced; focus moves to its heading when it appears. */
function BootFailureView({ text, failure }: { text: string; failure: BootFailure }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="ab-fail" role="alert">
      <h1 ref={heading} tabIndex={-1}>
        {text}
      </h1>
      <p>{failure.message}</p>
      <div className="ab-actions">
        {failure.onRetry === undefined ? null : (
          <button type="button" className="ab-btn ab-primary" onClick={failure.onRetry}>
            Try again
          </button>
        )}
        <button type="button" className={`ab-btn${failure.onRetry === undefined ? " ab-primary" : ""}`} onClick={failure.onBack}>
          Back to sign in
        </button>
      </div>
    </div>
  );
}

/** The full-screen branded loader. One root element; only its text (or failure) changes. */
export function BootLoader({ text, failure }: BootState) {
  return (
    <div className="ab-boot" role="status" data-testid="boot-loader">
      <AuthBrandStyle />
      <div className="ab-brand" aria-hidden="true">
        <span className="ab-mark">A</span>
        <span className="ab-word">Aarogyam</span>
      </div>
      {failure === undefined ? (
        <p className="ab-line">
          <span className="ab-spin" aria-hidden="true" />
          <span>{text}</span>
        </p>
      ) : (
        <BootFailureView text={text} failure={failure} />
      )}
    </div>
  );
}

interface Slot {
  id: string;
  state: BootState;
}

interface BootApi {
  set: (slot: Slot) => void;
  clear: (id: string) => void;
}

const BootContext = createContext<BootApi | null>(null);

/**
 * Keeps one loader mounted above the app while any `BootStage` is on screen, so the steps of
 * signing in (handoff, who you are, the clinic, its setup) read as one steady loader.
 */
export function BootLoaderProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const api = useMemo<BootApi>(() => ({ set: setSlot, clear: (id) => {
      setSlot((now) => (now?.id === id ? null : now));
    },
  }), []);
  return (
    <BootContext value={api}>
      {children}
      {slot === null ? null : <BootLoader {...slot.state} />}
    </BootContext>
  );
}

/** Says what the loader shows while this is rendered; renders nothing itself. */
export function BootStage({ text, failure }: BootState) {
  const api = useContext(BootContext);
  const id = useId();
  useEffect(() => {
    api?.set({ id, state: { text, failure } });
  }, [api, id, text, failure]);
  useEffect(() => () => api?.clear(id), [api, id]);
  return api === null ? <BootLoader text={text} failure={failure} /> : null;
}
