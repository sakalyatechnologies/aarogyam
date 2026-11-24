import { useRef } from "react";

/** How long a press on a tooth lasts before it starts dictating a note. */
export const LONG_PRESS_MS = 500;

/**
 * A long press on a tooth, the same in every chart look: press for {@link LONG_PRESS_MS} (touch or mouse) and
 * `onLongPress` runs once. The release that ends it also fires a click, which `consumed()` swallows, so it isn't
 * read as a second tap.
 */
export function useLongPress(onLongPress: ((tooth: number) => void) | undefined) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | undefined; fired: boolean }>({ timer: undefined, fired: false });
  const end = () => {
    clearTimeout(press.current.timer);
    press.current.timer = undefined;
  };
  return {
    start: (tooth: number) => {
      if (onLongPress === undefined) return;
      end();
      press.current.fired = false;
      press.current.timer = setTimeout(() => {
        press.current.fired = true;
        press.current.timer = undefined;
        onLongPress(tooth);
      }, LONG_PRESS_MS);
    },
    end,
    /** Whether the press just fired: then the browser's long-press menu and the release's click are ignored. */
    fired: () => press.current.fired,
    /** True once after a fired press, for the click its release makes. */
    consumed: () => {
      if (!press.current.fired) return false;
      press.current.fired = false;
      return true;
    },
  };
}
