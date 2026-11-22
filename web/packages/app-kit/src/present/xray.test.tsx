// Own X-ray (slice 1e): never flipped, edge labels, findings open the shared tooth sheet.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import { presentFacts } from "./model.js";
import { storyCards } from "./story.js";
import { XrayStyle, XrayView } from "./xray.js";

afterEach(cleanup);
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const model = () => presentFacts(structuredClone(aaravFixture.snapshot));

describe("Own X-ray", () => {
  it("never flips: no scale or mirroring transform on the image, its stage or any overlay", () => {
    const { container } = render(<XrayStyle model={model()} image={{ src: PIXEL, alt: "OPG", caption: "OPG from 2 Oct" }} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    for (const el of [img, ...container.querySelectorAll(".ps-xr-stage, .ps-xr-stage *")]) {
      const style = el?.getAttribute("style") ?? "";
      expect(style).not.toMatch(/scale|matrix|rotateY|rotate3d/i);
      expect(el?.getAttribute("class") ?? "").not.toMatch(/flip|mirror/i);
    }
  });

  it("labels the patient's right on the left edge and the patient's left on the right edge", () => {
    const { container } = render(<XrayView src={PIXEL} alt="OPG" />);
    expect(container.querySelector('.ps-xr-edge[data-side="left"]')?.textContent).toBe("Your right");
    expect(container.querySelector('.ps-xr-edge[data-side="right"]')?.textContent).toBe("Your left");
  });

  it("lists the recorded findings with Recorded badges, and a finding opens the tooth sheet", async () => {
    const m = model();
    const { container } = render(<XrayStyle model={m} image={{ src: PIXEL, alt: "OPG" }} />);
    const listed = [...container.querySelectorAll(".ps-found [data-fact]")].map((el) => el.getAttribute("data-fact"));
    expect(listed).toEqual(m.facts.map((f) => f.id));
    expect(container.querySelectorAll(".ps-found .ps-badge-rec").length).toBe(m.facts.length);
    const tooth = m.facts.find((f) => f.tooth !== undefined)?.tooth;
    const open = container.querySelector(`.ps-found-open[aria-label*="${String(tooth)}"]`) ?? container.querySelector(".ps-found-open");
    if (open === null) throw new Error("no finding to open");
    fireEvent.click(open);
    await waitFor(() => { expect(container.querySelector("[data-tooth-sheet]")).not.toBeNull(); });
    expect(container.querySelector(".ps-found")).toBeNull();
  });

  it("story cards get an X-ray card only when an image exists", () => {
    const m = model();
    expect(storyCards(m).some((c) => c.kind === "xray")).toBe(false);
    expect(storyCards(m, true).some((c) => c.kind === "xray")).toBe(true);
  });
});
