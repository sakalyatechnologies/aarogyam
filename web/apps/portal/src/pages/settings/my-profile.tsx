import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Heart, Leaf, Smile, Sparkles, Star, Sun, type LucideIcon } from "lucide-react";

import { apiErrorOf, unwrap, type Avatar } from "@aarogyam/api-client";
import { useToast } from "@sakalya/ui";

import { Initials, MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";

/** The pictures this portal draws for a preset id. The server stores only the id; each app ships its own pictures. */
export const PRESETS: readonly { id: string; label: string; Icon: LucideIcon; tone: string }[] = [
  { id: "tooth_1", label: "Smile", Icon: Smile, tone: "#0f766e" },
  { id: "tooth_2", label: "Heart", Icon: Heart, tone: "#be185d" },
  { id: "tooth_3", label: "Star", Icon: Star, tone: "#b45309" },
  { id: "tooth_4", label: "Sun", Icon: Sun, tone: "#c2410c" },
  { id: "tooth_5", label: "Leaf", Icon: Leaf, tone: "#15803d" },
  { id: "tooth_6", label: "Sparkle", Icon: Sparkles, tone: "#6d28d9" },
];

type Errors = { name?: string | undefined; phone?: string | undefined; photo?: string | undefined; form?: string | undefined };

const MAX_PHOTO = 2 * 1024 * 1024;

/** What the person picked for their picture and has not saved yet. */
type Pick = { kind: "preset"; id: string } | { kind: "file"; file: File; url: string } | { kind: "remove" };

/** The avatar as drawn: a photo, a preset's picture, or the initials. */
function AvatarFace({ name, avatar, pick, size = 72 }: { name: string; avatar: Avatar | null | undefined; pick: Pick | undefined; size?: number }) {
  const shown: { preset?: string | null | undefined; photo?: string | null | undefined } =
    pick === undefined ? { preset: avatar?.preset, photo: avatar?.photo_url } : pick.kind === "preset" ? { preset: pick.id } : pick.kind === "file" ? { photo: pick.url } : {};
  const style = { width: size, height: size };
  if (shown.photo != null && shown.photo !== "") {
    return <img className="st-me-face" style={style} src={shown.photo} alt="" />;
  }
  const preset = PRESETS.find((p) => p.id === shown.preset);
  if (preset !== undefined) {
    return (
      <span className="st-me-face st-me-preset" style={{ ...style, background: preset.tone }} aria-hidden="true">
        <preset.Icon style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  }
  return <Initials name={name} size="lg" />;
}

const phoneProblem = (phone: string): string | undefined => (phone.trim() === "" || /^\+?\d{10,15}$/.test(phone.replace(/[\s-]/g, "")) ? undefined : "Enter a valid phone number, such as 98765 43210.");

/**
 * Settings, "My profile": the signed-in person's own name, phone and picture, saved together. The name and phone go to
 * `PATCH /me` (only what changed), the picture to `PUT /me/avatar` or `DELETE /me/avatar`.
 */
export function MyProfile() {
  const { api, me, session, can } = useClinic();
  const queryClient = useQueryClient();
  const toast = useToast();
  const nameId = useId();
  const phoneId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const savedName = session.user.display_name;
  const savedPhone = me.phone ?? "";
  const [name, setName] = useState(savedName);
  const [phone, setPhone] = useState(savedPhone);
  const [pick, setPick] = useState<Pick | undefined>(undefined);
  const [errors, setErrors] = useState<Errors>({});

  // A photo chosen here is shown from a temporary link, which is released when it is replaced or the page closes.
  useEffect(() => {
    const url = pick?.kind === "file" ? pick.url : undefined;
    return () => {
      if (url !== undefined && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
  }, [pick]);

  const save = useMutation({
    mutationFn: async () => {
      const changes: { display_name?: string; phone?: string } = {};
      if (name.trim() !== savedName) changes.display_name = name.trim();
      if (phone.trim() !== savedPhone) changes.phone = phone.trim();
      const profile = Object.keys(changes).length > 0 ? await unwrap(api.updateMe(changes)) : undefined;
      if (pick?.kind === "preset") {
        const form = new FormData();
        form.set("preset", pick.id);
        await unwrap(api.putMyAvatar(form));
      } else if (pick?.kind === "file") {
        const form = new FormData();
        form.set("file", pick.file);
        await unwrap(api.putMyAvatar(form));
      } else if (pick?.kind === "remove") {
        await unwrap(api.deleteMyAvatar());
      }
      return profile;
    },
    onSuccess: (profile) => {
      setErrors({});
      // The server's own form of the phone (`+91…`), so the form is clean once what was saved is fetched again.
      if (profile !== undefined) {
        setName(profile.display_name);
        setPhone(profile.phone ?? "");
      }
      toast.show({ title: "Saved", tone: "success" });
      // The new name, phone and picture reach the header and this form once they are fetched again.
      void Promise.all([queryClient.invalidateQueries({ queryKey: ["me"] }), queryClient.invalidateQueries({ queryKey: ["session"] })]).then(() => { setPick(undefined); });
    },
    onError: (thrown) => {
      const error = apiErrorOf(thrown);
      const message = error?.message ?? "Couldn't save your profile. Please try again.";
      if (error?.field === "display_name") setErrors({ name: message });
      else if (error?.field === "phone") setErrors({ phone: message });
      else if (error?.status === 409) setErrors({ phone: message });
      else setErrors({ form: message });
    },
  });

  const dirty = name.trim() !== savedName || phone.trim() !== savedPhone || pick !== undefined;
  const hasPicture = pick === undefined ? Boolean(session.user.avatar?.photo_url ?? session.user.avatar?.preset) : pick.kind !== "remove";

  const choosePhoto = (file: File | undefined) => {
    if (file === undefined) return;
    if ((file.type !== "image/png" && file.type !== "image/jpeg") || file.size > MAX_PHOTO) {
      setErrors((prev) => ({ ...prev, photo: "Choose a PNG or JPEG photo of at most 2 MB." }));
      return;
    }
    setErrors((prev) => ({ ...prev, photo: undefined }));
    setPick({ kind: "file", file, url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "" });
  };

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Errors = {};
    if (name.trim() === "") next.name = "Enter your name.";
    else if (name.trim().length > 200) next.name = "Your name can be at most 200 characters.";
    const phoneError = phoneProblem(phone);
    if (phoneError !== undefined) next.phone = phoneError;
    setErrors(next);
    if (next.name !== undefined || next.phone !== undefined) return;
    save.mutate();
  };

  return (
    <MkCard title="My profile" hint={can("settings.manage") ? "Clinic owner. The clinic's details are under Clinic profile." : "Only the clinic owner can change the clinic profile."}>
      <form className="st-me" onSubmit={onSubmit} noValidate>
        <div className="st-me-head">
          <div className="st-me-photo">
            <AvatarFace name={name || savedName} avatar={session.user.avatar} pick={pick} />
            <button type="button" className="st-me-camera" aria-label="Upload a photo" onClick={() => { fileInput.current?.click(); }}>
              <Camera className="size-3.5" aria-hidden="true" />
            </button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden aria-label="Photo file" onChange={(event) => { choosePhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
          </div>
          <div className="st-me-who">
            <b>{savedName}</b>
            <span className="mk-hint">{session.clinic.name}</span>
          </div>
        </div>

        <div role="group" aria-label="Choose an avatar" className="st-me-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="st-me-pick"
              aria-label={`Avatar: ${preset.label}`}
              aria-pressed={pick?.kind === "preset" ? pick.id === preset.id : pick === undefined && session.user.avatar?.preset === preset.id}
              onClick={() => { setPick({ kind: "preset", id: preset.id }); setErrors((prev) => ({ ...prev, photo: undefined })); }}
            >
              <span className="st-me-face st-me-preset" style={{ width: 40, height: 40, background: preset.tone }} aria-hidden="true">
                <preset.Icon style={{ width: 20, height: 20 }} />
              </span>
            </button>
          ))}
          {hasPicture ? (
            <button type="button" className="mk-btn mk-btn-ghost" onClick={() => { setPick({ kind: "remove" }); }}>
              Remove picture
            </button>
          ) : null}
        </div>
        {errors.photo === undefined ? null : (
          <p role="alert" className="st-field-error">
            {errors.photo}
          </p>
        )}

        <div className="st-me-fields">
          <div className="st-field">
            <label className="mk-flabel" htmlFor={nameId}>
              Display name
            </label>
            <input id={nameId} className="mk-tin" value={name} aria-invalid={errors.name !== undefined} aria-describedby={errors.name === undefined ? undefined : `${nameId}-err`} onChange={(event) => { setName(event.target.value); }} />
            {errors.name === undefined ? null : (
              <p id={`${nameId}-err`} role="alert" className="st-field-error">
                {errors.name}
              </p>
            )}
          </div>
          <div className="st-field">
            <label className="mk-flabel" htmlFor={phoneId}>
              Phone
            </label>
            <input id={phoneId} className="mk-tin mk-mono" inputMode="tel" value={phone} placeholder="98765 43210" aria-invalid={errors.phone !== undefined} aria-describedby={errors.phone === undefined ? undefined : `${phoneId}-err`} onChange={(event) => { setPhone(event.target.value); }} />
            {errors.phone === undefined ? null : (
              <p id={`${phoneId}-err`} role="alert" className="st-field-error">
                {errors.phone}
              </p>
            )}
          </div>
        </div>
        {errors.form === undefined ? null : (
          <p role="alert" className="mk-pill down st-form-error">
            {errors.form}
          </p>
        )}
        <div className="st-actions">
          <button type="submit" className="mk-btn mk-btn-primary" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </MkCard>
  );
}
