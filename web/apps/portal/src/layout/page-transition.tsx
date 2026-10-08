import { AnimatePresence, m } from "motion/react";
import { useLocation, useOutlet } from "react-router";

/** The section a path belongs to: `/patients/42` and `/patients` share `patients`. */
export function sectionOf(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

/**
 * The routed page with a short fade-and-rise when the section changes. Keyed by the first path
 * segment, so tabs and detail pages inside a section don't re-animate the whole page. The leaving
 * page keeps its own outlet (`useOutlet` is captured per render), so it doesn't flash the next one.
 */
export function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div
        key={sectionOf(location.pathname)}
        className="mk-page"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } }}
        exit={{ opacity: 0, y: -8, transition: { duration: 0.15, ease: "easeIn" } }}
      >
        {outlet}
      </m.div>
    </AnimatePresence>
  );
}
