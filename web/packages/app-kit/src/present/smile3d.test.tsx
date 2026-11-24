import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import { presentFacts } from "./model.js";
import { Smile3d, layoutArch } from "./smile3d.js";
import { SMILE3D_FALLBACK_LINE, probePasses, smile3dAllowed } from "./smile3d-gate.js";
import { Smile3dSlot } from "./smile3d-slot.js";

afterEach(cleanup);
const model = () => presentFacts(structuredClone(aaravFixture.snapshot));
const slotProps = () => ({
  model: model(), slot: { open: () => undefined, stateOf: (): never => { throw new Error("unused"); }, was: undefined, filter: undefined }, orientation: "mirror" as const, onOrientation: () => undefined,
  shade: 33, onShade: () => undefined, theme: "light" as const,
});

describe("3D smile gate (§6.4)", () => {
  it("needs WebGL2, memory >= 4 GB where reported and 6 cores", () => {
    expect(smile3dAllowed({ webgl2: true, deviceMemory: 8, hardwareConcurrency: 8 })).toBe(true);
    expect(smile3dAllowed({ webgl2: true })).toBe(true);
    expect(smile3dAllowed({ webgl2: false, deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(smile3dAllowed({ webgl2: true, deviceMemory: 2, hardwareConcurrency: 8 })).toBe(false);
    expect(smile3dAllowed({ webgl2: true, deviceMemory: 8, hardwareConcurrency: 4 })).toBe(false);
  });
  it("the 2 s probe stops under 24 fps", () => {
    expect(probePasses(60, 2000)).toBe(true);
    expect(probePasses(47, 2000)).toBe(false);
  });
});

describe("3D smile fallback is tested", () => {
  it("a failed gate renders the painted style with the inline line", async () => {
    const { container } = render(<Smile3dSlot {...slotProps()} env={{ webgl2: false }} />);
    expect(screen.getByTestId("smile3d-fallback").textContent).toBe(SMILE3D_FALLBACK_LINE);
    await waitFor(() => { expect(container.querySelector('[data-present-style="painted"]')).not.toBeNull(); });
    expect(container.querySelector('[data-present-style="smile3d"]')).toBeNull();
  });
  it("a passing gate whose WebGL then fails (no context) falls back the same way", async () => {
    const { container } = render(<Smile3dSlot {...slotProps()} env={{ webgl2: true, deviceMemory: 8, hardwareConcurrency: 8 }} />);
    await waitFor(() => { expect(screen.getByTestId("smile3d-fallback")).toBeTruthy(); });
    await waitFor(() => { expect(container.querySelector('[data-present-style="painted"]')).not.toBeNull(); });
  });
});

describe("3D smile content", () => {
  it("badges the model as an illustration", () => {
    render(<Smile3d model={model()} orientation="mirror" onOrientation={() => undefined} theme="light" onOpen={() => undefined} />);
    expect(screen.getByText(/3D model based on your record \(Beta\)/)).toBeTruthy();
  });
  it("puts each tooth on the arch once; the patient's right is on the right in the mirror", () => {
    const m = model();
    const slots = layoutArch(m.teeth, "mirror");
    expect(new Set(slots.map((s) => s.tooth)).size).toBe(slots.length);
    const t11 = slots.find((s) => s.tooth === 11), t21 = slots.find((s) => s.tooth === 21);
    if (t11 !== undefined && t21 !== undefined) { expect(t11.x).toBeGreaterThan(0); expect(t21.x).toBeLessThan(0); }
    const photo = layoutArch(m.teeth, "photo").find((s) => s.tooth === 11);
    if (photo !== undefined) expect(photo.x).toBeLessThan(0);
  });
});
