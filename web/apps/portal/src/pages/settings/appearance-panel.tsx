import { useEffect } from "react";

import { MkCard } from "../../components/mk/index.js";
import { StudioPanel } from "../today/v2/studio-panel.js";
import { ThemePanel } from "./theme-panel.js";

export type AppearanceSection = "theme" | "studio";

/**
 * Settings, "Appearance" (new look): the clinic's theme (owner only) above the member's own Today dashboard.
 * `section` is where an old `?tab=theme` or `?tab=studio` link lands.
 */
export function AppearancePanel({ owner, section }: { owner: boolean; section: AppearanceSection | undefined }) {
  useEffect(() => {
    // jsdom has no scrollIntoView; a real browser does.
    const target = section === undefined ? null : document.getElementById(`appearance-${section}`);
    if (target !== null && "scrollIntoView" in target) target.scrollIntoView({ block: "start" });
  }, [section]);
  return (
    <div className="st-appearance">
      {owner ? (
        <section id="appearance-theme" className="st-appearance-section">
          <ThemePanel title="Clinic theme" />
        </section>
      ) : null}
      <section id="appearance-studio" className="st-appearance-section">
        <MkCard title="My dashboard">
          <StudioPanel />
        </MkCard>
      </section>
    </div>
  );
}
