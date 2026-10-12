import { describe, expect, it } from "vitest";

import { createResultReader, type RecognitionEvent } from "./dictation.js";

/** An event like the browser's: `phrases` are all results so far, `from` is the first changed one. */
function event(from: number, phrases: readonly { text: string; final: boolean }[]): RecognitionEvent {
  const results: Record<number, { isFinal: boolean; 0: { transcript: string } }> = {};
  phrases.forEach((phrase, index) => {
    results[index] = { isFinal: phrase.final, 0: { transcript: phrase.text } };
  });
  return { resultIndex: from, results: { length: phrases.length, ...results } };
}

const SENTENCE = "Pain on the lower left molar since two days, worse on chewing";

describe("createResultReader", () => {
  it("replaces interim text and delivers the final text once", () => {
    const reader = createResultReader();
    expect(reader.read(event(0, [{ text: "Pain on the lower", final: false }]))).toEqual({ finalText: "", interimText: "Pain on the lower" });
    expect(reader.read(event(0, [{ text: "Pain on the lower left molar", final: false }]))).toEqual({ finalText: "", interimText: "Pain on the lower left molar" });
    expect(reader.read(event(0, [{ text: SENTENCE, final: true }]))).toEqual({ finalText: SENTENCE, interimText: "" });
  });

  it("does not deliver a final again when the browser re-sends it", () => {
    const reader = createResultReader();
    expect(reader.read(event(0, [{ text: SENTENCE, final: true }])).finalText).toBe(SENTENCE);
    expect(reader.read(event(0, [{ text: SENTENCE, final: true }]))).toEqual({ finalText: "", interimText: "" });
    expect(
      reader.read(
        event(1, [
          { text: SENTENCE, final: true },
          { text: SENTENCE, final: false },
        ]),
      ),
    ).toEqual({ finalText: "", interimText: "" });
  });

  it("keeps later phrases, and starts numbering again after the session ends", () => {
    const reader = createResultReader();
    reader.read(event(0, [{ text: "first", final: true }]));
    expect(reader.read(event(1, [{ text: "first", final: true }, { text: "second", final: true }])).finalText).toBe("second");
    reader.reset();
    expect(reader.read(event(0, [{ text: "first", final: true }])).finalText).toBe("first");
  });
});
