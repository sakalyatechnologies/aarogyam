import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, type AttachmentId, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatBytes, formatDateTime } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, TextInput, useToast } from "@sakalya/ui";
import { MkCard, Empty } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { useAttachments, useDownloadLink, useUploadAttachment } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const KINDS = [
  { value: "photo", label: "Photo" },
  { value: "xray", label: "X-ray" },
  { value: "report", label: "Report" },
  { value: "document", label: "Document" },
  { value: "audio", label: "Audio" },
  { value: "consent", label: "Consent" },
] as const;

/** A patient's files: photos, x-rays, reports and consents. */
export function FilesPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const attachments = useAttachments(patientId);
  const downloadLink = useDownloadLink();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  const onDownload = (id: AttachmentId) => {
    downloadLink.mutate(id, {
      onSuccess: (link) => {
        window.open(link.url, "_blank", "noopener,noreferrer");
      },
      onError: (thrown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't open that file.", tone: "danger" });
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {can("clinical.write") ? (
        <div className="flex justify-end">
          <Button
            icon={<Upload aria-hidden="true" className="size-4" />}
            onClick={() => {
              setUploading(true);
            }}
          >
            Upload
          </Button>
        </div>
      ) : null}
      {attachments.isPending ? (
        <SkeletonRows count={3} label="Loading files" />
      ) : attachments.isError ? (
        <ApiErrorNotice title="Couldn't load files" error={attachments.error} onRetry={() => void attachments.refetch()} />
      ) : attachments.data.items.length === 0 ? (
        <Empty title="No files yet">Photos, x-rays, reports and consents will show here.</Empty>
      ) : (
        <MkCard>
          <ul className="divide-y divide-border">
            {attachments.data.items.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-text">{file.caption ?? KINDS.find((k) => k.value === file.kind)?.label ?? file.kind}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(file.created_at)} · {formatBytes(file.size_bytes)}
                    {file.tooth == null ? "" : ` · Tooth ${String(file.tooth)}`}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  icon={<Download aria-hidden="true" className="size-4" />}
                  disabled={downloadLink.isPending}
                  onClick={() => {
                    onDownload(file.id);
                  }}
                >
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </MkCard>
      )}
      {uploading ? (
        <UploadDialog
          patientId={patientId}
          onOpenChange={() => {
            setUploading(false);
          }}
        />
      ) : null}
    </div>
  );
}

function UploadDialog({ patientId, onOpenChange }: { patientId: PatientId; onOpenChange: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("document");
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
    setError(undefined);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    if (caption.trim() !== "") form.set("caption", caption.trim());
    upload.mutate(form, {
      onSuccess: () => {
        toast.show({ title: "File uploaded", tone: "success" });
        onOpenChange();
      },
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't upload that file. Please try again.");
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Upload a file"
      description="JPEG, PNG, PDF or DICOM, up to 10 MB."
      footer={
        <>
          <Button variant="secondary" onClick={onOpenChange}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={fileName === "" || upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="File" required>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,application/pdf,application/dicom"
            onChange={(event) => {
              setFileName(event.target.files?.[0]?.name ?? "");
            }}
          />
        </Field>
        <Field label="Kind">
          <Select options={KINDS} value={kind} onValueChange={setKind} />
        </Field>
        <Field label="Caption">
          <TextInput
            value={caption}
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
