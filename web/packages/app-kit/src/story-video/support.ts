// The light half of story-video: which path this device can use, whether the share sheet takes a
// video, and the file name. No encoder or muxer here, so the Done screen can import it eagerly.
export type VideoPath = "webcodecs" | "mediarecorder";

/** The story the encoder drives (a `Story` from story-2d satisfies it). */
export interface Renderable {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly frames: number;
  renderAt(ms: number): void;
}

export const VIDEO_CONFIG = {
  codec: "avc1.42001f", // Baseline 3.1: 720×1280 is exactly its 3,600-macroblock frame limit
  width: 720,
  height: 1280,
  bitrate: 1_500_000,
  framerate: 30,
} as const;
const MP4_TYPES = ["video/mp4;codecs=avc1.42E01F", "video/mp4;codecs=avc1", "video/mp4"] as const;

/** The browser features the encoder looks at (tests pass mocks). */
export interface VideoEnv {
  VideoEncoder?: { isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> } | undefined;
  VideoFrame?: unknown;
  MediaRecorder?: { isTypeSupported(type: string): boolean } | undefined;
  isSecureContext?: boolean;
}

const browserEnv = (): VideoEnv => ({
  VideoEncoder: typeof VideoEncoder === "undefined" ? undefined : VideoEncoder,
  VideoFrame: typeof VideoFrame === "undefined" ? undefined : VideoFrame,
  MediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
  isSecureContext: globalThis.isSecureContext,
});

/** The MP4 type MediaRecorder can write here, if any. */
export function recorderType(env: VideoEnv = browserEnv()): string | undefined {
  const mr = env.MediaRecorder;
  if (mr === undefined || typeof mr.isTypeSupported !== "function") return undefined;
  return MP4_TYPES.find((t) => mr.isTypeSupported(t));
}

/** Which way this device can make the MP4: WebCodecs first, then MediaRecorder MP4, else none. */
export async function pickVideoPath(env: VideoEnv = browserEnv()): Promise<VideoPath | undefined> {
  if (env.isSecureContext === false) return undefined;
  const ve = env.VideoEncoder;
  if (ve !== undefined && env.VideoFrame !== undefined) {
    try {
      const { supported } = await ve.isConfigSupported({ ...VIDEO_CONFIG, avc: { format: "avc" } });
      if (supported === true) return "webcodecs";
    } catch {
      // fall through to MediaRecorder
    }
  }
  return recorderType(env) === undefined ? undefined : "mediarecorder";
}

/** `V-318.mp4`: the clinic's visit number only, never a name or phone (M8). */
export function videoFileName(visitNumber: string): string {
  const safe = visitNumber.replace(/[^A-Za-z0-9-]/g, "");
  return `${safe === "" ? "visit" : safe}.mp4`;
}

const currentNavigator = (): Navigator | undefined => (typeof navigator === "undefined" ? undefined : navigator);

/** Whether the system share sheet takes a video file here (else the doctor downloads it). */
export function canShareVideo(nav: Partial<Pick<Navigator, "canShare" | "share">> | undefined = currentNavigator()): boolean {
  if (nav?.share === undefined || nav.canShare === undefined) return false;
  try {
    return nav.canShare({ files: [new File([new Uint8Array(0)], "V-1.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

