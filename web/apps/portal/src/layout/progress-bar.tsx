import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** Requests faster than this never show the bar, so quick pages don't flash. */
export const PROGRESS_DELAY_MS = 150;

/** True once `active` has stayed true for `delay` milliseconds; `onShow(true)` fires when it turns true (pass a stable function). */
function useDelayed(active: boolean, delay: number, onShow: (shown: boolean) => void): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setTimeout(() => {
      setShown(true);
      onShow(true);
    }, delay);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [active, delay, onShow]);
  return shown;
}

/**
 * A thin bar across the top of the shell while any query or mutation runs. It appears only after
 * a short delay, holds still for people who prefer reduced motion, and is hidden from assistive
 * technology; a polite live region says "Loading" once per page load instead.
 */
export function ProgressBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [announced, setAnnounced] = useState(false);
  const shown = useDelayed(busy, PROGRESS_DELAY_MS, setAnnounced);
  return (
    <>
      {shown ? (
        <div
          data-testid="progress-bar"
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-[400] h-[3px] overflow-hidden"
        >
          <div className="aro-progress h-full w-1/3 bg-primary" />
        </div>
      ) : null}
      <div role="status" aria-live="polite" className="mk-sr">
        {announced ? "Loading" : ""}
      </div>
    </>
  );
}
