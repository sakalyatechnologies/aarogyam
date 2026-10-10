/** Visit-screen mutations that have no home in the shared `queries.ts`, kept here so this work never touches it. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type NoteContent, type NoteId, type PatientId, type VisitId } from "@aarogyam/api-client";

import { useClinic } from "../../clinic.js";
import { recordingLanguage } from "./voice/dictation.js";
import type { FinishedRecording } from "./voice/use-voice-recorder.js";

/** Adds an addendum to a signed note, then refreshes the visit. */
export function useAddAddendum(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: NoteId; body: string }) => unwrap(api.addAddendum(id, { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
}

/** Saves a draft note's sections. */
export function useEditNote(visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: NoteId; content: NoteContent }) => unwrap(api.editNote(id, content)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
}

/** Where a recording belongs: a draft note, or an addendum to a signed one. */
export interface RecordingTarget {
  noteId: NoteId;
  visitId: VisitId;
  addendumId?: string;
}

/** Uploads a kept recording as an attachment linked to its note (and addendum). */
export function useUploadRecording(patientId: PatientId, visitId: VisitId) {
  const { api, access } = useClinic();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recording, target }: { recording: FinishedRecording; target: RecordingTarget }) => {
      const form = new FormData();
      form.set("file", recording.blob, `voice-note.${recording.mimeType === "audio/mp4" ? "m4a" : recording.mimeType === "audio/ogg" ? "ogg" : "webm"}`);
      form.set("kind", "audio");
      form.set("note_id", target.noteId);
      form.set("visit_id", target.visitId);
      form.set("duration_seconds", String(recording.seconds));
      const language = recordingLanguage(recording.language);
      if (language !== undefined) {
        form.set("language", language);
      }
      if (target.addendumId !== undefined) {
        form.set("addendum_id", target.addendumId);
      }
      return unwrap(api.uploadAttachment(patientId, form));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] });
      void queryClient.invalidateQueries({ queryKey: ["attachments", access.org_id, patientId] });
    },
  });
}

/** One tooth's full history, including superseded rows. Refreshed with the chart because the key shares its prefix. */
export function useToothHistory(patientId: PatientId, tooth: number | undefined) {
  const { api, access } = useClinic();
  return useQuery({
    queryKey: ["dental-chart", access.org_id, patientId, "tooth", tooth],
    queryFn: ({ signal }) => (tooth === undefined ? Promise.reject(new Error("no tooth")) : unwrap(api.getDentalChart(patientId, tooth, { signal }))),
    enabled: tooth !== undefined,
  });
}
