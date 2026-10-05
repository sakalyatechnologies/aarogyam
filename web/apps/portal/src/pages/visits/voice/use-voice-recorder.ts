import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_RECORDING_SECONDS,
  microphoneProblem,
  microphoneOpener,
  newAudioContext,
  newRecognition,
  dictationAvailable,
  pickRecordingType,
  type DictationLanguage,
  type Recognition,
} from "./dictation.js";

export type RecorderPhase = "idle" | "starting" | "recording" | "paused" | "stopped";

/** A finished recording, held in memory until the doctor keeps or discards it. */
export interface FinishedRecording {
  blob: Blob;
  /** The media type the browser recorded, such as `audio/webm`. */
  mimeType: string;
  seconds: number;
  language: DictationLanguage;
}

export interface VoiceRecorder {
  phase: RecorderPhase;
  /** Seconds recorded so far, not counting pauses. */
  seconds: number;
  /** Microphone level from 0 to 1, for the meter. */
  level: number;
  /** Words still being recognised; replaced by final text as it settles. */
  interim: string;
  /** Why recording could not start or stopped early, in plain words. */
  error: string | undefined;
  /** Set when dictation is unavailable or stopped but recording carries on. */
  dictationNote: string | undefined;
  dictationSupported: boolean;
  language: DictationLanguage;
  setLanguage: (language: DictationLanguage) => void;
  recording: FinishedRecording | undefined;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Drops the recording and returns to the start. Text already inserted stays in the note. */
  discard: () => void;
}

const TICK_MS = 250;

/**
 * Records the microphone with `MediaRecorder` and, where the browser has speech recognition, dictates
 * in the chosen language at the same time. Final text goes to `onFinalText`. Nothing is logged, and
 * neither audio nor text leaves the browser until the caller uploads the kept recording.
 */
export function useVoiceRecorder(onFinalText: (text: string) => void): VoiceRecorder {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [dictationNote, setDictationNote] = useState<string | undefined>(undefined);
  const [language, setLanguageState] = useState<DictationLanguage>("en-IN");
  const [recording, setRecording] = useState<FinishedRecording | undefined>(undefined);
  const dictationSupported = dictationAvailable();

  const onFinal = useRef(onFinalText);
  useEffect(() => {
    onFinal.current = onFinalText;
  });
  const languageRef = useRef(language);
  const stream = useRef<MediaStream | undefined>(undefined);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const recognition = useRef<Recognition | undefined>(undefined);
  const wantDictation = useRef(false);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const elapsedMs = useRef(0);
  const lastTick = useRef(0);
  const keep = useRef(true);

  const stopDictation = useCallback(() => {
    wantDictation.current = false;
    const current = recognition.current;
    recognition.current = undefined;
    if (current !== undefined) {
      current.onend = null;
      current.onresult = null;
      current.onerror = null;
      try {
        current.abort();
      } catch {
        // Already stopped.
      }
    }
    setInterim("");
  }, []);

  const startDictation = useCallback(() => {
    const next = newRecognition();
    if (next === undefined) {
      return;
    }
    next.lang = languageRef.current;
    next.continuous = true;
    next.interimResults = true;
    next.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal === true) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      setInterim(interimText);
      if (finalText.trim() !== "") {
        onFinal.current(finalText.trim());
      }
    };
    next.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      wantDictation.current = false;
      setInterim("");
      setDictationNote(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Dictation is blocked in this browser. Recording carries on; type the note yourself."
          : "Dictation stopped. Recording carries on; type the note yourself.",
      );
    };
    next.onend = () => {
      setInterim("");
      // Browsers end recognition after a silence; start it again while the doctor is still recording.
      if (wantDictation.current && recognition.current === next) {
        try {
          next.start();
        } catch {
          wantDictation.current = false;
        }
      }
    };
    recognition.current = next;
    wantDictation.current = true;
    try {
      next.start();
    } catch {
      wantDictation.current = false;
      setDictationNote("Dictation couldn't start. Recording carries on; type the note yourself.");
    }
  }, []);

  const stopMeter = useCallback(() => {
    if (frame.current !== undefined) {
      cancelAnimationFrame(frame.current);
      frame.current = undefined;
    }
    const context = audioContext.current;
    audioContext.current = undefined;
    if (context !== undefined) {
      void context.close().catch(() => undefined);
    }
    setLevel(0);
  }, []);

  const startMeter = useCallback(
    (source: MediaStream) => {
      try {
        const context = newAudioContext();
        if (context === undefined) {
          return;
        }
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(source).connect(analyser);
        audioContext.current = context;
        const samples = new Uint8Array(analyser.fftSize);
        let last = 0;
        const draw = (now: number) => {
          frame.current = requestAnimationFrame(draw);
          if (now - last < 66) {
            return;
          }
          last = now;
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const centred = (sample - 128) / 128;
            sum += centred * centred;
          }
          setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 3));
        };
        frame.current = requestAnimationFrame(draw);
      } catch {
        // No meter is not a reason to stop recording.
      }
    },
    [],
  );

  const stopTimer = useCallback(() => {
    if (timer.current !== undefined) {
      clearInterval(timer.current);
      timer.current = undefined;
    }
  }, []);

  const release = useCallback(() => {
    stopTimer();
    stopMeter();
    stopDictation();
    stream.current?.getTracks().forEach((track) => {
      track.stop();
    });
    stream.current = undefined;
  }, [stopDictation, stopMeter, stopTimer]);

  const stop = useCallback(() => {
    const current = recorder.current;
    if (current === undefined || current.state === "inactive") {
      return;
    }
    stopTimer();
    stopDictation();
    current.stop();
  }, [stopDictation, stopTimer]);

  const startTimer = useCallback(() => {
    lastTick.current = Date.now();
    timer.current = setInterval(() => {
      const now = Date.now();
      elapsedMs.current += now - lastTick.current;
      lastTick.current = now;
      const whole = Math.floor(elapsedMs.current / 1000);
      setSeconds(Math.min(whole, MAX_RECORDING_SECONDS));
      if (whole >= MAX_RECORDING_SECONDS) {
        setError("Reached the 10 minute limit, so the recording stopped. Keep it, or discard it and start again.");
        stop();
      }
    }, TICK_MS);
  }, [stop]);

  const start = useCallback(async () => {
    setError(undefined);
    setDictationNote(undefined);
    const openMicrophone = microphoneOpener();
    if (typeof MediaRecorder === "undefined" || openMicrophone === undefined) {
      setError("This browser can't record audio here. Use a current Chrome, Edge, Safari or Firefox over a secure (https) address.");
      return;
    }
    setPhase("starting");
    let opened: MediaStream;
    try {
      opened = await openMicrophone({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (thrown) {
      setError(microphoneProblem(thrown));
      setPhase("idle");
      return;
    }
    const type = pickRecordingType();
    let made: MediaRecorder;
    try {
      // A low bit rate keeps ten minutes of speech well under the 10 MB upload limit.
      made = new MediaRecorder(opened, { ...(type === undefined ? {} : { mimeType: type }), audioBitsPerSecond: 32_000 });
    } catch {
      opened.getTracks().forEach((track) => {
        track.stop();
      });
      setError("This browser can't record in a format we accept. Try Chrome, Edge or Safari.");
      setPhase("idle");
      return;
    }
    stream.current = opened;
    recorder.current = made;
    chunks.current = [];
    elapsedMs.current = 0;
    keep.current = true;
    setSeconds(0);
    setRecording(undefined);
    made.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.current.push(event.data);
      }
    };
    made.onerror = () => {
      setError("Recording stopped unexpectedly. Please try again.");
    };
    made.onstop = () => {
      const mimeType = (made.mimeType !== "" ? made.mimeType : (type ?? "audio/webm")).split(";")[0] ?? "audio/webm";
      const blob = new Blob(chunks.current, { type: mimeType });
      chunks.current = [];
      release();
      recorder.current = undefined;
      if (!keep.current) {
        setPhase("idle");
        return;
      }
      setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.round(elapsedMs.current / 1000))));
      setRecording({ blob, mimeType, seconds: Math.min(MAX_RECORDING_SECONDS, Math.max(1, Math.round(elapsedMs.current / 1000))), language: languageRef.current });
      setPhase("stopped");
    };
    made.start(1000);
    startMeter(opened);
    startTimer();
    if (dictationSupported) {
      startDictation();
    } else {
      setDictationNote("Live dictation isn't available in this browser, so only the recording is kept. Type the note yourself, or use Chrome or Edge to dictate.");
    }
    setPhase("recording");
  }, [dictationSupported, release, startDictation, startMeter, startTimer]);

  const pause = useCallback(() => {
    if (recorder.current?.state !== "recording") {
      return;
    }
    recorder.current.pause();
    stopTimer();
    elapsedMs.current += Date.now() - lastTick.current;
    stopDictation();
    setPhase("paused");
  }, [stopDictation, stopTimer]);

  const resume = useCallback(() => {
    if (recorder.current?.state !== "paused") {
      return;
    }
    recorder.current.resume();
    startTimer();
    if (dictationSupported && dictationNote === undefined) {
      startDictation();
    }
    setPhase("recording");
  }, [dictationNote, dictationSupported, startDictation, startTimer]);

  const discard = useCallback(() => {
    keep.current = false;
    const current = recorder.current;
    if (current !== undefined && current.state !== "inactive") {
      current.stop();
    } else {
      release();
      setPhase("idle");
    }
    chunks.current = [];
    setRecording(undefined);
    setSeconds(0);
    setError(undefined);
    setPhase("idle");
  }, [release]);

  const setLanguage = useCallback((next: DictationLanguage) => {
    languageRef.current = next;
    setLanguageState(next);
  }, []);

  useEffect(
    () => () => {
      keep.current = false;
      const current = recorder.current;
      if (current !== undefined) {
        current.ondataavailable = null;
        current.onstop = null;
        if (current.state !== "inactive") {
          current.stop();
        }
      }
      release();
    },
    [release],
  );

  return { phase, seconds, level, interim, error, dictationNote, dictationSupported, language, setLanguage, recording, start, pause, resume, stop, discard };
}
