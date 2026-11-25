// Native → page: `window.aarogyam` (mobile `StoryBridge`): present, back, render, cancel. The page
// answers on the one channel in ./channel.ts.
import { createRef } from "react";
import { createRoot } from "react-dom/client";

import { presentStudio, type MouthSnapshot, type PresentStudio } from "@aarogyam/api-client";
import type { PlanLine } from "@aarogyam/app-kit/present";
import { STORY_VERSIONS } from "@aarogyam/app-kit/story-2d";

import { BUNDLE_VERSION, post, type PageMessage } from "./channel.js";
import { asChart, asDiscussions, asXrays } from "./options.js";
import { PresentApp, type PresentControls } from "./present-app.js";

export interface PresentOptions {
  dark?: boolean;
  /** The opening style: story (default when `present` is given) or painted (default otherwise). Own X-ray is a Story card now, not a style. */
  style?: "story" | "painted";
  /** The raw `GET /visits/{id}/present` JSON (object or text): options and compare. A bad payload opens without them. */
  present?: unknown;
  /**
   * The patient's treatment plan steps (`items` of `GET /patients/{id}/treatment-plans`, flattened; object or JSON text):
   * `{ id, name, phase, status, estimate_paise, tooth? }` each. They fill the story's closing "Your plan" card; the total
   * shows only behind the Prices tap, which needs `present` to carry prices. Absent or invalid: no plan steps (the card
   * lists the recorded plan only, or is left out when the visit has none). Cancelled steps are ignored.
   */
  plans?: unknown;
  /** Old phone builds may still send `betas`; it is ignored (the beta looks are gone). */
  betas?: string[];
  /** The patient's saved tooth colour from `GET /patients/{id}/smile-shade` (0 to 100); absent or null opens on the default. */
  shade?: number | null;
  /** Offer "Save colour" (the member has clinical.write); the save goes back as `save_shade`. */
  can_save_shade?: boolean;
  /**
   * The patient's X-rays, the one to open first listed first: `[{ id, url, taken_at?, kind?, pins? }]`. Native lists `GET /patients/{id}/attachments`
   * (images with kind "xray"), fetches each signed link (`GET /attachments/{id}/download`) and passes it as `url` (never logged), and the saved
   * pins from `GET /attachments/{id}/pins` as `pins: [{tooth, x, y, label?}]`. Gives the X-rays tab and Own X-ray. Absent: neither shows.
   */
  xrays?: unknown;
  /** The raw `GET /patients/{id}/dental-chart` JSON: adds "Chart" (the doctor's chart look) to the switcher. Plans are not drawn on it. */
  chart?: unknown;
  /** The doctor's chart look and dentition (`rows` | `arch` | `classic`; `adult` | `child`); anything else opens on rows / adult. */
  look?: string;
  dentition?: string;
  /** The raw `GET /visits/{id}/present-discussions` JSON (or its `discussions` array): the "Saved for this visit" list. */
  discussions?: unknown;
  /** false when the member lacks clinical.write: pins and What we discussed can't be saved. Default true. */
  can_write?: boolean;
  /** false hides every price even when `present` carries them (the member lacks billing.read). Default: show what `present` carries. */
  can_see_prices?: boolean;
}

export interface AarogyamApi {
  /** Shows the `/visits/{id}/mouth` JSON in Present mode. */
  present(mouth: unknown, options?: PresentOptions): void;
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

const asLook = (v: unknown): "rows" | "arch" | "classic" | undefined => (v === "rows" || v === "arch" || v === "classic" ? v : undefined);
const asDentition = (v: unknown): "adult" | "child" | undefined => (v === "adult" || v === "child" ? v : undefined);

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

function asStudio(value: unknown): PresentStudio | undefined {
  if (value === undefined || value === null) return undefined;
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  const parsed = presentStudio.safeParse(v);
  return parsed.success ? parsed.data : undefined;
}

const isPlanLine = (v: unknown): v is PlanLine =>
  typeof v === "object" && v !== null && "id" in v && typeof v.id === "string" && "name" in v && typeof v.name === "string"
  && "phase" in v && typeof v.phase === "number" && Number.isFinite(v.phase) && "status" in v && typeof v.status === "string"
  && "estimate_paise" in v && typeof v.estimate_paise === "number" && Number.isFinite(v.estimate_paise)
  && (!("tooth" in v) || v.tooth === undefined || v.tooth === null || typeof v.tooth === "number");

/** The plan steps, checked one by one; anything off drops that step, a non-list drops them all. */
function asPlans(value: unknown): PlanLine[] | undefined {
  if (value === undefined || value === null) return undefined;
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return Array.isArray(v) ? v.filter(isPlanLine) : undefined;
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
  let opened = 0;

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
      opened += 1;
      const parsedStudio = asStudio(options?.present);
      // Prices ride in `present` only when the server allowed them; the member's own right can still hide them.
      const studio = parsedStudio !== undefined && options?.can_see_prices === false && parsedStudio.prices !== undefined ? { situations: parsedStudio.situations } : parsedStudio;
      const asked = options?.style;
      const style = asked === "painted" || asked === "story" ? asked : studio === undefined ? "painted" : "story";
      const raw = options?.shade;
      const shade = typeof raw === "number" && Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : undefined;
      root.render(<PresentApp key={opened} snapshot={snapshot} dark={dark} send={send} controls={controls} style={style} studio={studio} plans={asPlans(options?.plans)} savedShade={shade} canSaveShade={options?.can_save_shade === true}
        xrays={asXrays(options?.xrays)} chart={asChart(options?.chart)} look={asLook(options?.look)} dentition={asDentition(options?.dentition)}
        discussions={asDiscussions(options?.discussions)} canWrite={options?.can_write !== false} />);
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
