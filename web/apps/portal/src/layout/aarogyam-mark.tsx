/**
 * The Aarogyam mark (brand/aarogyam-mark.svg) drawn in the rail's own colours, so it sits with any
 * look: the A takes the rail's strong ink and the crossbar its accent, on the same soft tile as the
 * rest of the rail. Decorative; the name beside it is the text.
 */
export function AarogyamMark() {
  return (
    <span className="mk2-emblem mk2-aro" aria-hidden="true">
      <svg viewBox="0 0 100 100" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 82 L50 18 L78 82" stroke="currentColor" strokeWidth="11" />
        <path d="M34 60 H66" stroke="var(--rail-accent)" strokeWidth="9" />
      </svg>
    </span>
  );
}
