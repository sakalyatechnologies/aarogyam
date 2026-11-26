import { useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type PatientId, type ToothNote } from "@aarogyam/api-client";

import { useClinic } from "../../../../clinic.js";

export type { ToothNote };

/** A tooth's notes (newest first) and `save`, which adds one. The client sends the `client_id` that makes a retry safe. */
export function useToothNotes(patientId: PatientId, tooth: number) {
  const { api, access } = useClinic();
  const client = useQueryClient();
  const key = ["tooth-notes", access.org_id, patientId, tooth];
  const list = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => unwrap(api.toothNotes(patientId, tooth, { signal })),
  });
  const save = async (body: string): Promise<boolean> => {
    const text = body.trim();
    if (text === "") return false;
    const result = await api.addToothNote(patientId, tooth, text);
    if (!result.ok) return false;
    await client.invalidateQueries({ queryKey: key });
    await client.invalidateQueries({ queryKey: ["dental-chart", access.org_id, patientId] });
    return true;
  };
  const items = [...(list.data?.items ?? [])].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return { supported: true, notes: items, loading: list.isPending, save };
}
