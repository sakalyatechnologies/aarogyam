import { useCallback, useEffect, useRef, useState } from "react";

import { createResultReader, dictationAvailable, newRecognition, type Recognition } from "../../../visits/voice/dictation.js";

/**
 * Voice typing for a one-line note, on the browser's speech recognition, and dictating the way visit notes do: the words show
 * while they are heard (`interim`), a pause doesn't end it (browsers stop after a silence, so it starts again), and stopping
 * keeps words that were heard but not yet final. Each finished phrase goes to `onPhrase`; `onEnd` runs once it has stopped.
 */
export function useNoteDictation({ onPhrase, onEnd, language = "en-IN" }: { onPhrase: (text: string) => void; onEnd: () => void; language?: string }) {
  const recognition = useRef<Recognition | undefined>(undefined);
  const want = useRef(false);
  const heard = useRef("");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  // The latest callbacks, so a recogniser started earlier still writes into the current note.
  const handlers = useRef({ onPhrase, onEnd });
  useEffect(() => {
    handlers.current = { onPhrase, onEnd };
  });

  /** Hands over what is still only interim, so stopping right after speaking loses nothing. */
  const keepInterim = useCallback(() => {
    const text = heard.current.trim();
    heard.current = "";
    setInterim("");
    if (text !== "") handlers.current.onPhrase(text);
  }, []);

  const finish = useCallback((made: Recognition) => {
    made.onresult = null;
    made.onerror = null;
    made.onend = null;
    if (recognition.current === made) recognition.current = undefined;
    want.current = false;
    setListening(false);
    handlers.current.onEnd();
  }, []);

  const start = useCallback(() => {
    if (recognition.current !== undefined) return;
    const made = newRecognition();
    if (made === undefined) return;
    const reader = createResultReader();
    made.lang = language;
    made.continuous = true;
    made.interimResults = true;
    made.onresult = (event) => {
      const { finalText, interimText } = reader.read(event);
      heard.current = interimText;
      setInterim(interimText);
      if (finalText !== "") handlers.current.onPhrase(finalText);
    };
    made.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      want.current = false;
      setProblem(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "The microphone or voice typing is blocked in this browser. Type the note instead."
          : event.error === "network"
            ? "Voice typing couldn't reach the speech service. Check the internet, or type the note."
            : "Voice typing stopped. Type the note instead.",
      );
    };
    made.onend = () => {
      keepInterim();
      reader.reset();
      if (want.current && recognition.current === made) {
        try {
          made.start();
          return;
        } catch {
          // Couldn't start again: finish below.
        }
      }
      finish(made);
    };
    recognition.current = made;
    want.current = true;
    setProblem(undefined);
    try {
      made.start();
      setListening(true);
    } catch {
      recognition.current = undefined;
      want.current = false;
      setProblem("Voice typing couldn't start. Type the note instead.");
    }
  }, [language, keepInterim, finish]);

  const stop = useCallback(() => {
    const made = recognition.current;
    if (made === undefined) return;
    keepInterim();
    finish(made);
    try {
      made.abort();
    } catch {
      // Already stopped.
    }
  }, [keepInterim, finish]);

  useEffect(
    () => () => {
      const open = recognition.current;
      recognition.current = undefined;
      want.current = false;
      if (open !== undefined) {
        open.onresult = null;
        open.onerror = null;
        open.onend = null;
        open.abort();
      }
    },
    [],
  );

  return { available: dictationAvailable(), listening, interim, problem, start, stop };
}
