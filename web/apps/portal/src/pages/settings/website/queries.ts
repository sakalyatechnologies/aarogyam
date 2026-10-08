import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type PhotoChanges, type SitePhoto, type WebsiteChanges, type WebsiteSettings } from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";

export function useWebsite() {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["website", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getWebsiteSettings({ signal })),
    // A published site's address is made within about two minutes; watch until it is ready.
    refetchInterval: (query) => (query.state.data?.published && query.state.data.domain.address_status === "pending" ? 10_000 : false),
  });
}

/** Saves changes and keeps the server's answer (the cleaned content and a fresh preview). */
export function useUpdateWebsite() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: WebsiteChanges) => unwrap(api.updateWebsite(changes)),
    onSuccess: (settings) => {
      queryClient.setQueryData<WebsiteSettings>(["website", access.org_id], settings);
    },
  });
}

export interface PhotoUpload {
  file: File;
  kind: SitePhoto["kind"];
  alt?: string;
}

function refresh(queryClient: ReturnType<typeof useQueryClient>, orgId: string) {
  return queryClient.invalidateQueries({ queryKey: ["website", orgId] });
}

export function useUploadPhoto() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, kind, alt }: PhotoUpload) => {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      if (alt !== undefined && alt !== "") {
        form.set("alt", alt);
      }
      return unwrap(api.uploadWebsitePhoto(form));
    },
    onSuccess: () => refresh(queryClient, access.org_id),
  });
}

export function useDescribePhoto() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: PhotoChanges }) => unwrap(api.describeWebsitePhoto(id, changes)),
    onSuccess: () => refresh(queryClient, access.org_id),
  });
}

export function useDeletePhoto() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api.deleteWebsitePhoto(id)),
    onSuccess: () => refresh(queryClient, access.org_id),
  });
}
