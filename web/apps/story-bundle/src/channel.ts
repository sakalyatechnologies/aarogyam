// Page → native: one channel, one JSON message per call (mobile `StoryBridge.parse`). iOS has
// `window.webkit.messageHandlers.aarogyam`, Android the `AarogyamBridge` @JavascriptInterface. Both
// get the JSON text, so the shared Kotlin parser reads the same string on each platform.

/** The bridge this page speaks; the app refuses a page that reports a version it doesn't know. */
export const BUNDLE_VERSION = 1;

export type PageMessage =
  | { type: "ready"; bundle_version: number; story_versions: readonly number[] }
  | { type: "progress"; value: number }
  | { type: "chunk"; seq: number; base64: string }
  | { type: "done"; bytes: number }
  | { type: "failed"; reason: FailReason }
  | { type: "exit" }
  | { type: "add_depth"; tooth: number }
  /** The doctor tapped "Make default"; the app saves it, the page never calls the API. */
  | { type: "make_default"; style: "story" | "painted" | "smile3d" | "face" }
  /** The doctor tapped "Save colour": 0 (lightest) to 100 (deepest); the app PUTs `/patients/{id}/smile-shade`. */
  | { type: "save_shade"; shade: number }
  /** The doctor changed the pins on an X-ray (the whole set, empty = cleared); the app PUTs `/attachments/{attachment_id}/pins` with `{pins}`. Needs the `xrays` option. */
  | { type: "save_pins"; attachment_id: string; pins: { tooth: number; x: number; y: number; label?: string }[] }
  /** "Save" in What we discussed, one message per tooth and situation; the app POSTs the body unchanged to `/visits/{id}/present-discussions`. `send_to_patient` is the row's "Send to the patient" tick (slice 2f). */
  | { type: "save_discussion"; tooth: number; situation: string; options: { key: string; preferred: boolean }[]; send_to_patient: boolean };

/** Short codes only: never patient data (rule 6). */
export type FailReason = "bad_story" | "unsupported_version" | "no_encoder" | "cancelled" | "encode_failed" | "busy";

interface Sink {
  postMessage(text: string): void;
}

export type Channel = "ios" | "android" | "none";

function isSink(v: unknown): v is Sink {
  return typeof v === "object" && v !== null && "postMessage" in v && typeof v.postMessage === "function";
}

function iosSink(w: object): Sink | undefined {
  const webkit = "webkit" in w ? w.webkit : undefined;
  const handlers = typeof webkit === "object" && webkit !== null && "messageHandlers" in webkit ? webkit.messageHandlers : undefined;
  const handler = typeof handlers === "object" && handlers !== null && "aarogyam" in handlers ? handlers.aarogyam : undefined;
  return isSink(handler) ? handler : undefined;
}

function androidSink(w: object): Sink | undefined {
  const bridge = "AarogyamBridge" in w ? w.AarogyamBridge : undefined;
  if (typeof bridge !== "object" || bridge === null || !("post" in bridge) || typeof bridge.post !== "function") return undefined;
  const post: unknown = bridge.post;
  return { postMessage: (text) => { if (typeof post === "function") Reflect.apply(post, bridge, [text]); } };
}

/** Which host this page runs in. */
export function detectChannel(w: object = window): Channel {
  if (iosSink(w) !== undefined) return "ios";
  if (androidSink(w) !== undefined) return "android";
  return "none";
}

/** Sends one message to the app; outside the apps (a browser, a test) it goes nowhere. */
export function post(message: PageMessage, w: object = window): void {
  const sink = iosSink(w) ?? androidSink(w);
  sink?.postMessage(JSON.stringify(message));
}
