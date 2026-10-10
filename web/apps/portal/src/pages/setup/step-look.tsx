import { useMemo, useState } from "react";

import { apiErrorOf, dashboardLayout, type DashboardLayout } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { useClinic } from "../../clinic.js";
import { MkCard } from "../../components/mk/index.js";
import { LetterheadPanel } from "../settings/letterhead-panel.js";
import { ThemePanel } from "../settings/theme-panel.js";
import { useClinicLayout, useSaveLayout } from "../today/v2/queries.js";
import { StudioEditor } from "../today/v2/studio-editor.js";
import type { StepProps } from "./step-frame.js";

const DRAFT_KEY = "aarogyam.setup.look.layout";

/** The unsent layout choices, kept for this tab so a reload mid-step doesn't lose them. */
function readDraft(key: string): DashboardLayout | undefined {
  try {
    const text = globalThis.sessionStorage.getItem(key);
    if (text === null) return undefined;
    const parsed = dashboardLayout.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
function writeDraft(key: string, layout: DashboardLayout | undefined) {
  try {
    if (layout === undefined) globalThis.sessionStorage.removeItem(key);
    else globalThis.sessionStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // No storage (a private window): the choices simply aren't kept across a reload.
  }
}

/**
 * Step 5, "Look": the portal's colours (saved as they are picked), the clinic's default Today layout (a template, widgets, sizes and
 * order, with a large live preview on sample data; kept as a draft until Continue), and the letterhead.
 */
export function LookStep({ props }: { props: StepProps }) {
  const { access } = useClinic();
  const key = `${DRAFT_KEY}.${access.org_id}`;
  const layout = useClinicLayout();
  const save = useSaveLayout("clinic");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [initial] = useState(() => readDraft(key));
  const [draft, setDraft] = useState<DashboardLayout | undefined>(initial);
  const view = useMemo(() => (layout.data === undefined ? undefined : initial === undefined ? layout.data : { ...layout.data, layout: initial }), [layout.data, initial]);

  const leave = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      writeDraft(key, undefined);
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't save that. Please try again.");
      setBusy(false);
    }
  };

  return (
    <MkCard title="Your look" hint="Pick the colours and the layout of your Today board, with a live preview. Then add your letterhead if you have one.">
      <div className="sw-form">
        <section aria-labelledby="look-colours">
          <h2 id="look-colours" className="sw-h2">
            Colours
          </h2>
          {/* TODO: offer "Auto" (follow the device) beside Light and Dark once the API accepts it; for now it stays hidden. */}
          <ThemePanel bare />
        </section>
        <section aria-labelledby="look-layout">
          <h2 id="look-layout" className="sw-h2">
            Your Today board
          </h2>
          <p className="mk-hint">
            Choose a template, then add, remove, resize and reorder widgets. This becomes the clinic&rsquo;s default; each person can still make their own in Settings.
          </p>
          {layout.isError ? (
            <ApiErrorNotice
              title="Couldn't load the layout"
              error={layout.error}
              onRetry={() => {
                void layout.refetch();
              }}
            />
          ) : view === undefined ? (
            <div role="status" aria-label="Loading the layout" style={{ display: "grid", gap: 12 }}>
              <Skeleton shape="block" />
              <Skeleton shape="block" className="h-64" />
            </div>
          ) : (
            <StudioEditor
              view={view}
              layout="split"
              scope="clinic"
              hideActions
              sample
              thumbnails
              onChange={(next) => {
                setDraft(next);
                writeDraft(key, next);
              }}
            />
          )}
        </section>
        <section aria-labelledby="look-letterhead">
          <h2 id="look-letterhead" className="sw-h2">
            Letterhead
          </h2>
          <LetterheadPanel bare />
        </section>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="sw-error">
          {error}
        </p>
      )}
      <div className="sw-foot">
        {props.back === undefined ? null : (
          <button type="button" className="mk-btn mk-btn-ghost" onClick={props.back} disabled={busy}>
            Back
          </button>
        )}
        <span className="sw-spacer" />
        <button
          type="button"
          className="mk-btn mk-btn-ghost"
          disabled={busy}
          onClick={() => {
            void leave(() => props.skip());
          }}
        >
          Skip this step
        </button>
        <button
          type="button"
          className="mk-btn mk-btn-primary"
          disabled={busy || view === undefined}
          onClick={() => {
            if (view === undefined) return;
            void leave(async () => {
              await save.mutateAsync(draft ?? view.layout);
              await props.done();
            });
          }}
        >
          {busy ? "Saving…" : "Continue"}
        </button>
      </div>
      <p className="mk-hint" style={{ margin: "8px 0 0" }}>
        Colours save at once. The layout is saved as the clinic&rsquo;s default when you press Continue. Press &ldquo;Save letterhead&rdquo; to keep a letterhead change.
      </p>
    </MkCard>
  );
}
