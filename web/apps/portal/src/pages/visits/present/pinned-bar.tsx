/**
 * The Pinned chip of Show patient (present-studio-design §10, slice 2e) and what it opens: the deck, the side-by-side
 * compare, the pen and "What we discussed" with its Save. Loaded on demand with the deck itself, so the Present route
 * stays small. Pins live in memory; Save writes `present_discussions` (the per-row "Send to the patient" tick is off by default: slice 2f).
 */
import { Suspense, lazy, useState, type ReactElement } from "react";

import { apiErrorOf, type PresentStudio, type VisitId } from "@aarogyam/api-client";
import { usePins } from "@aarogyam/app-kit/present";
import { useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useSavePresentDiscussions, useVisitPresentDiscussions } from "../../../queries.js";

const PinnedDeck = lazy(() => import("@aarogyam/app-kit/present/deck").then((m) => ({ default: m.PinnedDeck })));

export function PinnedBar({ visitId, studio }: { visitId: VisitId; studio: PresentStudio | undefined }): ReactElement | null {
  const pins = usePins();
  const [open, setOpen] = useState(false);
  const { can } = useClinic();
  const saved = useVisitPresentDiscussions(visitId);
  const save = useSavePresentDiscussions(visitId);
  const toast = useToast();
  if (pins === undefined || (pins.pins.length === 0 && !open)) return null;
  const labels = new Map(studio?.situations.flatMap((s) => s.options.map((o) => [o.key, o.label] as const)));
  return (
    <>
      <button type="button" className="pm-chip" onClick={() => { setOpen(true); }}>{`Pinned (${String(pins.pins.length)})`}</button>
      {open ? (
        <Suspense fallback={null}>
          <PinnedDeck
            onClose={() => { setOpen(false); }}
            saving={save.isPending}
            saved={saved.data?.discussions ?? []}
            labelOf={(key) => labels.get(key) ?? key}
            onSave={(drafts) => {
              if (!can("clinical.write")) {
                toast.show({ title: "Your role can't save this.", tone: "danger" });
                return;
              }
              save.mutate(drafts, {
                onSuccess: () => { toast.show({ title: "Saved", tone: "success" }); },
                onError: (thrown) => { toast.show({ title: apiErrorOf(thrown)?.status === 409 ? "The visit is closed; reopen it to save." : "Couldn't save. Please try again.", tone: "danger" }); },
              });
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
