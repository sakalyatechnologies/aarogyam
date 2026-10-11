import { Baby, Bone, Ear, Eye, HeartPulse, Sparkles, Stethoscope, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** The tooth drawn in the design's emblem, as lucide has no tooth. */
const TOOTH =
  "M7.5 3.5c-2.6 0-4 2-4 4.6 0 2.3 1 3.7 1.6 5.6.6 2 .8 6.8 2.6 6.8 1.6 0 1.5-4.2 2.4-5.7.4-.7 1.4-.7 1.8 0 .9 1.5.8 5.7 2.4 5.7 1.8 0 2-4.8 2.6-6.8.6-1.9 1.6-3.3 1.6-5.6 0-2.6-1.4-4.6-4-4.6-1.8 0-2.6 1-4.5 1s-2.7-1-4.5-1Z";

type Glyph = { kind: "tooth" } | { kind: "icon"; Icon: LucideIcon };

const RULES: readonly (readonly [RegExp, Glyph])[] = [
  [/dent|tooth|orthodon|endodon|periodon|prosthodon/i, { kind: "tooth" }],
  [/ortho(paed|ped)|bone|physio|spine/i, { kind: "icon", Icon: Bone }],
  [/eye|ophthal|optom/i, { kind: "icon", Icon: Eye }],
  [/paed|pedia|child|neonat/i, { kind: "icon", Icon: Baby }],
  [/cardi|heart/i, { kind: "icon", Icon: HeartPulse }],
  [/\bent\b|ear|nose|throat/i, { kind: "icon", Icon: Ear }],
  [/derma|skin|cosmet|aesthet/i, { kind: "icon", Icon: Sparkles }],
  [/general|physician|family|primary|multi/i, { kind: "icon", Icon: Stethoscope }],
];

/** The picture for a clinic's specialty, or `undefined` when there is none to show (the caller falls back to initials). */
export function glyphFor(specialty: string | null | undefined): Glyph | undefined {
  const text = (specialty ?? "").trim();
  return text === "" ? undefined : RULES.find(([pattern]) => pattern.test(text))?.[1];
}

/** True while the person asks their system for less motion. */
export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const read = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    const onChange = () => {
      setReduced(list.matches);
    };
    list.addEventListener("change", onChange);
    return () => {
      list.removeEventListener("change", onChange);
    };
  }, []);
  return reduced;
}

/**
 * The clinic's specialty emblem for the rail: a tooth for dental clinics, another picture for other
 * specialties, in a rounded tile that floats gently while idle (still when motion is reduced).
 * Renders nothing for an unknown specialty so the caller can show initials.
 */
export function SpecialtyEmblem({ specialty }: { specialty: string | null | undefined }) {
  const reduced = usePrefersReducedMotion();
  const glyph = glyphFor(specialty);
  if (glyph === undefined) {
    return null;
  }
  return (
    <span className={`mk2-emblem ${reduced ? "" : "mk2-emblem-live"}`} data-motion={reduced ? "still" : "idle"} data-glyph={glyph.kind === "tooth" ? "tooth" : "icon"} aria-hidden="true">
      {glyph.kind === "tooth" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d={TOOTH} />
        </svg>
      ) : (
        <glyph.Icon strokeWidth={1.7} />
      )}
    </span>
  );
}
