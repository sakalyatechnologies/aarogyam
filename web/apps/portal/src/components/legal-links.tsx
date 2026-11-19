import { centralSignInSetting } from "../env.js";

const PUBLIC_SITE = "https://aarogyam.sakalyatechnologies.com";

/** The public website, where the legal pages live: the origin of the central sign-in page when this build has one. */
export function legalBase(): string {
  const central = centralSignInSetting();
  if (central !== "") {
    try {
      return new URL(central).origin;
    } catch {
      return PUBLIC_SITE;
    }
  }
  return PUBLIC_SITE;
}

const LINKS = [
  { path: "/privacy", label: "Privacy Policy" },
  { path: "/terms", label: "Terms" },
  { path: "/dpa", label: "Data processing" },
  { path: "/patient-notice", label: "Patient notice" },
] as const;

/** Links to the legal pages on the public website, for the foot of sign-in, register and the signed-in portal. */
export function LegalLinks({ className = "" }: { className?: string }) {
  const base = legalBase();
  return (
    <nav className={`mk-legal ${className}`.trim()} aria-label="Legal">
      {LINKS.map((link) => (
        <a key={link.path} href={`${base}${link.path}`} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      ))}
    </nav>
  );
}

/** What the portal counts for Sakalya's console (docs/plans/console-insights-design.md, privacy notice). */
export const USAGE_NOTICE =
  "We count which pages are used and how fast they load, as totals for your clinic, to improve the product. We never record patient details, and never what any one person did.";

/** The staff privacy line under the signed-in portal's legal links. */
export function UsageNotice() {
  return <p className="mk-usage-notice text-xs text-muted">{USAGE_NOTICE}</p>;
}
