// Warms Show patient while the doctor charts (§1.12 speed): the route's chunk and every art chunk the
// overview will draw, so Present opens on a filled arch. Never the 3D or brushing chunks.
import type { MouthSnapshot } from "@aarogyam/api-client";
import { preloadArt } from "@aarogyam/app-kit/mouth-view";

export function prefetchPresent(snapshot: MouthSnapshot): void {
  preloadArt(snapshot);
  void import("./present-page.js");
}
