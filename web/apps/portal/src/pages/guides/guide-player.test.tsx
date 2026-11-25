import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GuidePlayer } from "./guide-player.js";
import type { PublishedGuide } from "./types.js";
import { readWatched } from "./watched.js";

const GUIDE: PublishedGuide = {
  id: "demo",
  title: "Demo guide",
  role: "front-desk",
  summary: "A demo.",
  order: 1,
  seconds: 12,
  steps: [
    { title: "First", narration: "Tap the first thing.", still: "01.webp", audio: "01.m4a", seconds: 2, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
    { title: "Second", narration: "Now the second thing.", still: "02.webp", seconds: 1, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
    { title: "Third", narration: "All done.", still: "03.webp", seconds: 1 },
  ],
};

let play: ReturnType<typeof vi.fn<() => Promise<void>>>;

beforeEach(() => {
  play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const audioEl = (): HTMLAudioElement => {
  const el = document.querySelector("audio");
  if (el === null) throw new Error("expected the audio element");
  return el;
};
const caption = () => screen.getByTestId("guide-caption").textContent;

describe("GuidePlayer", () => {
  it("makes no sound until play is pressed, and moves the ring to each step's box", async () => {
    const user = userEvent.setup();
    render(<GuidePlayer guide={GUIDE} />);
    expect(play).not.toHaveBeenCalled();
    expect(caption()).toBe("Tap the first thing.");
    expect(screen.getByTestId("guide-ring").style.left).toBe("10%");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(caption()).toBe("Now the second thing.");
    expect(screen.getByTestId("guide-ring").style.left).toBe("50%");
  });

  it("advances after the narration ends, and marks the guide watched at the end", () => {
    vi.useFakeTimers();
    render(<GuidePlayer guide={GUIDE} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      fireEvent(audioEl(), new Event("ended"));
      vi.advanceTimersByTime(1000);
    });
    expect(caption()).toBe("Now the second thing.");
    // No audio on step two: it waits its minimum, then moves on.
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(caption()).toBe("All done.");
    expect(readWatched()).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(3700);
    });
    expect(readWatched()).toEqual(["demo"]);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("falls back to a timer when the audio is missing", () => {
    vi.useFakeTimers();
    render(<GuidePlayer guide={GUIDE} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    act(() => {
      fireEvent(audioEl(), new Event("error"));
      vi.advanceTimersByTime(3700);
    });
    expect(caption()).toBe("Now the second thing.");
  });

  it("slides mode has no play button and no sound, and steps at your own pace", async () => {
    const user = userEvent.setup();
    render(<GuidePlayer guide={GUIDE} />);
    await user.click(screen.getByRole("button", { name: "Switch to slides" }));
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next step" }));
    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(caption()).toBe("All done.");
    expect(play).not.toHaveBeenCalled();
    expect(readWatched()).toEqual(["demo"]);
    await user.click(screen.getByRole("button", { name: "Previous step" }));
    expect(caption()).toBe("Now the second thing.");
  });

  it("answers the arrow keys and space, and jumps from the chapter list", async () => {
    const user = userEvent.setup();
    render(<GuidePlayer guide={GUIDE} />);
    const player = screen.getByRole("region", { name: /Demo guide/ });
    fireEvent.keyDown(player, { key: "ArrowRight" });
    expect(caption()).toBe("Now the second thing.");
    fireEvent.keyDown(player, { key: "ArrowLeft" });
    expect(caption()).toBe("Tap the first thing.");
    fireEvent.keyDown(player, { key: " " });
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(player, { key: " " });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Third/ }));
    expect(caption()).toBe("All done.");
  });

  it("cycles the speed and hides captions on request", async () => {
    const user = userEvent.setup();
    render(<GuidePlayer guide={GUIDE} />);
    const speed = () => screen.getByRole("button", { name: /^Speed/ }).textContent.trim();
    expect(speed()).toBe("1×");
    await user.click(screen.getByRole("button", { name: /^Speed/ }));
    expect(speed()).toBe("1.25×");
    await user.click(screen.getByRole("button", { name: /^Speed/ }));
    expect(speed()).toBe("1.5×");
    await user.click(screen.getByRole("button", { name: "Captions" }));
    expect(screen.queryByTestId("guide-caption")).toBeNull();
  });
});
