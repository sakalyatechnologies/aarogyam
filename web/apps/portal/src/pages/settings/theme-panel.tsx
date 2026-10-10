import type { ReactNode } from "react";

import { apiErrorOf, type ClinicSettings } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { useToast } from "@sakalya/ui";

import { MkCard } from "../../components/mk/index.js";
import { ThemePicker, type ThemeChoice } from "../../components/theme/theme-picker.js";
import { MOCKUP_BRAND } from "../../layout/mockup-theme.js";
import { useApplyBranding, useClinicSettings, useUpdateClinicSettings } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const HINT = "Pick a palette in light or dark, or use your own brand colour. It applies to the whole portal straight away.";

/**
 * Settings, "Theme": the portal's palette and light or dark mode, saved as soon as it is picked.
 * `bare` leaves out the card, for the setup wizard, which supplies its own and a heading.
 */
export function ThemePanel({ bare = false }: { bare?: boolean }) {
  const settings = useClinicSettings();
  const shell = (children: ReactNode) =>
    bare ? (
      <>
        <h3 className="mk-flabel">Theme</h3>
        <p className="mk-hint">{HINT}</p>
        {children}
      </>
    ) : (
      <MkCard title="Theme" hint={HINT}>
        {children}
      </MkCard>
    );
  if (settings.isError) {
    return shell(<ApiErrorNotice title="Couldn't load the theme" error={settings.error} onRetry={() => void settings.refetch()} />);
  }
  if (settings.data === undefined) {
    return shell(<SkeletonRows count={2} tall label="Loading the theme" />);
  }
  return shell(<ThemeSection settings={settings.data} />);
}

function ThemeSection({ settings }: { settings: ClinicSettings }) {
  const update = useUpdateClinicSettings();
  const branding = useApplyBranding();
  const toast = useToast();
  const value: ThemeChoice = {
    brand: settings.branding.brand ?? String(MOCKUP_BRAND),
    // `auto` (follow the device) has no picker choice yet: shown as light until the New look offers it.
    mode: settings.branding.mode === "dark" ? "dark" : "light",
  };
  return (
    <ThemePicker
      value={value}
      disabled={update.isPending}
      onChange={(next) => {
        const undo = branding.apply(next);
        update.mutate(
          { branding: next },
          {
            onError: (thrown) => {
              undo();
              toast.show({
                title: apiErrorOf(thrown)?.message ?? "Couldn't save the theme. Please try again.",
                tone: "danger",
              });
            },
          },
        );
      }}
    />
  );
}
