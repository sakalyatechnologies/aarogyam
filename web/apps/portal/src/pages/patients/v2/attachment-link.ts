import { useQuery } from "@tanstack/react-query";

import { unwrap, type Attachment } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";

/** A file's five-minute signed link (never a bucket address), shared by the viewer, thumbnails and Explain mode. */
export function useAttachmentLink(file: Attachment | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["attachment-link", access.org_id, file?.id],
    queryFn: () => (file === undefined ? Promise.reject(new Error("no file")) : unwrap(api.getDownloadLink(file.id))),
    enabled: file !== undefined,
    staleTime: 4 * 60_000,
  });
}
