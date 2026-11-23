import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, MessageCircle, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { apiErrorOf, MESSAGE_SECTIONS, unwrap, type VisitId, type VisitPatientMessage, type VisitStory } from "@aarogyam/api-client";
import { canShareVideo, pickVideoPath, videoFileName, type VideoPath } from "@aarogyam/app-kit/story-video/support";

import { useClinic } from "../../../clinic.js";
import { useDebounced } from "../../messages/v2/queries.js";
import { PillButton } from "./kit.js";

/**
 * How the summary leaves the browser. `whatsapp://` opens WhatsApp Desktop on this computer with the full text, a
 * local hand-off with nothing in a web URL. `copy` puts the full text on this computer's clipboard so a doctor on
 * WhatsApp Web can paste it (a web URL may only carry the short text). Tests replace both.
 */
export const handoff = {
  open: (url: string) => {
    window.location.href = url;
  },
  copy: (text: string): Promise<void> => navigator.clipboard.writeText(text),
};


/** What this device can do with the patient's video: how it renders the MP4 and whether the share sheet takes it. */
export interface VideoSupport {
  path: VideoPath;
  share: boolean;
}

/**
 * The patient's video (spec 1.7), made on this device from `GET /visits/{id}/story` and never uploaded: the story
 * and encoder chunks load lazily, the MP4 stays in memory, and it leaves only through the share sheet or a download
 * named after the visit number (`V-318.mp4`). Tests replace these.
 */
export const videoKit = {
  support: async (): Promise<VideoSupport | null> => {
    const path = await pickVideoPath();
    return path === undefined ? null : { path, share: canShareVideo() };
  },
  render: async (story: VisitStory, path: VideoPath, opts: { onProgress: (done: number) => void; signal: AbortSignal }): Promise<File> => {
    const [{ createStory2d }, { encodeStory }] = await Promise.all([import("@aarogyam/app-kit/story-2d"), import("@aarogyam/app-kit/story-video")]);
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      path === "webcodecs" && typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(720, 1280) : document.createElement("canvas");
    const made = await createStory2d(canvas, story, { clock: "virtual" });
    const blob = await encodeStory(made, { path, canvas, ...opts });
    return new File([blob], videoFileName(story.visit_number), { type: "video/mp4" });
  },
  share: (file: File): Promise<void> => navigator.share({ files: [file] }),
  download: (file: File) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  },
};

type VideoState = { status: "idle" } | { status: "rendering"; progress: number } | { status: "ready"; file: File } | { status: "failed" };

/**
 * Renders the video once `/story` answered and the Video tick is on; unticking or closing Done cancels it and drops
 * the file. Send never waits for it.
 */
function useStoryVideo(story: VisitStory | undefined, support: VideoSupport | null | undefined, on: boolean): VideoState {
  // The render belongs to one story; a new story, unticking or closing Done cancels it and drops the file.
  const job = story !== undefined && support != null && on ? story : undefined;
  const [state, setState] = useState<{ job: VisitStory; video: VideoState }>();
  const made = useRef<VisitStory>(undefined);
  useEffect(() => {
    // Ticked again after the video was made: keep that file.
    if (job === undefined || support == null || made.current === job) {
      return undefined;
    }
    const abort = new AbortController();
    let last = -1;
    videoKit
      .render(job, support.path, {
        signal: abort.signal,
        onProgress: (done) => {
          const pct = Math.floor(done * 20) * 5;
          if (pct !== last && !abort.signal.aborted) {
            last = pct;
            setState({ job, video: { status: "rendering", progress: pct } });
          }
        },
      })
      .then(
        (file) => {
          if (abort.signal.aborted) return;
          made.current = job;
          setState({ job, video: { status: "ready", file } });
        },
        () => {
          if (!abort.signal.aborted) setState({ job, video: { status: "failed" } });
        },
      );
    return () => {
      abort.abort();
    };
  }, [job, support]);
  if (job === undefined) {
    return { status: "idle" };
  }
  return state?.job === job ? state.video : { status: "rendering", progress: 0 };
}

/** The video row: its progress, then Share video (the share sheet) or Download video, with the steps. */
function VideoRow({ state, support, sent, label }: { state: VideoState; support: VideoSupport; sent: boolean; label: string }) {
  const [note, setNote] = useState<string>();
  if (state.status === "idle") {
    return null;
  }
  if (state.status === "failed") {
    return (
      <p role="status" className="mk-hint" style={{ marginTop: 8 }}>
        Couldn&apos;t make the video on this device. The text summary still works.
      </p>
    );
  }
  if (state.status === "rendering") {
    return (
      <div style={{ marginTop: 8 }}>
        <p role="status" className="mk-hint" style={{ margin: 0 }}>
          Making the video {label}… {state.progress}%
        </p>
        <progress max={100} value={state.progress} aria-label="Video progress" style={{ width: "100%" }} />
      </div>
    );
  }
  const file = state.file;
  if (!sent) {
    return (
      <p role="status" className="mk-hint" style={{ marginTop: 8 }}>
        Video {label} is ready. It goes after the text.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <p className="mk-hint" style={{ margin: "0 0 6px" }}>
        Video {label}
      </p>
      {support.share ? (
        <>
          <PillButton
            icon={<Share2 aria-hidden="true" />}
            onClick={() => {
              videoKit.share(file).then(
                () => {
                  setNote("Shared. Press Send in WhatsApp.");
                },
                (error: unknown) => {
                  if (!(error instanceof DOMException && error.name === "AbortError")) {
                    setNote("Couldn't open the share sheet. Download the video instead.");
                    videoKit.download(file);
                  }
                },
              );
            }}
          >
            Share video
          </PillButton>
          <p className="mk-hint" style={{ margin: "6px 0 0" }}>
            Pick WhatsApp, then the patient&apos;s chat (it is at the top), then Send.
          </p>
        </>
      ) : (
        <>
          <PillButton
            variant="ghost"
            icon={<Download aria-hidden="true" />}
            onClick={() => {
              videoKit.download(file);
              setNote(`Saved ${file.name}.`);
            }}
          >
            Download video
          </PillButton>
          <ol className="mk-hint" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            <li>Send the text in the patient&apos;s chat.</li>
            <li>Drag {file.name} from your downloads into the chat, or use the attach button and pick the file.</li>
            <li>Press Enter.</li>
          </ol>
        </>
      )}
      {note === undefined ? null : (
        <p role="status" className="mk-hint" style={{ marginTop: 6 }}>
          {note}
        </p>
      )}
    </div>
  );
}

const digits = (phone: string) => phone.replace(/\D/g, "");

/** The text a desktop link carries: the server's `desktop_text` (no emoji, short enough once URL-encoded); the short
 * text when even that can't fit (the doctor copies the full summary); the full text from an older server. */
const desktopText = (message: VisitPatientMessage) =>
  message.desktop_text === undefined ? message.text : (message.desktop_text ?? message.short_text);

/** The WhatsApp Desktop link with the full text (local protocol, never a web URL). */
export const desktopLink = (message: VisitPatientMessage) =>
  `whatsapp://send?phone=${digits(message.phone_e164)}&text=${encodeURIComponent(desktopText(message))}`;

/** The WhatsApp Web chat: only the short text (no clinical words), because it travels in a web URL. The doctor pastes
 * the full summary from "Copy full summary". */
export const webLink = (message: VisitPatientMessage) =>
  `https://web.whatsapp.com/send?phone=${digits(message.phone_e164)}&text=${encodeURIComponent(message.short_text)}`;

const REFUSALS: Readonly<Record<string, string>> = {
  visit_open: "Finish the visit first, then send the summary.",
  no_phone: "This patient has no mobile number. Add one to send the summary.",
  no_consent: "The patient hasn't agreed to messages about their care.",
  opted_out: "The patient has turned off WhatsApp messages from the clinic.",
};

/** The Done screen's tick boxes (spec 1.6). The Video tick is added where this device can make the video. */
export const TICKS: ReadonlyArray<{ name: (typeof MESSAGE_SECTIONS)[number]; label: string }> = [
  { name: "done", label: "Today's treatment" },
  { name: "detail", label: "Treatment detail" },
  { name: "found", label: "What we found" },
  { name: "plan", label: "Plan and recommendation" },
  { name: "medicines", label: "Medicines" },
  { name: "care", label: "Care at home" },
  { name: "offer", label: "Offer" },
];

/** Sent with each hand-off, so a later trust ramp knows which wording the count is about. */
const TEMPLATE_VERSION = "visit-message-v2";

/** The preview's stand-ins for the link token and PIN: as long as real ones, greyed out. */
const STAND_IN = /(https?:\/\/\S*\/shared\/x{43}|XXXXXX)/;

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** The preview text with the stand-in link and PIN greyed out. */
function PreviewText({ text }: { text: string }) {
  const parts: ReactNode[] = text.split(STAND_IN).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ color: "var(--ink-3, #8a8a8a)" }} title="The real link and PIN are made when you send">
        {part}
      </span>
    ) : (
      part
    ),
  );
  return (
    <p data-testid="message-preview" style={{ whiteSpace: "pre-wrap", textAlign: "left", fontSize: 14, lineHeight: 1.5, margin: "8px 0", padding: 12, borderRadius: 8, background: "var(--surface-2, #f5f5f4)" }}>
      {parts}
    </p>
  );
}

/** The tick boxes and the live preview: previews are debounced and mint, save and send nothing. */
function Ticks({ visitId, ticked, onChange, video }: {
  visitId: VisitId;
  ticked: readonly string[];
  onChange: (next: string[]) => void;
  /** The Video tick, when this device can make the video. */
  video?: { on: boolean; toggle: (on: boolean) => void } | undefined;
}) {
  const { api, access } = useClinic();
  const settled = useDebounced(ticked, 400);
  const preview = useQuery({
    queryKey: ["message-preview", access.org_id, visitId, settled.join(",")],
    queryFn: ({ signal }) => unwrap(api.previewVisitPatientMessage(visitId, { sections: [...settled] }, { signal })),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
  const toggle = (name: string, on: boolean) => {
    onChange(MESSAGE_SECTIONS.filter((s) => (s === name ? on : ticked.includes(s))));
  };
  return (
    <>
      <fieldset style={{ border: 0, padding: 0, margin: "4px 0 0" }}>
        <legend className="mk-hint">What goes in the message</legend>
        <div className="p360-chips">
          {TICKS.map((tick) => (
            <label key={tick.name} className="mk-hint" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={ticked.includes(tick.name)}
                onChange={(event) => {
                  toggle(tick.name, event.currentTarget.checked);
                }}
              />
              {tick.label}
            </label>
          ))}
          {video === undefined ? null : (
            <label className="mk-hint" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={video.on}
                onChange={(event) => {
                  video.toggle(event.currentTarget.checked);
                }}
              />
              Video
            </label>
          )}
        </div>
      </fieldset>
      {preview.data === undefined ? null : <PreviewText text={preview.data.text} />}
    </>
  );
}

/**
 * "Send on WhatsApp" on the Done screen: the server builds the patient's summary (what was done, what was found, the
 * plan, care at home, medicines, the link and its PIN) and the doctor sends it from their own WhatsApp. The message
 * stays in this component's memory only. The screen says "prepared", never "sent": we can't see WhatsApp.
 *
 * The tick boxes start from the doctor's saved defaults, so Send stays one tap; Send saves the ticks as the new
 * defaults. Toggling and the live preview save nothing.
 *
 * `compact` is the queue card's version: one "Prepare WhatsApp summary" button, the ticks folded away.
 *
 * The Done screen (not compact) also makes the patient's video on this device (spec 1.7) when the Video tick is on:
 * on by default where the share sheet takes a file, off where only a download works (M8). `patientName` labels the
 * video for the doctor only ("V-318 · Aarav"); it never goes into the video or its file name.
 */
export function WhatsAppSummary({ visitId, compact = false, patientName }: { visitId: VisitId; compact?: boolean; patientName?: string }) {
  const { api, access, can } = useClinic();
  const allowed = can("clinical.read") && can("patients.contact");
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["message-prefs", access.org_id],
    queryFn: ({ signal }) => unwrap(api.getMessagePrefs({ signal })),
    enabled: allowed,
    staleTime: 60_000,
  });
  const [chosen, setChosen] = useState<string[]>();
  const ticked = chosen ?? prefs.data?.sections;
  const support = useQuery({
    queryKey: ["video-support"],
    queryFn: () => videoKit.support(),
    enabled: allowed && !compact,
    staleTime: Infinity,
    retry: false,
  }).data;
  // Only an explicit tap changes the saved "video" default; a download-only device just starts unticked.
  const [videoChoice, setVideoChoice] = useState<boolean>();
  const videoOn = support != null && (videoChoice ?? (ticked?.includes("video") === true && support.share));
  const story = useQuery({
    queryKey: ["visit-story", access.org_id, visitId],
    queryFn: ({ signal }) => unwrap(api.getVisitStory(visitId, { signal })),
    enabled: allowed && !compact && videoOn,
    staleTime: Infinity,
    retry: false,
  }).data;
  const video = useStoryVideo(story, support, videoOn);
  const prepare = useMutation({
    // Before the defaults load, Send asks for every section and saves nothing.
    mutationFn: () => unwrap(api.prepareVisitPatientMessage(visitId, undefined, ticked === undefined ? undefined : { sections: [...ticked] })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["message-prefs", access.org_id] }),
  });
  const [message, setMessage] = useState<VisitPatientMessage>();
  const [preparedAt, setPreparedAt] = useState<string>();
  const [copied, setCopied] = useState<"yes" | "failed">();
  const [open, setOpen] = useState(false);

  if (!allowed) {
    return null;
  }

  // Counted once per prepared message: "handed to WhatsApp", never "sent". A failure never blocks the doctor.
  const handedOff = () => {
    void api.handOffVisitPatientMessage(visitId, { template_version: TEMPLATE_VERSION });
  };
  const send = () => {
    prepare.mutate(undefined, {
      onSuccess: (made) => {
        setMessage(made);
        setPreparedAt(new Date().toISOString());
        handoff.open(desktopLink(made));
        handedOff();
      },
    });
  };
  const copy = (text: string) => {
    handoff.copy(text).then(
      () => {
        setCopied("yes");
      },
      () => {
        setCopied("failed");
      },
    );
  };
  const error = prepare.error === null ? undefined : apiErrorOf(prepare.error);
  const refusal = error === undefined ? undefined : (REFUSALS[error.code] ?? error.message);
  const videoTick =
    support == null || compact || ticked === undefined
      ? undefined
      : {
          on: videoOn,
          toggle: (on: boolean) => {
            setVideoChoice(on);
            setChosen(MESSAGE_SECTIONS.filter((s) => (s === "video" ? on : ticked.includes(s))));
          },
        };
  const ticks =
    ticked === undefined ? null : <Ticks visitId={visitId} ticked={ticked} onChange={setChosen} video={videoTick} />;
  const videoLabel = `${story?.visit_number ?? ""}${patientName === undefined || patientName === "" ? "" : ` · ${patientName}`}`.trim();
  const videoRow =
    support == null || !videoOn ? null : <VideoRow state={video} support={support} sent={message !== undefined} label={videoLabel} />;

  return (
    <div className={compact ? undefined : "p360-cele-link"}>
      {compact ? null : <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>Visit summary for the patient</p>}
      {message === undefined || preparedAt === undefined ? (
        <>
          {compact ? null : (
            <p className="mk-hint" style={{ margin: "4px 0 8px" }}>
              What you did, what you found, their plan, care at home and medicines, with a link that needs a PIN.
            </p>
          )}
          {compact ? (
            <details
              open={open}
              onToggle={(event) => {
                setOpen(event.currentTarget.open);
              }}
            >
              <summary className="mk-hint">Choose what goes in</summary>
              {open ? ticks : null}
            </details>
          ) : (
            ticks
          )}
          <PillButton variant={compact ? "ghost" : "primary"} icon={<MessageCircle aria-hidden="true" />} onClick={send} disabled={prepare.isPending}>
            {prepare.isPending ? "Preparing…" : compact ? "Prepare WhatsApp summary" : "Send on WhatsApp"}
          </PillButton>
          {refusal === undefined ? null : (
            <p role="alert" className="mk-hint" style={{ marginTop: 8, color: "var(--red)" }}>
              {refusal}
            </p>
          )}
          {videoRow}
        </>
      ) : (
        <>
          <p role="status" className="mk-hint" style={{ margin: "4px 0 8px" }}>
            Summary prepared {timeOf(preparedAt)}
            {message.recipient === "guardian" ? " for the parent or guardian" : ""}. Check it in WhatsApp, then press Send
            there.
            {message.auto_sent_at == null ? "" : ` An automatic summary also went at ${timeOf(message.auto_sent_at)}.`}
          </p>
          <p className="mk-hint" style={{ margin: "0 0 8px" }}>
            No WhatsApp app on this computer? Copy the full summary, open WhatsApp Web and paste it into the chat.
          </p>
          <div className="p360-chips">
            <PillButton
              variant="ghost"
              onClick={() => {
                handoff.open(desktopLink(message));
              }}
            >
              Open WhatsApp app
            </PillButton>
            <PillButton
              variant="ghost"
              onClick={() => {
                copy(message.text);
              }}
            >
              Copy full summary
            </PillButton>
            <a className="p360-chip" href={webLink(message)} target="_blank" rel="noreferrer">
              Use WhatsApp Web
            </a>
          </div>
          {copied === undefined ? null : (
            <p role="status" className="mk-hint" style={{ marginTop: 8, color: copied === "failed" ? "var(--red)" : undefined }}>
              {copied === "yes" ? "Copied. Paste it into the patient's chat in WhatsApp Web." : "Couldn't copy here. Use the WhatsApp app instead."}
            </p>
          )}
          {videoRow}
        </>
      )}
    </div>
  );
}
