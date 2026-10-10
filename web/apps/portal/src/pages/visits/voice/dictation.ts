/** Languages the recorder can dictate in. The tag is what the browser's speech service and the API both use. */
export const DICTATION_LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "Hindi" },
  { value: "mr-IN", label: "Marathi" },
  { value: "gu-IN", label: "Gujarati" },
] as const;

/** The languages the API accepts on a kept recording. Gujarati dictates, but its recording is stored without a language tag until the API lists it. */
export function recordingLanguage(language: string): string | undefined {
  return language === "gu-IN" ? undefined : language;
}

export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number]["value"];

/** The longest recording, in seconds. The API refuses anything longer. */
export const MAX_RECORDING_SECONDS = 600;

interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: RecognitionAlternative | undefined;
}
export interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult | undefined };
}
export interface RecognitionErrorEvent {
  readonly error: string;
}

/** The part of the browser's `SpeechRecognition` this app uses (it is not in every `lib.dom`). */
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
function isRecognition(value: unknown): value is Recognition {
  return typeof value === "object" && value !== null && "start" in value && "abort" in value && "interimResults" in value;
}

function recognitionClass(): unknown {
  const standard: unknown = Reflect.get(window, "SpeechRecognition");
  return typeof standard === "function" ? standard : Reflect.get(window, "webkitSpeechRecognition");
}

/** Whether this browser has speech recognition (Chrome, Edge, Android), so dictation can be offered. */
export function dictationAvailable(): boolean {
  return typeof recognitionClass() === "function";
}

/** A new speech recogniser, or undefined where the browser has none. */
export function newRecognition(): Recognition | undefined {
  const Class = recognitionClass();
  if (typeof Class !== "function") {
    return undefined;
  }
  const made: unknown = Reflect.construct(Class, []);
  return isRecognition(made) ? made : undefined;
}

/** The browser's microphone opener, or undefined where there is none (an insecure page, an old browser). */
export function microphoneOpener(): ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined {
  const devices: unknown = Reflect.get(navigator, "mediaDevices");
  if (typeof devices !== "object" || devices === null || typeof Reflect.get(devices, "getUserMedia") !== "function") {
    return undefined;
  }
  return (constraints) => navigator.mediaDevices.getUserMedia(constraints);
}

function isAudioContext(value: unknown): value is AudioContext {
  return typeof value === "object" && value !== null && "createAnalyser" in value && "createMediaStreamSource" in value && "close" in value;
}

/** A new audio context for the level meter, or undefined where the browser has none. */
export function newAudioContext(): AudioContext | undefined {
  const standard: unknown = Reflect.get(window, "AudioContext");
  const Class: unknown = typeof standard === "function" ? standard : Reflect.get(window, "webkitAudioContext");
  if (typeof Class !== "function") {
    return undefined;
  }
  const made: unknown = Reflect.construct(Class, []);
  return isAudioContext(made) ? made : undefined;
}

/** Recording formats in the order we prefer them: WebM/Opus, then MP4 (Safari), then Ogg. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;

/** The first recording format this browser supports, or undefined to let it choose. */
export function pickRecordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Plain-language reason a microphone could not be opened. Never includes device names. */
export function microphoneProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow the microphone for this site in your browser's address bar, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect one and try again.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is in use by another app. Close it and try again.";
    default:
      return "Couldn't start the microphone. Please try again.";
  }
}

/** Puts `text` into `value` at the selection, with a space between it and what is already there. */
export function insertAt(value: string, start: number, end: number, text: string): { value: string; cursor: number } {
  const from = Math.min(Math.max(start, 0), value.length);
  const to = Math.min(Math.max(end, from), value.length);
  const before = value.slice(0, from);
  const after = value.slice(to);
  const lead = before !== "" && !/\s$/u.test(before) ? " " : "";
  const trail = after !== "" && !/^\s/u.test(after) ? " " : "";
  const inserted = `${lead}${text}${trail}`;
  return { value: `${before}${inserted}${after}`, cursor: before.length + lead.length + text.length };
}

/** `m:ss`. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}
