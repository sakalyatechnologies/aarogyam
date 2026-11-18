import { useCallback, useState } from "react";

import { useClinic } from "../clinic.js";
import { DICTATION_LANGUAGES, type DictationLanguage } from "../pages/visits/voice/dictation.js";

/** One key per person, like the chart preferences, so two staff sharing a browser keep their own. */
export const dictationLanguageKey = (userId: string): string => `aarogyam.portal.dictation-language.${userId}`;

const DEFAULT: DictationLanguage = "en-IN";

function read(userId: string): DictationLanguage {
  try {
    const stored = globalThis.localStorage.getItem(dictationLanguageKey(userId));
    return DICTATION_LANGUAGES.find((l) => l.value === stored)?.value ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * The language this person dictates in first (My profile, "Voice notes language"): visit notes and tooth notes
 * start in it, and either can still be switched for one note. Kept in this browser.
 */
export function useDictationLanguage(): [DictationLanguage, (language: DictationLanguage) => void] {
  const { session } = useClinic();
  const userId = session.user.id;
  const [language, setLanguage] = useState<DictationLanguage>(() => read(userId));
  const choose = useCallback(
    (next: DictationLanguage) => {
      setLanguage(next);
      try {
        globalThis.localStorage.setItem(dictationLanguageKey(userId), next);
      } catch {
        // Storage refused: the choice lasts for this page only.
      }
    },
    [userId],
  );
  return [language, choose];
}
