/** Today's photo of a tooth, drawn under its picture in Show patient. Loaded when a tooth sheet opens. */
import { useQuery } from "@tanstack/react-query";

import { unwrap, type Attachment, type PatientId } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { useAttachments } from "../../../queries.js";

const sameDay = (iso: string): boolean => new Date(iso).toDateString() === new Date().toDateString();

/** Today's photos taken for a tooth, newest first. */
export function photosOf(files: readonly Attachment[], tooth: number): Attachment[] {
  return files
    .filter((f) => f.kind === "photo" && f.tooth === tooth && f.mime_type.startsWith("image/") && sameDay(f.taken_at ?? f.created_at))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The photo, through a five-minute signed link (never a bucket address). Loads only when it scrolls near. */
function TodayPhoto({ file, tooth }: { file: Attachment; tooth: number }) {
  const { api, access } = useClinic();
  const link = useQuery({
    queryKey: ["attachment-link", access.org_id, file.id],
    queryFn: () => unwrap(api.getDownloadLink(file.id)),
    staleTime: 4 * 60_000,
  });
  if (link.data === undefined) return null;
  return (
    <figure className="ps-photo" data-tooth-photo={tooth}>
      <img src={link.data.url} alt={`Photo of tooth ${String(tooth)}`} loading="lazy" />
      <figcaption>Your photo, today</figcaption>
    </figure>
  );
}


export function ToothPhoto({ patientId, tooth }: { patientId: PatientId; tooth: number }) {
  const files = useAttachments(patientId);
  const first = photosOf(files.data?.items ?? [], tooth)[0];
  return first === undefined ? null : <TodayPhoto file={first} tooth={tooth} />;
}
