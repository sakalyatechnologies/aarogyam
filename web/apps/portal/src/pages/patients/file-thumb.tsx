import { useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react";

import { unwrap, type Attachment } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/** A small preview of a JPEG or PNG, fetched through a five-minute link from the API (never a bucket address). */
export function FileThumb({ file, size = 48 }: { file: Attachment; size?: number }) {
  const { api, access } = useClinic();
  const isImage = file.mime_type.startsWith("image/");
  const link = useQuery({
    queryKey: ["attachment-link", access.org_id, file.id],
    queryFn: () => unwrap(api.getDownloadLink(file.id)),
    enabled: isImage,
    staleTime: 4 * 60_000,
  });
  const box = { width: size, height: size };
  if (isImage && link.data !== undefined) {
    return <img src={link.data.url} alt={file.label ?? "Patient file"} className="shrink-0 rounded-md object-cover" style={box} loading="lazy" />;
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted" style={box} aria-hidden="true">
      <FileText className="size-5" />
    </span>
  );
}
