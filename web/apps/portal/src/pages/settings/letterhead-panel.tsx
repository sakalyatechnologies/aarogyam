import { useMemo, useState, type ReactNode } from "react";

import { apiErrorOf, type ClinicSettings, type LetterheadDocument } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { useToast } from "@sakalya/ui";

import { LetterheadPicker, applyDraft, toDraft, type DoctorChoice, type LetterheadDraft } from "../../components/letterhead/letterhead-picker.js";
import { LetterheadPreview } from "../../components/letterhead/letterhead-preview.js";
import { MkCard } from "../../components/mk/index.js";
import {
  useClinicSettings,
  useLetterhead,
  usePractitioners,
  useRemoveLetterheadImage,
  useUpdateClinicSettings,
  useUploadLetterheadImage,
} from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const HINT = "Printed on prescriptions, bills and receipts, and shown on the page patients open from your link.";

/**
 * Settings, "Letterhead": the header printed on every clinic document, with a live preview and its own save.
 * `bare` leaves out the card, for the setup wizard, which supplies its own and a heading.
 */
export function LetterheadPanel({ bare = false }: { bare?: boolean }) {
  const settings = useClinicSettings();
  const document = useLetterhead();
  const practitioners = usePractitioners();
  const shell = (children: ReactNode) =>
    bare ? (
      <>
        <h3 className="mk-flabel" style={{ marginTop: 22 }}>
          Letterhead
        </h3>
        <p className="mk-hint">{HINT}</p>
        {children}
      </>
    ) : (
      <MkCard title="Letterhead" hint={HINT}>
        {children}
      </MkCard>
    );
  const failed = settings.isError ? settings : document.isError ? document : practitioners.isError ? practitioners : undefined;
  if (failed !== undefined) {
    return shell(<ApiErrorNotice title="Couldn't load the letterhead" error={failed.error} onRetry={() => void failed.refetch()} />);
  }
  if (settings.data === undefined || document.data === undefined || practitioners.data === undefined) {
    return shell(<SkeletonRows count={3} tall label="Loading the letterhead" />);
  }
  const choices: DoctorChoice[] = practitioners.data.items
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      qualifications: p.qualifications,
      registration_number: p.registration_number,
      specialty: p.specialty,
    }));
  return shell(<LetterheadSection settings={settings.data} document={document.data} choices={choices} />);
}

const sameDraft = (a: LetterheadDraft, b: LetterheadDraft) =>
  JSON.stringify(a) === JSON.stringify(b);

function LetterheadSection({
  settings,
  document,
  choices,
}: {
  settings: ClinicSettings;
  document: LetterheadDocument;
  choices: readonly DoctorChoice[];
}) {
  const update = useUpdateClinicSettings();
  const upload = useUploadLetterheadImage();
  const remove = useRemoveLetterheadImage();
  const toast = useToast();
  const saved = useMemo(
    () => toDraft(settings.letterhead),
    [settings.letterhead],
  );
  const [draft, setDraft] = useState<LetterheadDraft>(saved);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const dirty = !sameDraft(draft, saved);
  const preview = useMemo(
    () => applyDraft(document, draft, choices),
    [document, draft, choices],
  );
  const shown: LetterheadDocument = {
    ...preview,
    letterhead: {
      ...preview.letterhead,
      has_image: settings.letterhead.has_image,
      has_logo: settings.letterhead.has_logo,
    },
  };
  const fail = (thrown: unknown, fallback: string) => {
    const error = apiErrorOf(thrown);
    if (error?.field !== undefined) {
      setErrors({ [error.field]: error.message });
    }
    toast.show({ title: error?.message ?? fallback, tone: "danger" });
  };
  const save = () => {
    setErrors({});
    update.mutate(
      {
        letterhead: {
          mode: draft.mode,
          template: draft.template,
          accent: draft.accent,
          show: draft.show,
          footer: draft.footer,
          email: draft.email,
          timings: draft.timings,
          local_name: draft.local_name,
          doctor_ids: [...draft.doctor_ids],
        },
      },
      {
        onSuccess: (next) => {
          setDraft(toDraft(next.letterhead));
          toast.show({ title: "Letterhead saved", tone: "success" });
        },
        onError: (thrown) => {
          fail(thrown, "Couldn't save the letterhead. Please try again.");
        },
      },
    );
  };
  return (
    <div className="mk-grid mk-g2" style={{ alignItems: "start" }}>
      <div>
        <LetterheadPicker
          draft={draft}
          onChange={setDraft}
          document={document}
          doctorChoices={choices}
          hasImage={settings.letterhead.has_image}
          hasLogo={settings.letterhead.has_logo}
          busy={upload.isPending || remove.isPending}
          errors={errors}
          onUploadImage={(slot, file) => {
            setErrors({});
            upload.mutate(
              { slot, file },
              {
                onSuccess: () => {
                  toast.show({
                    title:
                      slot === "logo" ? "Logo uploaded" : "Letterhead uploaded",
                    tone: "success",
                  });
                },
                onError: (thrown) => {
                  fail(thrown, "Couldn't upload that image. Please try again.");
                },
              },
            );
          }}
          onRemoveImage={(slot) => {
            remove.mutate(slot, {
              onSuccess: (next) => {
                setDraft((current) => ({ ...current, mode: next.mode }));
              },
              onError: (thrown) => {
                fail(thrown, "Couldn't remove that image. Please try again.");
              },
            });
          }}
        />
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 16,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="mk-btn mk-btn-primary"
            disabled={!dirty || update.isPending}
            onClick={save}
          >
            {update.isPending ? "Saving…" : "Save letterhead"}
          </button>
          {dirty ? (
            <button
              type="button"
              className="mk-btn mk-btn-ghost"
              onClick={() => {
                setDraft(saved);
                setErrors({});
              }}
            >
              Discard changes
            </button>
          ) : null}
        </div>
      </div>
      <LetterheadPreview document={shown} />
    </div>
  );
}
