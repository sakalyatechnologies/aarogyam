import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";

import type { SitePhoto } from "@aarogyam/api-client";
import { Button, Field, TextInput } from "@sakalya/ui";

type Kind = SitePhoto["kind"];

const SINGLES: readonly { kind: Kind; title: string; hint: string }[] = [
  { kind: "logo", title: "Logo", hint: "Shown in the header. A transparent PNG works best." },
  { kind: "hero", title: "Top picture", hint: "The first picture visitors see. Portrait or square looks best." },
  { kind: "about", title: "About picture", hint: "Next to your story, such as the clinic or the team." },
];

export interface PicturesTabProps {
  photos: readonly SitePhoto[];
  busy: boolean;
  onUpload: (files: readonly File[], kind: Kind) => void;
  onDescribe: (photo: SitePhoto, alt: string) => void;
  onDelete: (photo: SitePhoto) => void;
}

function Picker({ kind, label, multiple, onFiles, disabled }: { kind: Kind; label: string; multiple?: boolean; onFiles: PicturesTabProps["onUpload"]; disabled: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        className="mk-sr"
        tabIndex={-1}
        aria-hidden="true"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple ?? false}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) {
            onFiles(files, kind);
          }
        }}
      />
      <Button
        variant="secondary"
        icon={<ImagePlus size={16} aria-hidden="true" />}
        disabled={disabled}
        onClick={() => {
          input.current?.click();
        }}
      >
        {label}
      </Button>
    </>
  );
}

/** Logo, top and about pictures, and the gallery. Each picture needs a short description for people who cannot see it. */
export function PicturesTab({ photos, busy, onUpload, onDescribe, onDelete }: PicturesTabProps) {
  const gallery = photos.filter((p) => p.kind === "gallery");
  return (
    <div className="wb-stack">
      <p className="wb-muted">JPEG, PNG or WebP, up to 5 MB each. Pictures are public once uploaded.</p>
      {SINGLES.map(({ kind, title, hint }) => {
        const photo = photos.find((p) => p.kind === kind);
        return (
          <section key={kind} className="wb-section">
            <h3 className="wb-h3">{title}</h3>
            <p className="wb-muted">{hint}</p>
            {photo !== undefined && (
              <div className="wb-pic">
                <img src={photo.url} alt={photo.alt ?? title} />
                <div>
                  <AltField photo={photo} onDescribe={onDescribe} />
                  <Button
                    variant="ghost"
                    icon={<Trash2 size={16} aria-hidden="true" />}
                    onClick={() => {
                      onDelete(photo);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}
            <Picker kind={kind} label={photo === undefined ? `Add ${title.toLowerCase()}` : `Replace ${title.toLowerCase()}`} onFiles={onUpload} disabled={busy} />
          </section>
        );
      })}

      <section className="wb-section">
        <h3 className="wb-h3">Gallery</h3>
        <p className="wb-muted">Show your clinic, equipment and team. Up to 60 pictures in all.</p>
        <ul className="wb-gallery">
          {gallery.map((photo) => (
            <li key={photo.id} className="wb-pic">
              <img src={photo.url} alt={photo.alt ?? "Gallery picture"} />
              <div>
                <AltField photo={photo} onDescribe={onDescribe} />
                <Button
                  variant="ghost"
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  onClick={() => {
                    onDelete(photo);
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <Picker kind="gallery" label="Add pictures" multiple onFiles={onUpload} disabled={busy} />
      </section>
    </div>
  );
}

function AltField({ photo, onDescribe }: { photo: SitePhoto; onDescribe: PicturesTabProps["onDescribe"] }) {
  return (
    <Field label="Description" hint={photo.alt == null || photo.alt === "" ? "Add a few words about what the picture shows." : undefined}>
      <TextInput
        key={photo.alt ?? ""}
        defaultValue={photo.alt ?? ""}
        maxLength={200}
        onBlur={(event) => {
          if (event.target.value.trim() !== (photo.alt ?? "")) {
            onDescribe(photo, event.target.value);
          }
        }}
      />
    </Field>
  );
}
