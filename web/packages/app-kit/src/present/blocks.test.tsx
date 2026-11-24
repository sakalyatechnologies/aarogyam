import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import { RecordBadge, StyleSwitcher, TextFallback, useChunk } from "./blocks.js";
import { presentFacts } from "./model.js";
import { PaintedStyle } from "./painted.js";
import { DEFAULT_STYLE, PRESENT_STYLES, isShipped } from "./styles.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const model = () => presentFacts(structuredClone(aaravFixture.snapshot));

describe("badges", () => {
  it("solid 'Recorded' with the date, or bare without one", () => {
    render(<><RecordBadge on="2026-10-20" /><RecordBadge /></>);
    expect(screen.getByText("Recorded 20 Oct")).toBeTruthy();
    expect(screen.getByText("Recorded")).toBeTruthy();
  });
});

describe("style switcher", () => {
  const options = [...PRESENT_STYLES.map((s) => ({ id: s.id, label: s.label, beta: s.beta, disabled: isShipped(s.id) ? undefined : "Coming soon", note: s.id === DEFAULT_STYLE ? "Default" : undefined })), { id: "chart", label: "Chart", separate: true }];

  it("lists the five styles in the ranking order, story, painted, own X-ray and 3D smile enabled, then the chart", () => {
    render(<StyleSwitcher options={options} value="painted" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Style/ }));
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.textContent.replace(/Coming soon|Beta|Default|✓/g, ""))).toEqual(["Story cards", "Painted smile", "Own X-ray", "3D smile", "Face to tooth", "Chart"]);
    expect(opts.filter((o) => o.getAttribute("aria-disabled") === "true").map((o) => o.id.split("-").pop())).toEqual([]);
    expect(opts[0]?.textContent).toContain("Default");
    expect(opts[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("every style and the chart can be chosen; arrows move; Esc closes", () => {
    const onChange = vi.fn();
    render(<StyleSwitcher options={options} value="painted" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Style/ }));
    fireEvent.click(screen.getByRole("option", { name: /Face to tooth/ }));
    expect(onChange).toHaveBeenLastCalledWith("face");
    fireEvent.click(screen.getByRole("button", { name: /Style/ }));
    fireEvent.click(screen.getByRole("option", { name: /Chart/ }));
    expect(onChange).toHaveBeenCalledWith("chart");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Style/ }));
    const list = screen.getByRole("listbox");
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("chart");
    fireEvent.click(screen.getByRole("button", { name: /Style/ }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("text fallback (§13)", () => {
  it("shows the same facts as text with a one-tap retry", () => {
    const retry = vi.fn();
    const m = model();
    const { container } = render(<TextFallback model={m} onRetry={retry} />);
    expect([...container.querySelectorAll("[data-fact]")].map((e) => e.getAttribute("data-fact"))).toEqual(m.facts.map((f) => f.id));
    fireEvent.click(screen.getByRole("button", { name: "Try the picture again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  function Probe({ load }: { load: () => Promise<string> }) {
    const c = useChunk(load, 8000);
    return c.state === "failed" ? <button type="button" onClick={c.retry}>retry</button> : <p>{c.state === "ready" ? c.value : "loading"}</p>;
  }

  it("a chunk that fails, or takes over 8 s, gives 'failed'; retry loads it again", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const load = () => { calls += 1; return calls === 1 ? new Promise<string>(() => undefined) : Promise.resolve("painted"); };
    render(<Probe load={load} />);
    expect(screen.getByText("loading")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(8001); });
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText("painted")).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("a rejected import fails at once", async () => {
    render(<Probe load={() => Promise.reject(new Error("offline"))} />);
    expect(await screen.findByRole("button", { name: "retry" })).toBeTruthy();
  });
});

describe("painted style, tooth colour slider", () => {
  const render1 = (extra: Record<string, unknown>) =>
    render(<PaintedStyle model={model()} orientation="mirror" onOrientation={() => undefined} shade={33} onShade={() => undefined} theme="light" onOpen={() => undefined} {...extra} />);
  it("offers Save colour only when the colour differs from the saved one and saving is wired", () => {
    const onSave = vi.fn();
    const { unmount } = render1({});
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
    unmount();
    const clean = render1({ shadeDirty: false, onSaveShade: onSave });
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
    clean.unmount();
    const noSave = render1({ shadeDirty: true });
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
    noSave.unmount();
    render1({ shadeDirty: true, onSaveShade: onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save colour" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it("disables Save colour while saving", () => {
    render1({ shadeDirty: true, onSaveShade: () => undefined, savingShade: true });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save colour" }).disabled).toBe(true);
  });
});

describe("painted style", () => {
  it("a dot or a list row opens that tooth; the knobs change no fact", () => {
    const onOpen = vi.fn(), onShade = vi.fn(), onOrientation = vi.fn();
    const m = model();
    const { container } = render(<PaintedStyle model={m} orientation="mirror" onOrientation={onOrientation} shade={33} onShade={onShade} theme="light" onOpen={onOpen} />);
    const dot = container.querySelector('.ps-dot[data-tooth="21"]');
    if (dot === null) throw new Error("no dot on 21");
    fireEvent.click(dot);
    expect(onOpen).toHaveBeenLastCalledWith(21);
    fireEvent.keyDown(dot, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(2);
    const rows = screen.getAllByRole("button", { name: /Upper right back milk tooth, 55/ });
    expect(rows.map((r) => r.tagName)).toEqual(["g", "BUTTON"]);
    fireEvent.click(rows[1] ?? dot);
    expect(onOpen).toHaveBeenLastCalledWith(55);
    fireEvent.change(screen.getByRole("slider", { name: "Tooth colour" }), { target: { value: "80" } });
    expect(onShade).toHaveBeenCalledWith(80);
    fireEvent.click(screen.getByRole("button", { name: "As in a photo" }));
    expect(onOrientation).toHaveBeenCalledWith("photo");
    expect(container.textContent).toContain("Colour chosen to look like you");
    expect(screen.getByRole("button", { name: "As in your mirror" }).getAttribute("aria-pressed")).toBe("true");
  });
});
