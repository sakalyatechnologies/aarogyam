import type { CSSProperties } from "react";

/** The Aarogyam website, linked from the footer of every patient-facing page. */
export const AAROGYAM_SITE = "https://aarogyam.sakalyatechnologies.com";

const initialsOf = (name: string): string => {
  const words = name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter((word) => word !== "");
  const two = words.length > 1 ? `${words[0]?.charAt(0) ?? ""}${words[words.length - 1]?.charAt(0) ?? ""}` : (words[0] ?? "").slice(0, 2);
  return two.toUpperCase();
};

/** The clinic's logo when a public page has one, else a tile with its initials. Plain styles: the visit page has no UI kit. */
export function ClinicBadge({ name, logoUrl, size = 44 }: { name: string; logoUrl?: string | null | undefined; size?: number }) {
  const box: CSSProperties = { width: size, height: size, borderRadius: Math.round(size / 3.2), flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
  if (logoUrl !== undefined && logoUrl !== null && logoUrl !== "") {
    return <img src={logoUrl} alt="" style={{ ...box, objectFit: "contain" }} />;
  }
  return (
    <span aria-hidden="true" data-testid="clinic-badge" style={{ ...box, background: "#0f766e", color: "#fff", fontWeight: 800, fontSize: Math.round(size * 0.38) }}>
      {initialsOf(name)}
    </span>
  );
}

/** "Powered by [A] Aarogyam": the one footer for every patient-facing page. */
export function PoweredBy() {
  return (
    <footer data-testid="powered-by" style={{ display: "flex", justifyContent: "center", padding: "20px 0 8px", fontSize: 12, color: "#64748b" }}>
      <a href={AAROGYAM_SITE} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "inherit", textDecoration: "none" }}>
        <span>Powered by</span>
        <svg aria-hidden="true" viewBox="0 0 100 100" width="16" height="16" style={{ opacity: 0.75 }}>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 82 L50 18 L78 82" stroke="#0F172A" strokeWidth="10" />
            <path d="M34 60 H66" stroke="#0F766E" strokeWidth="8" />
          </g>
        </svg>
        <span style={{ fontWeight: 600 }}>Aarogyam</span>
      </a>
    </footer>
  );
}
