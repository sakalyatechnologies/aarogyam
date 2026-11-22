// Hold-to-exit for the full-screen patient views (Explain mode, Show patient, the phone story bundle). Import
// "@aarogyam/app-kit/hold-to-exit.css" next to it.
import { useEffect, useId, useRef, useState } from "react";

export const EXIT_HOLD_MS = 1000;

/** Exit: a one-second press and hold (mouse, finger, Space or Enter), with a fill that shows the hold. A tap does nothing. */
export function HoldToExit({ onExit }: { onExit: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [holding, setHolding] = useState(false);
  const hintId = useId();
  const start = () => {
    clearTimeout(timer.current);
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onExit();
    }, EXIT_HOLD_MS);
  };
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="xp-exit-wrap">
      <button
        type="button"
        className="xp-exit"
        data-holding={holding || undefined}
        aria-describedby={hintId}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            start();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") stop();
        }}
      >
        <span className="xp-exit-fill" aria-hidden="true" />
        <span className="xp-exit-text">Exit</span>
      </button>
      <span id={hintId} className="xp-exit-hint">
        Press and hold
      </span>
    </div>
  );
}
