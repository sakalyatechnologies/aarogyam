import { useNewLook } from "../../lib/new-look.js";
import { TodayPage } from "./today-page.js";
import { TodayV2 } from "./v2/today-v2.js";

/** `/today`: the redesigned, layout-driven Today when the New look is on, the existing page otherwise. */
export function TodayRoute() {
  const [newLook] = useNewLook();
  return newLook ? <TodayV2 /> : <TodayPage />;
}
