import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { insertAt } from "./dictation.js";
import type { FinishedRecording } from "./use-voice-recorder.js";
import { FakeMediaRecorder, FakeRecognition, installVoiceDoubles, removeVoiceDoubles } from "./test-doubles.js";
import { VoiceRecorder } from "./voice-recorder.js";

afterEach(() => {
  vi.useRealTimers();
  removeVoiceDoubles();
});

function renderRecorder(onKeep = vi.fn<(recording: FinishedRecording) => Promise<void>>(() => Promise.resolve())) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(<VoiceRecorder onInsert={onInsert} onKeep={onKeep} onClose={onClose} />);
  return { onInsert, onKeep, onClose };
}

describe("Voice recorder", () => {
  it("records, pauses, resumes, stops and keeps, dictating final text into the note", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const { onInsert, onKeep } = renderRecorder();

    await user.selectOptions(screen.getByLabelText("Language"), "hi-IN");
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByRole("timer");
    const recognition = FakeRecognition.instances[0];
    expect(recognition?.lang).toBe("hi-IN");
    expect(recognition?.interimResults).toBe(true);
    expect(FakeMediaRecorder.instances[0]?.options.mimeType).toBe("audio/webm;codecs=opus");

    // Interim words show but are not inserted; final words are.
    act(() => {
      recognition?.say("pain on", false);
    });
    expect(screen.getByText("Hearing: pain on")).toBeTruthy();
    expect(onInsert).not.toHaveBeenCalled();
    act(() => {
      recognition?.say("pain on chewing", true);
    });
    expect(onInsert).toHaveBeenCalledWith("pain on chewing");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("timer").textContent).toContain("Paused");
    expect(FakeMediaRecorder.instances[0]?.state).toBe("paused");
    expect(recognition?.aborted).toBe(true);
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(FakeMediaRecorder.instances[0]?.state).toBe("recording");
    expect(FakeRecognition.instances).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await screen.findByRole("button", { name: "Keep recording" });
    await user.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    const kept = onKeep.mock.calls[0]?.[0];
    expect(kept).toBeDefined();
    expect(kept?.mimeType).toBe("audio/webm");
    expect(kept?.language).toBe("hi-IN");
    expect(kept?.seconds).toBeGreaterThanOrEqual(1);
    expect(kept?.blob.size).toBeGreaterThan(0);
  });

  it("discards a recording and starts clean, releasing the microphone", async () => {
    const { stopTrack } = installVoiceDoubles();
    const user = userEvent.setup();
    const { onKeep } = renderRecorder();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Discard recording" }));
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
    expect(onKeep).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalled();
  });

  it("falls back to MP4 where WebM is unsupported (Safari)", async () => {
    installVoiceDoubles();
    FakeMediaRecorder.supported = ["audio/mp4"];
    const user = userEvent.setup();
    const { onKeep } = renderRecorder();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Keep recording" }));
    expect(FakeMediaRecorder.instances[0]?.options.mimeType).toBe("audio/mp4");
    expect(onKeep.mock.calls[0]?.[0].mimeType).toBe("audio/mp4");
  });

  it("records only, with a message, where the browser has no dictation", async () => {
    installVoiceDoubles({ dictation: false });
    const user = userEvent.setup();
    renderRecorder();
    expect(screen.getByText(/Live dictation isn't available in this browser/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByRole("timer");
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toContain("only the recording is kept");
  });

  it("explains a blocked microphone and stays ready to retry", async () => {
    installVoiceDoubles({ microphone: "denied" });
    const user = userEvent.setup();
    renderRecorder();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Microphone access is blocked/);
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("explains a missing microphone", async () => {
    installVoiceDoubles({ microphone: "missing" });
    const user = userEvent.setup();
    renderRecorder();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No microphone was found/);
  });

  it("keeps recording when dictation fails, and says so", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    renderRecorder();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByRole("timer");
    act(() => {
      FakeRecognition.instances[0]?.onerror?.({ error: "not-allowed" });
    });
    expect(screen.getByRole("status").textContent).toContain("Dictation is blocked");
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  });

  it("stops by itself at ten minutes", async () => {
    vi.useFakeTimers();
    installVoiceDoubles();
    renderRecorder();
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("timer")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(601_000);
    });
    expect(screen.getByRole("button", { name: "Keep recording" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("10 minute limit");
    expect(FakeMediaRecorder.instances[0]?.state).toBe("inactive");
  });

  it("shows a failed save and lets the doctor retry", async () => {
    installVoiceDoubles();
    const user = userEvent.setup();
    const onKeep = vi.fn<(recording: FinishedRecording) => Promise<void>>(() => Promise.resolve()).mockRejectedValueOnce(new Error("The server is busy."));
    renderRecorder(onKeep);
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    await user.click(await screen.findByRole("button", { name: "Keep recording" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The server is busy.");
    await user.click(screen.getByRole("button", { name: "Keep recording" }));
    expect(onKeep).toHaveBeenCalledTimes(2);
  });
});

describe("insertAt", () => {
  it("puts text at the cursor with sensible spacing", () => {
    expect(insertAt("Pain chewing", 4, 4, "on")).toEqual({ value: "Pain on chewing", cursor: 7 });
    expect(insertAt("", 0, 0, "Pain")).toEqual({ value: "Pain", cursor: 4 });
    expect(insertAt("Pain", 4, 4, "on 36")).toEqual({ value: "Pain on 36", cursor: 10 });
    expect(insertAt("Pain X chewing", 5, 6, "on")).toEqual({ value: "Pain on chewing", cursor: 7 });
    expect(insertAt("abc", 99, 99, "d").value).toBe("abc d");
  });
});
