// Which X-rays Own X-ray can show (kept apart from the lazy view so the page can ask without loading it).
import { useMemo } from "react";

import type { Attachment, PatientId, VisitId } from "@aarogyam/api-client";

import { useAttachments } from "../../../queries.js";

/** X-rays and OPGs the browser can draw: this visit's first, then the newest. */
export function pickXrays(files: readonly Attachment[], visitId: VisitId | undefined): Attachment[] {
  return files
    .filter((f) => f.kind === "xray" && f.mime_type.startsWith("image/"))
    .sort((a, b) => Number(b.visit_id === visitId) - Number(a.visit_id === visitId) || b.created_at.localeCompare(a.created_at));
}

export function useOwnXrays(patientId: PatientId | undefined, visitId: VisitId | undefined) {
  const attachments = useAttachments(patientId);
  const images = useMemo(() => pickXrays(attachments.data?.items ?? [], visitId), [attachments.data, visitId]);
  return { images, loading: attachments.isPending };
}
