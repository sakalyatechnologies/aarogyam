import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PROGRESS_DELAY_MS, ProgressBar } from "./progress-bar.js";

function Slow({ ms }: { ms: number }) {
  useQuery({ queryKey: ["slow", ms], queryFn: () => new Promise<number>((resolve) => setTimeout(() => { resolve(ms); }, ms)) });
  return null;
}

function setup(ms: number) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProgressBar />
      <Slow ms={ms} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ProgressBar", () => {
  it("stays hidden for a request that finishes inside the delay", async () => {
    setup(PROGRESS_DELAY_MS - 50);
    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_DELAY_MS - 60));
    expect(screen.queryByTestId("progress-bar")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(screen.queryByTestId("progress-bar")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("appears after the delay, is hidden from screen readers, announces Loading once, and goes away", async () => {
    setup(1000);
    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_DELAY_MS + 10));
    const bar = screen.getByTestId("progress-bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Loading");
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.queryByTestId("progress-bar")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loading");
  });
});
