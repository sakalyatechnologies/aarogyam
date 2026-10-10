/**
 * The open visit behind the Patient 360 screen, shared by every block in every layout: the doctor's draft note, the
 * prescription draft, the follow-up choice and Finish. The note text lives here (not in a block) so the same
 * draft shows in the quick picks, the voice block and a drawer, and closing a drawer never loses typing.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  apiErrorOf,
  unwrap,
  type NoteId,
  type PatientId,
  type PatientMessage,
  type Procedure,
  type Prescription,
  type RxItem,
  type Visit,
  type VisitId,
} from "@aarogyam/api-client";

import { useClinic } from "../../../clinic.js";
import { useStartVisit, useVisit, useVisits } from "../../../queries.js";
import { useCreatePrescription, useLastPrescription, usePrescriptions } from "../../prescriptions/queries.js";
import type { RxDraftHandle } from "../../prescriptions/prescription-page.js";
import { finishVisit, type FollowUp } from "./finish-visit.js";

export const NOTE_SECTIONS = [
  { key: "subjective", label: "Subjective" },
  { key: "objective", label: "Objective" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
] as const;
export type SectionKey = (typeof NOTE_SECTIONS)[number]["key"];
export type NoteValues = Record<SectionKey, string>;
const EMPTY: NoteValues = { subjective: "", objective: "", assessment: "", plan: "" };

/** What the celebration card shows once a visit is finished. */
export interface FinishedVisit {
  visit: Visit;
  procedures: number;
  noteSigned: boolean;
  /** The prescription issued during this visit, newest first, when there is one. */
  rx: Prescription | undefined;
  followUp: FollowUp | null;
}

export interface VisitSession {
  patientId: PatientId;
  /** Doctors and others who may write clinical records. */
  canWrite: boolean;
  /** May issue prescriptions. */
  canRx: boolean;
  visit: Visit | undefined;
  visitLoading: boolean;
  startVisit: () => void;
  starting: boolean;
  procedures: readonly Procedure[];
  note: {
    hasDraft: boolean;
    values: NoteValues;
    dirty: boolean;
    saving: boolean;
    starting: boolean;
    set: (key: SectionKey, value: string) => void;
    /** Adds a quick-pick line to its section, once; starts the note first when there is none. */
    pick: (key: SectionKey, text: string) => void;
    save: () => Promise<void>;
    start: () => void;
    noteId: NoteId | undefined;
  };
  rx: {
    draft: Prescription | undefined;
    /** Bumps when the draft is changed from outside the editor, so the editor reloads from the server. */
    version: number;
    handle: RefObject<RxDraftHandle | null>;
    busy: boolean;
    start: () => void;
    quick: (() => void) | undefined;
    addItems: (items: RxItem[]) => Promise<void>;
    /** The prescription issued on screen this visit (its one-time PIN message is kept for the sharing prompt). */
    issued: { rx: Prescription; message: PatientMessage } | undefined;
    noteIssued: (rx: Prescription, message: PatientMessage) => void;
    dismissIssued: () => void;
  };
  follow: FollowUp | null;
  setFollow: (value: FollowUp | null) => void;
  voiceOpen: boolean;
  setVoiceOpen: (open: boolean) => void;
  finishing: boolean;
  finish: () => Promise<FinishedVisit | undefined>;
  /** Set by the caller to tell the screen about an error to show. */
  error: string | undefined;
}

const Context = createContext<VisitSession | null>(null);

export function useVisitSession(): VisitSession {
  const value = useContext(Context);
  if (value === null) {
    throw new Error("useVisitSession must be used inside a VisitSessionProvider");
  }
  return value;
}

function valuesOf(note: { sections: { subjective?: string | null; objective?: string | null; assessment?: string | null; plan?: string | null } } | undefined): NoteValues {
  if (note === undefined) return EMPTY;
  return {
    subjective: note.sections.subjective ?? "",
    objective: note.sections.objective ?? "",
    assessment: note.sections.assessment ?? "",
    plan: note.sections.plan ?? "",
  };
}

const sameValues = (a: NoteValues, b: NoteValues) => NOTE_SECTIONS.every(({ key }) => a[key] === b[key]);

export function VisitSessionProvider({ patientId, children }: { patientId: PatientId; children: ReactNode }) {
  const { api, access, session, can } = useClinic();
  const queryClient = useQueryClient();
  const canClinical = can("clinical.read") || can("clinical.write");
  const canWrite = can("clinical.write");
  const canRx = can("prescriptions.issue");

  // The open visit and what is in it.
  const visits = useVisits(canClinical ? patientId : undefined);
  const visit = visits.data?.items.find((v) => v.status === "open");
  const detail = useVisit(visit?.id).data;
  const startVisitMutation = useStartVisit(patientId);

  const refreshRecord = useCallback(
    (visitId: VisitId) => {
      for (const key of ["timeline", "visits", "procedures", "dental-chart"]) {
        void queryClient.invalidateQueries({ queryKey: [key, access.org_id, patientId] });
      }
      void queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] });
    },
    [queryClient, access.org_id, patientId],
  );

  // The doctor's own draft note, and the edits on screen over it.
  const draftNote = detail?.notes.find((n) => n.status === "draft" && n.author.id === session.membership.id);
  const base = useMemo(() => valuesOf(draftNote), [draftNote]);
  const [edits, setEdits] = useState<{ noteId: string; values: NoteValues } | undefined>(undefined);
  const values = edits !== undefined && edits.noteId === draftNote?.id ? edits.values : base;
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  const dirty = draftNote !== undefined && !sameValues(values, base);

  const createNote = useMutation({
    mutationFn: (visitId: VisitId) => unwrap(api.createNote(visitId, { kind: "soap" })),
    onSuccess: (_note, visitId) => queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visitId] }),
  });
  const editNote = useMutation({
    mutationFn: ({ id, content }: { id: NoteId; content: { sections: Record<string, string> } }) => unwrap(api.editNote(id, content)),
    onSuccess: () => (visit === undefined ? undefined : queryClient.invalidateQueries({ queryKey: ["visit", access.org_id, visit.id] })),
  });
  const signNote = useMutation({ mutationFn: (id: NoteId) => unwrap(api.signNote(id)) });
  const closeVisit = useMutation({ mutationFn: (id: VisitId) => unwrap(api.closeVisit(id)) });

  const saveNote = useCallback(async () => {
    if (draftNote === undefined) return;
    const sent = valuesRef.current;
    if (sameValues(sent, valuesOf(draftNote))) return;
    const sections: Record<string, string> = {};
    for (const { key } of NOTE_SECTIONS) {
      if (sent[key].trim() !== "") sections[key] = sent[key].trim();
    }
    await editNote.mutateAsync({ id: draftNote.id, content: { sections } });
  }, [draftNote, editNote]);

  const startNote = useCallback(
    async (seed?: { key: SectionKey; text: string }) => {
      if (visit === undefined) return;
      const created = await createNote.mutateAsync(visit.id);
      if (seed !== undefined) {
        setEdits({ noteId: created.id, values: { ...EMPTY, [seed.key]: seed.text } });
      }
    },
    [visit, createNote],
  );

  const setSection = useCallback(
    (key: SectionKey, value: string) => {
      if (draftNote === undefined) return;
      setEdits((prev) => {
        const current = prev !== undefined && prev.noteId === draftNote.id ? prev.values : base;
        return { noteId: draftNote.id, values: { ...current, [key]: value } };
      });
    },
    [draftNote, base],
  );

  const [error, setError] = useState<string | undefined>(undefined);
  const pick = useCallback(
    (key: SectionKey, text: string) => {
      if (draftNote === undefined) {
        setError(undefined);
        startNote({ key, text }).catch((thrown: unknown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't start the note.");
        });
        return;
      }
      setEdits((prev) => {
        const current = prev !== undefined && prev.noteId === draftNote.id ? prev.values : base;
        if (current[key].includes(text)) return prev ?? { noteId: draftNote.id, values: current };
        return { noteId: draftNote.id, values: { ...current, [key]: current[key].trim() === "" ? text : `${current[key].trimEnd()}\n${text}` } };
      });
    },
    [draftNote, base, startNote],
  );

  // The prescription draft.
  const prescriptions = usePrescriptions(canRx ? patientId : undefined);
  const last = useLastPrescription(canRx ? patientId : undefined);
  const createRx = useCreatePrescription(patientId);
  const editRx = useMutation({
    mutationFn: ({ id, items }: { id: Prescription["id"]; items: RxItem[] }) => unwrap(api.editPrescription(id, { items })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prescriptions", access.org_id, patientId] }),
  });
  const drafts = (prescriptions.data?.items ?? []).filter((r) => r.status === "draft");
  const draftRx = drafts.find((r) => visit !== undefined && r.encounter_id === visit.id) ?? drafts[0];
  const rxHandle = useRef<RxDraftHandle | null>(null);
  const [rxVersion, setRxVersion] = useState(0);
  const [issued, setIssued] = useState<{ rx: Prescription; message: PatientMessage } | undefined>(undefined);
  const encounter = visit === undefined ? {} : { encounter_id: visit.id };
  const startRx = useCallback(() => {
    createRx.mutate(encounter, {
      onError: (thrown) => {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't start a prescription.");
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRx, visit?.id]);
  const quickRx = last.data === undefined ? undefined : () => {
    createRx.mutate(
      { ...encounter, items: last.data.items, diagnosis_text: last.data.diagnosis_text ?? null, advice: last.data.advice ?? null },
      {
        onError: (thrown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't start Quick Rx.");
        },
      },
    );
  };
  const addItems = useCallback(
    async (items: RxItem[]) => {
      setError(undefined);
      try {
        if (draftRx === undefined) {
          await createRx.mutateAsync({ ...encounter, items });
          return;
        }
        // What is typed in the open editor is saved first, then the set is added on the server and the editor reloads.
        await rxHandle.current?.save();
        const fresh = prescriptions.data?.items.find((r) => r.id === draftRx.id) ?? draftRx;
        await editRx.mutateAsync({ id: draftRx.id, items: [...fresh.items, ...items] });
        setRxVersion((n) => n + 1);
      } catch (thrown) {
        setError(apiErrorOf(thrown)?.message ?? "Couldn't add the medicines.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftRx, createRx, editRx, prescriptions.data, visit?.id],
  );

  const [follow, setFollow] = useState<FollowUp | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const finish = async (): Promise<FinishedVisit | undefined> => {
    if (visit === undefined) return undefined;
    setFinishing(true);
    setError(undefined);
    try {
      const hasText = draftNote !== undefined && NOTE_SECTIONS.some(({ key }) => valuesRef.current[key].trim() !== "");
      const { noteSigned } = await finishVisit(
        { noteToSign: hasText ? draftNote.id : undefined, followUp: follow },
        {
          saveNote,
          saveRx: async () => {
            await rxHandle.current?.save();
          },
          signNote: (id) => signNote.mutateAsync(id),
          closeVisit: () => closeVisit.mutateAsync(visit.id),
        },
      );
      refreshRecord(visit.id);
      void queryClient.invalidateQueries({ queryKey: ["prescriptions", access.org_id, patientId] });
      // The list as the server has it now, so a prescription issued a moment ago is in it.
      const fresh = (await unwrap(api.listPrescriptions(patientId)).catch(() => undefined)) ?? prescriptions.data;
      const rx = fresh?.items
        .filter((r) => r.status === "issued" && r.encounter_id === visit.id)
        .sort((a, b) => (b.issued_at ?? "").localeCompare(a.issued_at ?? ""))[0];
      return { visit, procedures: detail?.procedures.length ?? 0, noteSigned, rx, followUp: follow };
    } catch (thrown) {
      setError(apiErrorOf(thrown)?.message ?? "Couldn't finish the visit. Nothing was lost; try again.");
      return undefined;
    } finally {
      setFinishing(false);
    }
  };

  const value: VisitSession = {
    patientId,
    canWrite,
    canRx,
    visit,
    visitLoading: canClinical && visits.isPending,
    startVisit: () => {
      setError(undefined);
      startVisitMutation.mutate(
        {},
        {
          onError: (thrown) => {
            setError(apiErrorOf(thrown)?.message ?? "Couldn't start a visit.");
          },
        },
      );
    },
    starting: startVisitMutation.isPending,
    procedures: detail?.procedures ?? [],
    note: {
      hasDraft: draftNote !== undefined,
      values,
      dirty,
      saving: editNote.isPending,
      starting: createNote.isPending,
      set: setSection,
      pick,
      save: saveNote,
      start: () => {
        setError(undefined);
        startNote().catch((thrown: unknown) => {
          setError(apiErrorOf(thrown)?.message ?? "Couldn't start the note.");
        });
      },
      noteId: draftNote?.id,
    },
    rx: {
      draft: draftRx,
      version: rxVersion,
      handle: rxHandle,
      busy: createRx.isPending || editRx.isPending,
      start: startRx,
      quick: quickRx,
      addItems,
      issued,
      noteIssued: (rx, message) => {
        setIssued({ rx, message });
      },
      dismissIssued: () => {
        setIssued(undefined);
      },
    },
    follow,
    setFollow,
    voiceOpen,
    setVoiceOpen,
    finishing,
    finish,
    error,
  };
  return <Context value={value}>{children}</Context>;
}
