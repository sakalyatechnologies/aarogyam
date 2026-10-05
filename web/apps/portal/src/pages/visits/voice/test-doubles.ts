import { vi } from "vitest";

/** A stand-in for the browser's `MediaRecorder`: stopping it hands over one chunk of "audio". */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supported: readonly string[] = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  static isTypeSupported = (type: string): boolean => FakeMediaRecorder.supported.includes(type);

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  readonly options: MediaRecorderOptions;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options: MediaRecorderOptions = {}) {
    this.options = options;
    this.mimeType = options.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["voice"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

/** A stand-in for `SpeechRecognition` that the test drives by hand. */
export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.aborted = true;
  }
  /** Says `text`: interim until `final` is true. */
  say(text: string, final: boolean) {
    this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: final, 0: { transcript: text } } } });
  }
}

/** Installs the doubles; `dictation: false` leaves the browser without speech recognition, like Safari or Firefox. */
export function installVoiceDoubles({ dictation = true, microphone = "granted" }: { dictation?: boolean; microphone?: "granted" | "denied" | "missing" } = {}) {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  FakeRecognition.instances = [];
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn(() =>
    microphone === "denied"
      ? Promise.reject(new DOMException("denied", "NotAllowedError"))
      : microphone === "missing"
        ? Promise.reject(new DOMException("none", "NotFoundError"))
        : Promise.resolve({ getTracks: () => [{ stop: stopTrack }] }),
  );
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  Object.defineProperty(window, "SpeechRecognition", { value: dictation ? FakeRecognition : undefined, configurable: true, writable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true, writable: true });
  URL.createObjectURL = vi.fn(() => "blob:voice-test");
  URL.revokeObjectURL = vi.fn();
  return { getUserMedia, stopTrack };
}

export function removeVoiceDoubles() {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true, writable: true });
}
