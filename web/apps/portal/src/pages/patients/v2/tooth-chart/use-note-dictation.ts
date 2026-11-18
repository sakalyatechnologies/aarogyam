import { useCallback, useEffect, useRef, useState } from "react";

import { createResultReader, dictationAvailable, newRecognition, type Recognition } from "../../../visits/voice/dictation.js";

/**
 * Voice typing for a one-line note, on the browser's speech recognition (the same as visit notes). Each finished phrase goes
 * to `onPhrase`; `onEnd` runs once the recogniser stops, whether the person tapped the mic again or it stopped by itself.
 */
export function useNoteDictation({ onPhrase, onEnd, language = "en-IN" }: { onPhrase: (text: string) => void; onEnd: () => void; language?: string }) {
  const recognition = useRef<Recognition | undefined>(undefined);
  const [listening, setListening] = useState(false);
  // The latest callbacks, so a recogniser started earlier still writes into the current note.
  const handlers = useRef({ onPhrase, onEnd });
  useEffect(() => {
    handlers.current = { onPhrase, onEnd };
  });

  const start = useCallback(() => {
    if (recognition.current !== undefined) return;
    const made = newRecognition();
    if (made === undefined) return;
    const reader = createResultReader();
    made.lang = language;
    made.continuous = true;
    made.interimResults = true;
    made.onresult = (event) => {
      const { finalText } = reader.read(event);
      if (finalText !== "") handlers.current.onPhrase(finalText);
    };
    made.onerror = () => {
      // "no-speech", a denied microphone: onend follows and closes the session.
    };
    made.onend = () => {
      recognition.current = undefined;
      setListening(false);
      handlers.current.onEnd();
    };
    recognition.current = made;
    made.start();
    setListening(true);
  }, [language]);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  useEffect(
    () => () => {
      const open = recognition.current;
      recognition.current = undefined;
      if (open !== undefined) {
        open.onend = null;
        open.abort();
      }
    },
    [],
  );

  return { available: dictationAvailable(), listening, start, stop };
}
