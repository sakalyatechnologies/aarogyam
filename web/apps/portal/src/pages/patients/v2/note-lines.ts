import { NOTE_SECTIONS, type SectionKey } from "./visit-session.js";

/** One stamped line of the note: spoken or typed, it is stored the same way (`[HH:MM] text` in the subjective section). */
export interface NoteLine {
  at: string;
  text: string;
  /** Which line of the subjective section it is, so one line can be edited or removed. */
  index: number;
}

/** The lines in the order they happened. Spoken lines are stored when the recording is saved, so storage order is not time order. */
export function inTimeOrder(lines: readonly NoteLine[]): NoteLine[] {
  return [...lines].sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1));
}

/**
 * The subjective section with line `index` replaced by `text` (stamped `at`), or removed when `text` is undefined.
 * `was` is the line as the doctor saw it: when the section has moved on and that line is no longer at `index`, nothing
 * is changed and `undefined` comes back.
 */
export function withLine(subjective: string, index: number, at: string, text: string | undefined, was: string): string | undefined {
  const lines = subjective.split("\n");
  if (lines[index] !== `[${at}] ${was}`) return undefined;
  if (text === undefined) lines.splice(index, 1);
  else lines[index] = `[${at}] ${text}`;
  return lines.join("\n");
}

const VOICE_LINE = /^\[(\d{2}:\d{2})\]\s*(.*)$/;

/** The note's lines split into voice notes (stamped with their start time, in the order recorded) and everything else. */
export function splitNote(values: Partial<Record<SectionKey, string | null | undefined>>): { voice: NoteLine[]; other: { label: string; text: string }[] } {
  const voice: NoteLine[] = [];
  const other: { label: string; text: string }[] = [];
  for (const { key, label } of NOTE_SECTIONS) {
    const rest: string[] = [];
    for (const [index, line] of (values[key] ?? "").split("\n").entries()) {
      const match = key === "subjective" ? VOICE_LINE.exec(line) : null;
      if (match?.[1] !== undefined) voice.push({ at: match[1], text: match[2] ?? "", index });
      else if (line.trim() !== "") rest.push(line);
    }
    if (rest.length > 0) other.push({ label, text: rest.join(" · ") });
  }
  return { voice, other };
}

