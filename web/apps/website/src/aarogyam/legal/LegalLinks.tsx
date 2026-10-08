// Aarogyam-owned. A slim row of links for the foot of sign-in and register.
import "./legal.css";
import { legalPath } from "./paths";

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`legal-links ${className}`.trim()} aria-label="Legal">
      <span className="legal-links-draft">Draft legal pages:</span>
      <a href={legalPath("privacy")}>Privacy Policy</a>
      <a href={legalPath("terms")}>Terms</a>
      <a href={legalPath("dpa")}>Data processing</a>
      <a href={legalPath("patient-notice")}>Patient notice</a>
    </nav>
  );
}
