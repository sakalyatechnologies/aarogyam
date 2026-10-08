import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { apiErrorOf, type AttachmentId, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatBytes, formatDateTime } from "@aarogyam/app-kit";
import { Button, Dialog, Field, Select, Switch, TextInput, useToast } from "@sakalya/ui";
import { MkCard, Empty } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { useAttachments, useDownloadLink, useUploadAttachment } from "../../queries.js";
import { useSetFileSharing } from "./queries.js";
import { NO_LABEL, PRESET_LABELS, groupByLabel, parseTooth } from "./file-labels.js";
import { FileThumb } from "./file-thumb.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const OTHER = "__other__";

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
  const sharing = useSetFileSharing(patientId);
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
        <div className="flex flex-col gap-4">
          {groupByLabel(attachments.data.items).map((group) => (
            <MkCard key={group.label}>
              <h3 className="text-sm font-bold text-text">
                {group.label} <span className="font-normal text-muted">({String(group.files.length)})</span>
              </h3>
              <ul aria-label={group.label} className="mt-2 divide-y divide-border">
                {group.files.map((file) => (
                  <li key={file.id} className="flex items-center gap-3 py-3">
                    <FileThumb file={file} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-text">{file.caption ?? KINDS.find((k) => k.value === file.kind)?.label ?? file.kind}</p>
                      <p className="text-xs text-muted">
                        {formatDateTime(file.created_at)} · {formatBytes(file.size_bytes)}
                        {file.tooth == null ? "" : ` · Tooth ${String(file.tooth)}`}
                      </p>
                    </div>
                    {can("clinical.write") && file.kind !== "audio" ? (
                      <Switch
                        label="Share with patient"
                        checked={file.shared_with_patient}
                        disabled={sharing.isPending}
                        onCheckedChange={(shared) => {
                          sharing.mutate(
                            { id: file.id, shared },
                            {
                              onSuccess: () => toast.show({ title: shared ? "Shared with the patient's app" : "No longer shared", tone: "success" }),
                              onError: (thrown) => toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't change sharing.", tone: "danger" }),
                            },
                          );
                        }}
                      />
                    ) : null}
                    <Button
                      variant="secondary"
                      icon={<Download aria-hidden="true" className="size-4" />}
                      disabled={downloadLink.isPending}
                      aria-label={`Open ${file.caption ?? group.label}`}
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
          ))}
        </div>
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
  const [preset, setPreset] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [toothText, setToothText] = useState("");
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
    const label = (preset === OTHER ? custom : preset).trim();
    if (label.length > 60) {
      setError("A label can be at most 60 characters.");
      return;
    }
    const tooth = toothText.trim() === "" ? undefined : parseTooth(toothText);
    if (toothText.trim() !== "" && tooth === undefined) {
      setError("Tooth must be an FDI number such as 11 to 48, or 51 to 85 for baby teeth.");
      return;
    }
    setError(undefined);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    if (caption.trim() !== "") form.set("caption", caption.trim());
    if (label !== "") form.set("label", label);
    if (tooth !== undefined) form.set("tooth", String(tooth));
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
            aria-label="File"
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
        <Field label="Label">
          <Select
            options={[{ value: "", label: NO_LABEL }, ...PRESET_LABELS.map((l) => ({ value: l, label: l })), { value: OTHER, label: "Other…" }]}
            value={preset}
            onValueChange={setPreset}
          />
        </Field>
        {preset === OTHER ? (
          <Field label="Your label">
            <TextInput
              value={custom}
              maxLength={60}
              onChange={(event) => {
                setCustom(event.target.value);
              }}
            />
          </Field>
        ) : null}
        <Field label="Tooth (optional)">
          <TextInput
            inputMode="numeric"
            value={toothText}
            placeholder="36"
            onChange={(event) => {
              setToothText(event.target.value);
            }}
          />
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
