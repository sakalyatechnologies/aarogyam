/** Visit-screen mutations that have no home in the shared `queries.ts`, kept here so this work never touches it. */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { unwrap, type NoteId, type VisitId } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/** Adds an addendum to a signed note, then refreshes the visit. */
export function useAddAddendum(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: NoteId; body: string }) => unwrap(api.addAddendum(id, { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
}
