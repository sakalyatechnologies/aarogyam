/**
 * X-rays and photos in the new Patient 360: an upload with a tag dropdown, and a gallery of the patient's images that
 * opens full size. Both use the existing attachments API: the tag is the file's `label` (the kind follows it), so no
 * new field is needed. Images are fetched through five-minute signed links, never a bucket address.
 */
import { useQuery } from "@tanstack/react-query";
import { ImagePlus } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, unwrap, type Attachment, type PatientId, type VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";

import { Empty } from "../../../components/mk/index.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useClinic } from "../../../clinic.js";
import { useAttachments, useUploadAttachment } from "../../../queries.js";
import { FileThumb } from "../file-thumb.js";

/** The tags offered on upload. Each one is stored as the file's label, with the kind that fits it. */
export const IMAGE_TAGS = [
  { value: "X-ray", label: "X-ray", kind: "xray" },
  { value: "Intraoral", label: "Intraoral", kind: "photo" },
  { value: "Extraoral", label: "Extraoral", kind: "photo" },
  { value: "Report", label: "Report", kind: "report" },
  { value: "Other", label: "Other", kind: "document" },
] as const;
export type ImageTag = (typeof IMAGE_TAGS)[number]["value"];

/** What the gallery shows: images and reports, not voice recordings or consent scans. */
export function isGalleryFile(file: Attachment): boolean {
  return file.kind !== "audio" && file.kind !== "consent";
}

/** Adds an X-ray or photo, tagged. Attached to the open visit when there is one. */
export function ImageUpload({ patientId, visitId }: { patientId: PatientId; visitId?: VisitId | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={<ImagePlus aria-hidden="true" className="size-4" />}
        onClick={() => {
          setOpen(true);
        }}
      >
        Add X-ray or photo
      </Button>
      {open ? (
        <UploadDialog
          patientId={patientId}
          visitId={visitId}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function UploadDialog({ patientId, visitId, onClose }: { patientId: PatientId; visitId: VisitId | undefined; onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [tag, setTag] = useState<ImageTag>("X-ray");
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const upload = useUploadAttachment(patientId);
  const toast = useToast();

  const submit = () => {
    const file = fileInput.current?.files?.[0];
    if (file === undefined) {
      setError("Choose a file first.");
      return;
    }
    const chosen = IMAGE_TAGS.find((t) => t.value === tag) ?? IMAGE_TAGS[0];
    setError(undefined);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", chosen.kind);
    form.set("label", chosen.value);
    if (visitId !== undefined) form.set("visit_id", visitId);
    if (caption.trim() !== "") form.set("caption", caption.trim());
    upload.mutate(form, {
      onSuccess: () => {
        toast.show({ title: `${chosen.label} added`, tone: "success" });
        onClose();
      },
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't upload that file. Please try again.");
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add an X-ray or photo"
      description={visitId === undefined ? "JPEG, PNG or PDF, up to 10 MB." : "It is kept with today's visit. JPEG, PNG or PDF, up to 10 MB."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={fileName === "" || upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Image" required>
          <input
            ref={fileInput}
            aria-label="Image"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(event) => {
              setFileName(event.target.files?.[0]?.name ?? "");
            }}
          />
        </Field>
        <Field label="Tag">
          <Select options={IMAGE_TAGS.map((t) => ({ value: t.value, label: t.label }))} value={tag} onValueChange={setTag} />
        </Field>
        <Field label="Caption (optional)">
          <TextInput
            value={caption}
            maxLength={300}
            onChange={(event) => {
              setCaption(event.target.value);
            }}
          />
        </Field>
        {error === undefined ? null : (
          <p role="alert" className="text-sm font-medium text-danger-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** One image at full size, through a short-lived link; a PDF opens in its own tab instead. */
function Viewer({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const { api, access } = useClinic();
  const link = useQuery({
    queryKey: ["attachment-link", access.org_id, file.id],
    queryFn: () => unwrap(api.getDownloadLink(file.id)),
    staleTime: 4 * 60_000,
  });
  const isImage = file.mime_type.startsWith("image/");
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`${file.label ?? "Image"}${file.caption == null ? "" : ` · ${file.caption}`}`}
      description={`Added ${formatDate(file.created_at)}${file.tooth == null ? "" : ` · tooth ${String(file.tooth)}`}`}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {link.isError ? (
        <ApiErrorNotice title="Couldn't open this image" error={link.error} onRetry={() => void link.refetch()} />
      ) : link.data === undefined ? (
        <SkeletonRows count={2} label="Loading the image" />
      ) : isImage ? (
        <img src={link.data.url} alt={file.label ?? "Patient image"} className="max-h-[70vh] w-full rounded-md object-contain" />
      ) : (
        <a className="mk-link" href={link.data.url} target="_blank" rel="noreferrer">
          Open the file
        </a>
      )}
    </Dialog>
  );
}

/** Thumbnails that open full size. Used by the gallery and by a visit's detail. */
export function ImageGrid({ files }: { files: readonly Attachment[] }) {
  const [open, setOpen] = useState<Attachment | undefined>(undefined);
  return (
    <>
      <ul aria-label="Images" className="p360-gallery m-0 list-none p-0">
        {files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              aria-label={`Open ${file.label ?? "image"}${file.caption == null ? "" : `, ${file.caption}`}, ${formatDate(file.created_at)}`}
              onClick={() => {
                setOpen(file);
              }}
            >
              <FileThumb file={file} size={96} />
              <span className="p360-tagline">{file.label ?? "Untagged"}</span>
              <span className="mk-hint" style={{ margin: 0 }}>
                {formatDate(file.created_at)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open === undefined ? null : (
        <Viewer
          file={open}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
    </>
  );
}

/** Every X-ray and photo of the patient, newest first, filtered by tag. */
export function GalleryBlock({ patientId, canUpload, visitId }: { patientId: PatientId; canUpload: boolean; visitId?: VisitId | undefined }) {
  const attachments = useAttachments(patientId);
  const [tag, setTag] = useState<string>("");
  const files = (attachments.data?.items ?? []).filter(isGalleryFile).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const tags = [...new Set(files.map((f) => f.label ?? "Untagged"))];
  const shown = tag === "" ? files : files.filter((f) => (f.label ?? "Untagged") === tag);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {tags.length > 1 ? (
          <Field label="Show" className="w-44">
            <Select options={[{ value: "", label: "All" }, ...tags.map((t) => ({ value: t, label: t }))]} value={tag} onValueChange={setTag} />
          </Field>
        ) : (
          <span />
        )}
        {canUpload ? <ImageUpload patientId={patientId} visitId={visitId} /> : null}
      </div>
      {attachments.isPending ? (
        <SkeletonRows count={2} label="Loading images" />
      ) : attachments.isError ? (
        <ApiErrorNotice title="Couldn't load the images" error={attachments.error} onRetry={() => void attachments.refetch()} />
      ) : shown.length === 0 ? (
        <Empty art="notes" title="No images yet">
          X-rays and photos you add appear here.
        </Empty>
      ) : (
        <ImageGrid files={shown} />
      )}
    </div>
  );
}
