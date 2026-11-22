// Native → page: `window.aarogyam` (mobile `StoryBridge`): present, back, render, cancel. The page
// answers on the one channel in ./channel.ts.
import { createRef } from "react";
import { createRoot } from "react-dom/client";

import type { MouthSnapshot } from "@aarogyam/api-client";
import { STORY_VERSIONS } from "@aarogyam/app-kit/story-2d";

import { BUNDLE_VERSION, post, type PageMessage } from "./channel.js";
import { PresentApp, type PresentControls } from "./present-app.js";

export interface AarogyamApi {
  /** Shows the `/visits/{id}/mouth` JSON in Present mode. */
  present(mouth: unknown, options?: { dark?: boolean }): void;
  /** "Back to all teeth": true when the page went back, false at the overview (the app then leaves). */
  back(): boolean;
  /** Draws and encodes the `/visits/{id}/story` JSON; answers with progress, chunks, done or failed. */
  render(story: unknown): void;
  /** Stops a running render; it answers failed "cancelled". */
  cancel(): void;
}

declare global {
  interface Window {
    aarogyam?: AarogyamApi;
  }
}

/** A shape check, not a full parse: the JSON comes from our own API through the app, untouched. */
function isSnapshot(v: unknown): v is MouthSnapshot {
  if (typeof v !== "object" || v === null || !("teeth" in v) || !Array.isArray(v.teeth) || !("dentition" in v)) return false;
  return v.teeth.every((t: unknown) => typeof t === "object" && t !== null && "tooth" in t && typeof t.tooth === "number");
}

function asSnapshot(value: unknown): MouthSnapshot | undefined {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return isSnapshot(v) ? v : undefined;
}

export interface BridgeDeps {
  /** Where Present draws. */
  container: HTMLElement;
  send?: (m: PageMessage) => void;
  /** The render module (lazy in the build; tests pass a mock). */
  loadRender?: () => Promise<{ runRender: (input: unknown, send: (m: PageMessage) => void, signal: AbortSignal) => Promise<void> }>;
}

/** Installs `window.aarogyam` and tells the app the page is ready. */
export function installBridge({ container, send = (m) => { post(m); }, loadRender = () => import("./render.js") }: BridgeDeps): AarogyamApi {
  const root = createRoot(container);
  const controls = createRef<PresentControls>();
  let running: AbortController | undefined;

  const api: AarogyamApi = {
    present(mouth, options) {
      const snapshot = asSnapshot(mouth);
      const dark = options?.dark === true;
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      document.body.dataset["theme"] = dark ? "dark" : "light";
      if (snapshot === undefined) {
        root.render(<p role="alert" className="sb-error">We couldn't show the teeth. Please go back and try again.</p>);
        return;
      }
      root.render(<PresentApp snapshot={snapshot} dark={dark} send={send} controls={controls} />);
    },
    back() {
      return controls.current?.back() ?? false;
    },
    render(story) {
      running?.abort();
      const mine = new AbortController();
      running = mine;
      // A render replaced by a newer one goes quiet; only the current one speaks.
      const speak = (m: PageMessage) => { if (running === mine) send(m); };
      void loadRender()
        .then(({ runRender }) => runRender(story, speak, mine.signal))
        .catch(() => { speak({ type: "failed", reason: "encode_failed" }); })
        .finally(() => { if (running === mine) running = undefined; });
    },
    cancel() {
      running?.abort();
    },
  };
  window.aarogyam = api;
  send({ type: "ready", bundle_version: BUNDLE_VERSION, story_versions: STORY_VERSIONS });
  return api;
}
