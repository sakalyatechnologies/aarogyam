// moves to sakalya-web: pick an uploaded letterhead or a generated design and choose what it
// shows. Controlled and API-free; the product wires saving and uploading.
import { useId, useRef, useState } from "react";

import type {
  Letterhead,
  LetterheadDocument,
  LetterheadShown,
  LetterheadSlot,
  PractitionerId,
} from "@aarogyam/api-client";

import { Toggle } from "../mk/index.js";
import { LETTERHEAD_TEMPLATES, LetterheadSheet } from "./letterhead.js";
import { withSampleDoctors } from "./sample.js";
import "./picker.css";

/** What the picker edits: the saved letterhead without the image flags. Empty text means none. */
export interface LetterheadDraft {
  mode: Letterhead["mode"];
  template: Letterhead["template"];
  accent: string;
  show: LetterheadShown;
  footer: string;
  email: string;
  timings: string;
  local_name: string;
  doctor_ids: readonly PractitionerId[];
}

/** A saved letterhead as an editable draft. */
export function toDraft(letterhead: Letterhead): LetterheadDraft {
  return {
    mode: letterhead.mode,
    template: letterhead.template,
    accent: letterhead.accent ?? "",
    show: letterhead.show,
    footer: letterhead.footer ?? "",
    email: letterhead.email ?? "",
    timings: letterhead.timings ?? "",
    local_name: letterhead.local_name ?? "",
    doctor_ids: letterhead.doctor_ids,
  };
}

/** A doctor the clinic may print on its letterhead. */
export interface DoctorChoice {
  id: PractitionerId;
  name: string;
  qualifications?: string | null | undefined;
  registration_number?: string | null | undefined;
  specialty?: string | null | undefined;
}

/**
 * The document as it would print with the draft applied, for live previews. `choices` are the
 * clinic's active doctors by name; with none picked the first four print, as the API does.
 */
export function applyDraft(
  document: LetterheadDocument,
  draft: LetterheadDraft,
  choices: readonly DoctorChoice[] = [],
): LetterheadDocument {
  const toLine = (doctor: DoctorChoice) => ({
    name: doctor.name,
    qualifications: doctor.qualifications ?? null,
    registration_number: doctor.registration_number ?? null,
    specialty: doctor.specialty ?? null,
  });
  const printed =
    choices.length === 0
      ? document.doctors
      : draft.doctor_ids.length === 0
        ? choices.slice(0, 4).map(toLine)
        : draft.doctor_ids.flatMap((id) =>
            choices.filter((doctor) => doctor.id === id).map(toLine),
          );
  return {
    ...document,
    doctors: printed,
    letterhead: {
      ...document.letterhead,
      mode: draft.mode,
      template: draft.template,
      accent: draft.accent === "" ? null : draft.accent,
      show: draft.show,
      footer: draft.footer === "" ? null : draft.footer,
      email: draft.email === "" ? null : draft.email,
      timings: draft.timings === "" ? null : draft.timings,
      local_name: draft.local_name === "" ? null : draft.local_name,
      doctor_ids: [...draft.doctor_ids],
    },
  };
}

const SHOWN_LABELS: readonly { key: keyof LetterheadShown; label: string }[] = [
  { key: "logo", label: "Logo" },
  { key: "doctors", label: "Doctors and qualifications" },
  { key: "registration", label: "Registration numbers" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "E-mail" },
  { key: "timings", label: "Timings" },
  { key: "gstin", label: "GSTIN" },
];

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg"];

export interface LetterheadPickerProps {
  draft: LetterheadDraft;
  onChange: (next: LetterheadDraft) => void;
  /** The clinic's document, used for the design thumbnails. */
  document: LetterheadDocument;
  /** Doctors the clinic may print, for the doctor choice. */
  doctorChoices: readonly DoctorChoice[];
  hasImage: boolean;
  hasLogo: boolean;
  /** Called with a checked file; the product uploads it. */
  onUploadImage: (slot: LetterheadSlot, file: File) => void;
  onRemoveImage: (slot: LetterheadSlot) => void;
  busy?: boolean;
  /** Per-field messages from the API, by its field names (`letterhead.footer` and so on). */
  errors?: Readonly<Record<string, string>>;
}

/** Tells why a file can't be used as a letterhead image, or `undefined` when it can. */
export function imageProblem(file: {
  size: number;
  type: string;
}): string | undefined {
  if (!IMAGE_TYPES.includes(file.type)) {
    return "Choose a PNG or JPG image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "That image is larger than 2 MB. Choose a smaller one.";
  }
  return undefined;
}

function ImageControl({
  slot,
  title,
  help,
  has,
  busy,
  onUpload,
  onRemove,
}: {
  slot: LetterheadSlot;
  title: string;
  help: string;
  has: boolean;
  busy: boolean;
  onUpload: (slot: LetterheadSlot, file: File) => void;
  onRemove: (slot: LetterheadSlot) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [problem, setProblem] = useState<string>();
  return (
    <div className="lhp-image">
      <label className="mk-flabel" htmlFor={id}>
        {title}
      </label>
      <p className="mk-hint" style={{ margin: "0 0 8px" }}>
        {help}
      </p>
      <div className="lhp-row">
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file === undefined) {
              return;
            }
            const found = imageProblem(file);
            setProblem(found);
            if (found === undefined) {
              onUpload(slot, file);
            }
            event.currentTarget.value = "";
          }}
        />
        {has ? (
          <button
            type="button"
            className="mk-btn mk-btn-ghost"
            disabled={busy}
            onClick={() => {
              onRemove(slot);
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {problem === undefined ? null : (
        <p
          role="alert"
          className="mk-hint"
          style={{ color: "var(--red)", margin: "6px 0 0" }}
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * Choose between the clinic's own letterhead image and one of six generated designs, then what
 * the design shows. It edits a draft; nothing is saved here.
 */
export function LetterheadPicker({
  draft,
  onChange,
  document,
  doctorChoices,
  hasImage,
  hasLogo,
  onUploadImage,
  onRemoveImage,
  busy = false,
  errors = {},
}: LetterheadPickerProps) {
  const set = (changes: Partial<LetterheadDraft>) => {
    onChange({ ...draft, ...changes });
  };
  const text = (
    key: "footer" | "email" | "timings" | "local_name",
    label: string,
    extra: { placeholder?: string; lang?: string } = {},
  ) => {
    const message = errors[`letterhead.${key}`];
    return (
      <div className="lhp-field">
        <label className="mk-flabel" htmlFor={`lhp-${key}`}>
          {label}
        </label>
        <input
          id={`lhp-${key}`}
          className="mk-tin"
          value={draft[key]}
          placeholder={extra.placeholder}
          lang={extra.lang}
          aria-invalid={message !== undefined}
          onChange={(event) => {
            set({ [key]: event.currentTarget.value });
          }}
        />
        {message === undefined ? null : (
          <p
            role="alert"
            className="mk-hint"
            style={{ color: "var(--red)", margin: "4px 0 0" }}
          >
            {message}
          </p>
        )}
      </div>
    );
  };
  const mode = draft.mode;
  const toggleDoctor = (id: PractitionerId) => {
    const has = draft.doctor_ids.includes(id);
    set({
      doctor_ids: has
        ? draft.doctor_ids.filter((x) => x !== id)
        : [...draft.doctor_ids, id].slice(0, 4),
    });
  };
  return (
    <div className="lhp">
      <div
        role="radiogroup"
        aria-label="Letterhead source"
        className="lhp-modes"
      >
        {(
          [
            ["template", "Generated design", "Filled from your clinic details"],
            ["upload", "My own letterhead", "Upload an image you already use"],
          ] as const
        ).map(([value, title, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            className="lhp-mode"
            onClick={() => {
              set({ mode: value });
            }}
          >
            <b>{title}</b>
            <span>{hint}</span>
          </button>
        ))}
      </div>
      {errors["letterhead.mode"] === undefined ? null : (
        <p role="alert" className="mk-hint" style={{ color: "var(--red)" }}>
          {errors["letterhead.mode"]}
        </p>
      )}

      {mode === "upload" ? (
        <ImageControl
          slot="letterhead"
          title="Letterhead image"
          help="PNG or JPG, up to 2 MB. Use a wide header, about 2000 by 400 pixels, with the clinic name, address and doctors already in it."
          has={hasImage}
          busy={busy}
          onUpload={onUploadImage}
          onRemove={onRemoveImage}
        />
      ) : (
        <>
          <div role="radiogroup" aria-label="Design" className="lhp-tiles">
            {LETTERHEAD_TEMPLATES.map((design) => (
              <button
                key={design.id}
                type="button"
                role="radio"
                aria-checked={draft.template === design.id}
                aria-label={design.name}
                title={design.hint}
                className="lhp-tile"
                onClick={() => {
                  set({ template: design.id });
                }}
              >
                <LetterheadSheet
                  thumbnail
                  document={withSampleDoctors(
                    applyDraft(
                      document,
                      { ...draft, mode: "template", template: design.id },
                      doctorChoices,
                    ),
                  )}
                />
                <span>{design.name}</span>
              </button>
            ))}
          </div>

          <div className="lhp-grid">
            <div className="lhp-field">
              <label className="mk-flabel" htmlFor="lhp-accent-hex">
                Accent colour
              </label>
              <div className="lhp-row">
                <input
                  type="color"
                  aria-label="Pick the accent colour"
                  value={
                    /^#[0-9a-fA-F]{6}$/.test(draft.accent)
                      ? draft.accent
                      : (document.brand ?? "#136650")
                  }
                  onChange={(event) => {
                    set({ accent: event.currentTarget.value.toUpperCase() });
                  }}
                />
                <input
                  id="lhp-accent-hex"
                  className="mk-tin mk-mono"
                  value={draft.accent}
                  placeholder="Same as your brand colour"
                  maxLength={7}
                  aria-invalid={errors["letterhead.accent"] !== undefined}
                  onChange={(event) => {
                    set({ accent: event.currentTarget.value });
                  }}
                />
              </div>
              {errors["letterhead.accent"] === undefined ? null : (
                <p
                  role="alert"
                  className="mk-hint"
                  style={{ color: "var(--red)", margin: "4px 0 0" }}
                >
                  {errors["letterhead.accent"]}
                </p>
              )}
            </div>
            {text("local_name", "Clinic name in your language", {
              placeholder: "For example the name in Hindi or Marathi",
              lang: "hi",
            })}
          </div>

          <ImageControl
            slot="logo"
            title="Logo"
            help="PNG or JPG, up to 2 MB. A square or wide logo on a plain background works best."
            has={hasLogo}
            busy={busy}
            onUpload={onUploadImage}
            onRemove={onRemoveImage}
          />

          <fieldset className="lhp-shown">
            <legend className="mk-flabel">Show on the letterhead</legend>
            {SHOWN_LABELS.map(({ key, label }) => (
              <div key={key} className="mk-setrow">
                <div>
                  <b>{label}</b>
                </div>
                <Toggle
                  checked={draft.show[key]}
                  label={`Show ${label.toLowerCase()}`}
                  onChange={(next) => {
                    set({ show: { ...draft.show, [key]: next } });
                  }}
                />
              </div>
            ))}
          </fieldset>

          {doctorChoices.length === 0 ? (
            <p className="mk-hint">
              Add doctors under Chairs and doctors, with their qualifications
              and registration numbers, to print them here.
            </p>
          ) : (
            <fieldset className="lhp-shown">
              <legend className="mk-flabel">Doctors printed (up to 4)</legend>
              <p className="mk-hint" style={{ margin: "0 0 6px" }}>
                {draft.doctor_ids.length === 0
                  ? "None chosen: the first four active doctors by name are printed."
                  : "Printed in the order chosen."}
              </p>
              {doctorChoices.map((doctor) => (
                <label key={doctor.id} className="lhp-check">
                  <input
                    type="checkbox"
                    checked={draft.doctor_ids.includes(doctor.id)}
                    disabled={
                      !draft.doctor_ids.includes(doctor.id) &&
                      draft.doctor_ids.length >= 4
                    }
                    onChange={() => {
                      toggleDoctor(doctor.id);
                    }}
                  />
                  {doctor.name}
                </label>
              ))}
              {errors["letterhead.doctor_ids"] === undefined ? null : (
                <p
                  role="alert"
                  className="mk-hint"
                  style={{ color: "var(--red)" }}
                >
                  {errors["letterhead.doctor_ids"]}
                </p>
              )}
            </fieldset>
          )}

          <div className="lhp-grid">
            {text("email", "Clinic e-mail", {
              placeholder: "care@yourclinic.in",
            })}
            {text("timings", "Timings", {
              placeholder: "Mon to Sat, 9 am to 7 pm",
            })}
          </div>
        </>
      )}
      <div className="lhp-field">
        {text("footer", "Footer line", {
          placeholder: "For appointments call 98765 43210",
        })}
      </div>
    </div>
  );
}
