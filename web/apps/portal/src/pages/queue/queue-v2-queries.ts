/** Queries for the Front desk board (New look): calling a token and moving it along. */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { unwrap, type QueueTokenId } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";

/** `POST /queue/{id}/call`: the waiting token becomes Called. */
export function useCallToken() {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: QueueTokenId) => unwrap(api.callQueueToken(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["queue", access.org_id] });
      void queryClient.invalidateQueries({ queryKey: ["today", access.org_id] });
    },
  });
}
