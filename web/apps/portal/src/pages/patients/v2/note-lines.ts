import { NOTE_SECTIONS, type SectionKey } from "./visit-session.js";

const VOICE_LINE = /^\[(\d{2}:\d{2})\]\s*(.*)$/;

/** The note's lines split into voice notes (stamped with their start time, in the order recorded) and everything else. */
export function splitNote(values: Partial<Record<SectionKey, string | null | undefined>>): { voice: { at: string; text: string }[]; other: { label: string; text: string }[] } {
  const voice: { at: string; text: string }[] = [];
  const other: { label: string; text: string }[] = [];
  for (const { key, label } of NOTE_SECTIONS) {
    const rest: string[] = [];
    for (const line of (values[key] ?? "").split("\n")) {
      const match = key === "subjective" ? VOICE_LINE.exec(line) : null;
      if (match?.[1] !== undefined) voice.push({ at: match[1], text: match[2] ?? "" });
      else if (line.trim() !== "") rest.push(line);
    }
    if (rest.length > 0) other.push({ label, text: rest.join(" · ") });
  }
  return { voice, other };
}

