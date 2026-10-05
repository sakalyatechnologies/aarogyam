import { Check } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, type ClinicSettings, type ClinicSettingsChanges } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { Skeleton, useToast } from "@sakalya/ui";

import { useClinicSettings, useUpdateClinicSettings, useUploadLetterheadImage } from "../../queries.js";
import { StepFrame, TextField, type StepProps } from "./step-frame.js";

const PRACTICES = [
  { value: "solo", title: "Just me", hint: "One doctor" },
  { value: "team", title: "Me and a team", hint: "One doctor, with staff" },
  { value: "multi", title: "Several doctors", hint: "More than one doctor" },
] as const;

const SPECIALTIES: Readonly<Record<string, string>> = { dental: "Dental clinic", general: "General practice" };

/** Step 1: the clinic's name, address, phone, logo and how it practises. */
export function ClinicStep({ props, practice: savedPractice }: { props: StepProps; practice: string | null | undefined }) {
  const settings = useClinicSettings();
  if (settings.isPending) {
    return <Skeleton shape="block" />;
  }
  if (settings.isError) {
    return <ApiErrorNotice title="Couldn't load your clinic's details" error={settings.error} onRetry={() => void settings.refetch()} />;
  }
  return <ClinicForm settings={settings.data} props={props} savedPractice={savedPractice ?? "solo"} />;
}

function ClinicForm({ settings, props, savedPractice }: { settings: ClinicSettings; props: StepProps; savedPractice: string }) {
  const update = useUpdateClinicSettings();
  const upload = useUploadLetterheadImage();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: settings.name,
    phone: settings.phone ?? "",
    line1: settings.address.line1 ?? "",
    line2: settings.address.line2 ?? "",
    city: settings.address.city ?? "",
    state: settings.address.state ?? "",
    pincode: settings.address.pincode ?? "",
  });
  const [practice, setPractice] = useState(savedPractice);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const field = (key: keyof typeof form) => (value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = () => {
    setError(undefined);
    setFieldErrors({});
    // Only what changed goes to the API, so a value from before (a landline, say) is never re-checked.
    const start = {
      name: settings.name,
      phone: settings.phone ?? "",
      line1: settings.address.line1 ?? "",
      line2: settings.address.line2 ?? "",
      city: settings.address.city ?? "",
      state: settings.address.state ?? "",
      pincode: settings.address.pincode ?? "",
    };
    const addressChanged = (["line1", "line2", "city", "state", "pincode"] as const).some((key) => form[key] !== start[key]);
    const changes: ClinicSettingsChanges = {
      ...(form.name === start.name ? {} : { name: form.name }),
      ...(form.phone === start.phone ? {} : { phone: form.phone }),
      ...(addressChanged ? { address: { line1: form.line1, line2: form.line2, city: form.city, state: form.state, pincode: form.pincode } } : {}),
    };
    const finish = () => {
      props.done({ practice }).catch(() => {
        setError("Saved your clinic's details, but couldn't record this step. Please try again.");
      });
    };
    if (Object.keys(changes).length === 0) {
      finish();
      return;
    }
    update.mutate(
      changes,
      {
        onSuccess: finish,
        onError: (thrown) => {
          const apiError = apiErrorOf(thrown);
          const key = apiError?.field?.replace("address.", "");
          if (apiError !== undefined && key !== undefined && key in form) {
            setFieldErrors({ [key]: apiError.message });
          } else {
            setError(apiError?.message ?? "Couldn't save your clinic's details. Please try again.");
          }
        },
      },
    );
  };

  return (
    <StepFrame
      title="Your clinic"
      hint="Shown on your bills and prescriptions. You can change any of this later in Settings."
      props={props}
      onContinue={save}
      busy={update.isPending}
      error={error}
      canContinue={form.name.trim() !== ""}
    >
      <TextField id="sw-name" label="Clinic name" value={form.name} onChange={field("name")} error={fieldErrors.name} autoComplete="organization" />
      <span className="mk-flabel">Specialty</span>
      <div>
        <span className="sw-fixed">{SPECIALTIES[settings.specialty] ?? settings.specialty}</span>
      </div>
      <TextField id="sw-line1" label="Address" value={form.line1} onChange={field("line1")} placeholder="House, building and street" error={fieldErrors.line1} autoComplete="address-line1" />
      <input className="mk-tin" style={{ marginTop: 8 }} aria-label="Address line 2" placeholder="Area or landmark" value={form.line2} onChange={(event) => { field("line2")(event.target.value); }} />
      <div className="sw-three">
        <input className="mk-tin" aria-label="City" placeholder="City" value={form.city} onChange={(event) => { field("city")(event.target.value); }} />
        <input className="mk-tin" aria-label="State" placeholder="State" value={form.state} onChange={(event) => { field("state")(event.target.value); }} />
        <input className="mk-tin" aria-label="PIN code" placeholder="PIN code" inputMode="numeric" value={form.pincode} onChange={(event) => { field("pincode")(event.target.value); }} />
      </div>
      {fieldErrors.pincode === undefined ? null : <p role="alert" className="sw-field-error">{fieldErrors.pincode}</p>}
      <TextField id="sw-phone" label="Phone" value={form.phone} onChange={field("phone")} type="tel" inputMode="tel" autoComplete="tel" error={fieldErrors.phone} />

      <span className="mk-flabel" id="sw-logo-label">
        Logo
      </span>
      <div className="sw-logo">
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg"
          aria-labelledby="sw-logo-label"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen === undefined) {
              return;
            }
            upload.mutate(
              { slot: "logo", file: chosen },
              {
                onSuccess: () => {
                  toast.show({ title: "Logo uploaded", tone: "success" });
                },
                onError: (thrown) => {
                  toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't upload that logo. Please try again.", tone: "danger" });
                },
              },
            );
            if (file.current !== null) {
              file.current.value = "";
            }
          }}
        />
        {settings.letterhead.has_logo ? (
          <span className="mk-pill up">
            <Check aria-hidden="true" size={14} /> Logo added
          </span>
        ) : (
          <span className="mk-hint" style={{ margin: 0 }}>
            PNG or JPEG, up to 2 MB. Optional.
          </span>
        )}
      </div>

      <span className="mk-flabel" id="sw-practice-label">
        How do you practise?
      </span>
      <div className="sw-choices" role="radiogroup" aria-labelledby="sw-practice-label">
        {PRACTICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={practice === choice.value}
            className="sw-choice"
            onClick={() => {
              setPractice(choice.value);
            }}
          >
            <b>{choice.title}</b>
            <span>{choice.hint}</span>
          </button>
        ))}
      </div>
    </StepFrame>
  );
}
