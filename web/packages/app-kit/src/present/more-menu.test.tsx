import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MoreMenu, type MoreMenuProps } from "./more-menu.js";
import { PRESENT_STYLES } from "./styles.js";

afterEach(cleanup);

const looks = PRESENT_STYLES.map((s) => ({ id: s.id, label: s.label }));
const base = (extra: Partial<MoreMenuProps> = {}): MoreMenuProps => ({
  looks, look: "story", onLook: () => undefined, orientation: "mirror", onOrientation: () => undefined,
  shade: 33, onShade: () => undefined, dark: false, onDark: () => undefined, onBrush: () => undefined, ...extra,
});
const open = (extra?: Partial<MoreMenuProps>) => {
  render(<MoreMenu {...base(extra)} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
};

describe("More menu", () => {
  it("holds the looks, picture knobs, dark screen and How to brush", () => {
    const onLook = vi.fn(), onDark = vi.fn(), onBrush = vi.fn(), onOrientation = vi.fn(), onShade = vi.fn();
    open({ onLook, onDark, onBrush, onOrientation, onShade });
    expect(screen.getAllByRole("menuitemradio").map((r) => r.textContent.replace(/Beta|✓/g, ""))).toEqual(["Your visit", "Map + list"]);
    fireEvent.click(screen.getByRole("button", { name: "As in a photo" }));
    expect(onOrientation).toHaveBeenCalledWith("photo");
    fireEvent.change(screen.getByRole("slider", { name: "Tooth colour" }), { target: { value: "80" } });
    expect(onShade).toHaveBeenCalledWith(80);
    fireEvent.click(screen.getByRole("button", { name: /Dark screen/ }));
    expect(onDark).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /How to brush/ }));
    expect(onBrush).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Map \+ list/ }));
    expect(onLook).toHaveBeenCalledWith("painted");
  });

  it("offers Save colour only when the colour differs and saving is wired; disabled while saving", () => {
    const onSave = vi.fn();
    open({ shadeDirty: false, onSaveShade: onSave });
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
    cleanup();
    open({ shadeDirty: true });
    expect(screen.queryByRole("button", { name: "Save colour" })).toBeNull();
    cleanup();
    open({ shadeDirty: true, onSaveShade: onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save colour" }));
    expect(onSave).toHaveBeenCalledOnce();
    cleanup();
    open({ shadeDirty: true, onSaveShade: onSave, savingShade: true });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save colour" }).disabled).toBe(true);
  });

  it("Make default only when offered; the chart controls only while the chart shows; Esc closes", () => {
    const onMakeDefault = vi.fn(), onActive = vi.fn();
    const chart = { active: false, onActive, looks: [{ value: "rows", label: "Rows" }], look: "rows", onLook: () => undefined, dentitions: [{ value: "adult", label: "Adult" }], dentition: "adult", onDentition: () => undefined };
    open({ onMakeDefault, chart });
    expect(screen.queryByRole("group", { name: "Chart look" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Make this look the default" }));
    expect(onMakeDefault).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Show the chart" }));
    expect(onActive).toHaveBeenCalledWith(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "More options" })).toBeNull();
    cleanup();
    open({ chart: { ...chart, active: true } });
    expect(screen.getByRole("group", { name: "Chart look" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make this look the default" })).toBeNull();
  });
});
