// Warms Show patient while the doctor charts (§1.12 speed): the route's chunk and every art chunk the
// overview will draw (the same top-view chunks Open wide draws), and the painted style with its front
// atlas and Open wide (present-studio-design §13), so Present opens on a painted map and Open wide is
// one instant tap away. Never the 3D or brushing chunks.
import type { MouthSnapshot } from "@aarogyam/api-client";
import { preloadArt } from "@aarogyam/app-kit/mouth-view";
import { loadPaintedStyle } from "@aarogyam/app-kit/present";

export function prefetchPresent(snapshot: MouthSnapshot): void {
  preloadArt(snapshot);
  void loadPaintedStyle();
  void import("./present-page.js");
}
