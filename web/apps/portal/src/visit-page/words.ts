/** Plain words for a patient: FDI tooth numbers, medicine timings and rupees. */

const SIDE: Readonly<Record<number, string>> = { 1: "upper right", 2: "upper left", 3: "lower left", 4: "lower right" };

const PERMANENT: Readonly<Record<number, string>> = {
  1: "front tooth",
  2: "front tooth",
  3: "eye tooth (canine)",
  4: "first premolar",
  5: "second premolar",
  6: "first molar (back tooth)",
  7: "second molar (back tooth)",
  8: "wisdom tooth",
};

const PRIMARY: Readonly<Record<number, string>> = {
  1: "front milk tooth",
  2: "front milk tooth",
  3: "milk eye tooth",
  4: "first milk molar",
  5: "second milk molar",
};

/** "Upper right first molar (back tooth)" for 16; `undefined` for a number that isn't a tooth. */
export function toothWords(tooth: number | null | undefined): string | undefined {
  if (tooth === null || tooth === undefined || !Number.isInteger(tooth)) return undefined;
  const quadrant = Math.floor(tooth / 10);
  const position = tooth % 10;
  const primary = quadrant >= 5 && quadrant <= 8;
  const side = SIDE[primary ? quadrant - 4 : quadrant];
  const kind = (primary ? PRIMARY : PERMANENT)[position];
  if (side === undefined || kind === undefined) return undefined;
  const phrase = `${side} ${kind}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** Morning, afternoon, night and more, from India's `1-0-1` notation; `undefined` when it isn't that notation. */
export function doses(frequency: string | null | undefined): readonly number[] | undefined {
  if (frequency === null || frequency === undefined) return undefined;
  const parts = frequency.trim().split("-");
  if (parts.length < 2 || parts.length > 5) return undefined;
  const numbers = parts.map((part) => Number(part));
  return numbers.every((n) => Number.isFinite(n) && n >= 0 && n <= 9) ? numbers : undefined;
}

const TIMING: Readonly<Record<string, string>> = {
  before_food: "Before food",
  after_food: "After food",
  empty_stomach: "Empty stomach",
  bedtime: "At bedtime",
  sos: "Only when needed",
  as_directed: "As the doctor said",
};

export const timingWords = (timing: string | null | undefined): string | undefined =>
  timing === null || timing === undefined ? undefined : (TIMING[timing] ?? undefined);

/** "₹1,500" from paise. */
export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

/** "Wed, 19 Nov" from an ISO date. */
export function dayWords(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** The first name, for a warm greeting. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
