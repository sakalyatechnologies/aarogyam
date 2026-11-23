// Tooth pins on an X-ray or photo, kept for the next visit (present-studio-design slice 2g): loaded when
// an image opens; a placed, moved or cleared pin is saved as the whole set after a short pause.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AttachmentId } from "@aarogyam/api-client";

import { useImagePins, useSaveImagePins } from "../../../../queries.js";
import type { Pin } from "./explain-mode.js";

const SAVE_DELAY_MS = 600;

export interface SavedPins {
  readonly pins: readonly Pin[];
  /** Places a pin; a tooth has one pin, so a second pin on it moves the first. */
  readonly place: (pin: Omit<Pin, "id" | "imageId">) => void;
  readonly clear: () => void;
  /** The last save failed: show a quiet "Pins not saved" with a retry. */
  readonly failed: boolean;
  readonly retry: () => void;
}

export function useSavedPins(imageId: AttachmentId | undefined): SavedPins {
  const loaded = useImagePins(imageId);
  const save = useSaveImagePins();
  // The doctor's edits, by image; until an image is edited its pins are the saved ones.
  const [edited, setEdited] = useState<ReadonlyMap<string, readonly Pin[]>>(new Map());
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef<{ imageId: AttachmentId; pins: readonly Pin[] } | undefined>(undefined);
  const saveMutation = save.mutate;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const job = waiting.current;
    if (job === undefined) return;
    waiting.current = undefined;
    saveMutation(
      { imageId: job.imageId, pins: { pins: job.pins.map((p) => ({ tooth: p.tooth, x: p.x, y: p.y })) } },
      { onSuccess: () => { setFailed(false); }, onError: () => { setFailed(true); waiting.current = job; } },
    );
  }, [saveMutation]);

  const saved = useMemo<readonly Pin[]>(
    () => (imageId === undefined ? [] : (loaded.data?.pins ?? []).map((p, i) => ({ id: i + 1, imageId, x: p.x, y: p.y, tooth: p.tooth, label: "" }))),
    [imageId, loaded.data],
  );
  const pins = (imageId === undefined ? undefined : edited.get(imageId)) ?? saved;

  const change = (next: readonly Pin[]) => {
    if (imageId === undefined) return;
    setEdited((before) => new Map(before).set(imageId, next));
    waiting.current = { imageId, pins: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  // Leaving (or switching image) saves what is waiting rather than dropping it.
  useEffect(() => flush, [flush, imageId]);

  return {
    pins,
    place: (pin) => {
      if (imageId === undefined) return;
      const rest = pins.filter((p) => p.tooth !== pin.tooth);
      change([...rest, { ...pin, id: Math.max(0, ...pins.map((p) => p.id)) + 1, imageId }]);
    },
    clear: () => { change([]); },
    failed,
    retry: flush,
  };
}
