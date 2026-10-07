import type { Attachment } from "@aarogyam/api-client";

/** Labels the upload dialog offers first; a clinic can type its own. */
export const PRESET_LABELS = ["OPG", "Intraoral – upper", "Intraoral – lower", "X-ray", "Consent"] as const;

export const NO_LABEL = "Unlabelled";

/** Files grouped by label, preset labels first, then the clinic's own in order of appearance, unlabelled last. */
export function groupByLabel(files: readonly Attachment[]): { label: string; files: Attachment[] }[] {
  const groups = new Map<string, Attachment[]>();
  for (const file of files) {
    const label = file.label ?? NO_LABEL;
    const group = groups.get(label);
    if (group === undefined) groups.set(label, [file]);
    else group.push(file);
  }
  const rank = (label: string) => {
    if (label === NO_LABEL) return PRESET_LABELS.length + 1;
    const index = PRESET_LABELS.findIndex((preset) => preset === label);
    return index === -1 ? PRESET_LABELS.length : index;
  };
  return [...groups.entries()].map(([label, items]) => ({ label, files: items })).sort((a, b) => rank(a.label) - rank(b.label));
}

/** A valid FDI tooth number, or undefined for blank or invalid input. */
export function parseTooth(text: string): number | undefined {
  const n = Number.parseInt(text, 10);
  if (!Number.isInteger(n)) return undefined;
  const quadrant = Math.floor(n / 10);
  const position = n % 10;
  const permanent = quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8;
  const primary = quadrant >= 5 && quadrant <= 8 && position >= 1 && position <= 5;
  return permanent || primary ? n : undefined;
}
