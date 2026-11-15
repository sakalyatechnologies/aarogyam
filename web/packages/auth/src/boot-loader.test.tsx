import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BootLoader, BootLoaderProvider, BootStage } from "./index.js";

afterEach(cleanup);

describe("BootLoader", () => {
  it("keeps one loader element while its text changes", () => {
    const { rerender } = render(
      <BootLoaderProvider>
        <BootStage text="Signing you in…" />
      </BootLoaderProvider>,
    );
    const loader = screen.getByTestId("boot-loader");
    expect(loader.textContent).toContain("Signing you in…");
    rerender(
      <BootLoaderProvider>
        <BootStage text="Opening Sunrise Dental…" />
      </BootLoaderProvider>,
    );
    expect(screen.getByTestId("boot-loader")).toBe(loader);
    expect(loader.textContent).toContain("Opening Sunrise Dental…");
  });

  it("goes away when no stage is shown", () => {
    const { rerender } = render(
      <BootLoaderProvider>
        <BootStage text="Signing you in…" />
      </BootLoaderProvider>,
    );
    rerender(<BootLoaderProvider>{null}</BootLoaderProvider>);
    expect(screen.queryByTestId("boot-loader")).toBeNull();
  });

  it("shows a failure with Try again and Back to sign in", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onBack = vi.fn();
    render(<BootLoader text="We couldn't open this clinic" failure={{ message: "The service is busy.", onRetry, onBack }} />);
    expect(screen.getByRole("alert").textContent).toContain("The service is busy.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("moves focus to the error heading and offers only Back to sign in when there is no retry", () => {
    render(<BootLoader text="That sign-in didn't work" failure={{ message: "Used.", onBack: vi.fn() }} />);
    expect(document.activeElement?.tagName).toBe("H1");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to sign in" })).toBeTruthy();
  });
});
