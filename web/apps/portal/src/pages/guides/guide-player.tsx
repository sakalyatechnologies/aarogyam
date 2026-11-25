import { Captions, ChevronLeft, ChevronRight, Gauge, MonitorPlay, Pause, Play, Presentation } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { GUIDES_BASE, type PublishedGuide } from "./types.js";
import { markWatched } from "./watched.js";
import "./guides.css";

const SPEEDS = [1, 1.25, 1.5] as const;
/** A step with no sound (or a sound that will not load) stays up this long at least, in seconds. */
const MIN_STEP_SECONDS = 3;
const GAP_SECONDS = 0.6;

export type PlayerMode = "video" | "slides";

/**
 * The guide player: a still with a cursor and ring that glide to each tap, narration that plays step by step,
 * captions, a chapter list and a Slides mode. Nothing makes a sound until the viewer presses play.
 */
export function GuidePlayer({ guide, base = GUIDES_BASE }: { guide: PublishedGuide; base?: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [mode, setMode] = useState<PlayerMode>("video");
  const [captions, setCaptions] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const last = guide.steps.length - 1;
  const step = guide.steps[index];

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.min(last, Math.max(0, next)));
    },
    [last],
  );

  // Slides count as watched once the last step is shown; video, once it has played out (below).
  useEffect(() => {
    if (mode === "slides" && index === last) markWatched(guide.id);
  }, [mode, index, last, guide.id]);

  // Video mode: narrate the step, then move on. A missing or broken sound falls back to a timer.
  useEffect(() => {
    if (!playing || mode !== "video" || step === undefined) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const audio = audioRef.current;
    const advance = () => {
      if (index >= last) {
        markWatched(guide.id);
        setPlaying(false);
      } else {
        setIndex(index + 1);
      }
    };
    const later = (seconds: number) => {
      timer = setTimeout(advance, (seconds * 1000) / speed);
    };
    const fallback = () => {
      later(Math.max(MIN_STEP_SECONDS, step.seconds + GAP_SECONDS));
    };
    const onEnded = () => {
      later(GAP_SECONDS);
    };
    if (audio === null || step.audio === undefined) {
      fallback();
    } else {
      audio.src = `${base}/${guide.id}/${step.audio}`;
      audio.playbackRate = speed;
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", fallback);
      try {
        void Promise.resolve(audio.play()).catch(fallback);
      } catch {
        fallback();
      }
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      if (audio !== null) {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", fallback);
        try {
          audio.pause();
        } catch {
          // Not a real media element (a test).
        }
      }
    };
  }, [playing, mode, index, speed, step, last, guide.id, base]);

  // Warm the next still, so the step change does not flash.
  useEffect(() => {
    const next = guide.steps[index + 1];
    if (next !== undefined && typeof Image !== "undefined") new Image().src = `${base}/${guide.id}/${next.still}`;
  }, [index, guide, base]);

  const togglePlay = () => {
    if (mode !== "video") return;
    if (!playing && index >= last && step !== undefined) setIndex(0);
    setPlaying(!playing);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === " " && tag !== "BUTTON" && tag !== "SELECT") {
      event.preventDefault();
      if (mode === "video") togglePlay();
      else goTo(index + 1);
    }
  };

  if (step === undefined) return <p className="gp-empty">This guide has no steps.</p>;
  const box = step.box;
  // The cursor rests low in the box, like a hand about to tap.
  const cursor = box === undefined ? undefined : { left: `${String((box.x + box.w * 0.55) * 100)}%`, top: `${String((box.y + box.h * 0.62) * 100)}%` };

  return (
    <div className="gp" role="region" aria-label={`Guide: ${guide.title}`} tabIndex={-1} onKeyDown={onKeyDown} data-mode={mode}>
      <div className="gp-main">
        <div className="gp-stage" data-testid="guide-stage">
          <img className="gp-still" src={`${base}/${guide.id}/${step.still}`} alt={`Step ${String(index + 1)}: ${step.title}`} width={1366} height={768} />
          {box === undefined ? null : (
            <span
              className="gp-ring"
              data-testid="guide-ring"
              style={{ left: `${String(box.x * 100)}%`, top: `${String(box.y * 100)}%`, width: `${String(box.w * 100)}%`, height: `${String(box.h * 100)}%` }}
            />
          )}
          {cursor === undefined ? null : (
            <svg className="gp-cursor" viewBox="0 0 24 24" aria-hidden="true" style={cursor}>
              <path d="M5 3l14 8-6 1.6L9.6 19z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        {captions || mode === "slides" ? (
          <p className="gp-caption" role="status" aria-live="polite" data-testid="guide-caption">
            {step.narration}
          </p>
        ) : null}
        <audio ref={audioRef} preload="none" />
        <div className="gp-bar" role="group" aria-label="Player controls">
          <button type="button" className="gp-btn" aria-label="Previous step" disabled={index === 0} onClick={() => { goTo(index - 1); }}>
            <ChevronLeft aria-hidden="true" />
          </button>
          {mode === "video" ? (
            <button type="button" className="gp-btn gp-play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
          ) : null}
          <button type="button" className="gp-btn" aria-label="Next step" disabled={index === last} onClick={() => { goTo(index + 1); }}>
            <ChevronRight aria-hidden="true" />
          </button>
          <span className="gp-count" aria-live="off">
            {index + 1} / {guide.steps.length}
          </span>
          <span className="gp-grow" />
          {mode === "video" ? (
            <button
              type="button"
              className="gp-btn gp-text"
              aria-label={`Speed ${String(speed)} times. Change speed`}
              onClick={() => {
                setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1);
              }}
            >
              <Gauge aria-hidden="true" /> {speed}×
            </button>
          ) : null}
          <button type="button" className="gp-btn gp-text" aria-pressed={captions} aria-label="Captions" onClick={() => { setCaptions(!captions); }}>
            <Captions aria-hidden="true" /> <span className="gp-hide-s">Captions</span>
          </button>
          <button
            type="button"
            className="gp-btn gp-text"
            aria-label={mode === "video" ? "Switch to slides" : "Switch to video"}
            onClick={() => {
              setPlaying(false);
              setMode(mode === "video" ? "slides" : "video");
            }}
          >
            {mode === "video" ? <Presentation aria-hidden="true" /> : <MonitorPlay aria-hidden="true" />}
            <span className="gp-hide-s">{mode === "video" ? "Slides" : "Video"}</span>
          </button>
        </div>
        <div className="gp-progress" aria-hidden="true">
          <span style={{ width: `${String(((index + 1) / guide.steps.length) * 100)}%` }} />
        </div>
      </div>
      <nav className="gp-chapters" aria-label="Chapters">
        <ol>
          {guide.steps.map((s, i) => (
            <li key={s.title + String(i)}>
              <button type="button" aria-current={i === index ? "step" : undefined} onClick={() => { goTo(i); }}>
                <span className="gp-n">{i + 1}</span>
                {s.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
