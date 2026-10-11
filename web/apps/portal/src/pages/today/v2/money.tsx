import { Eye, EyeOff } from "lucide-react";
import { useSyncExternalStore } from "react";

/** Whether this person has chosen to see money on Today. Off until they ask, and remembered in this browser. */
export const SHOW_MONEY_KEY = "aarogyam.portal.show-money";

const listeners = new Set<() => void>();
let memory = false;

function read(): boolean {
  try {
    return globalThis.localStorage.getItem(SHOW_MONEY_KEY) === "1";
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function write(next: boolean) {
  memory = next;
  try {
    globalThis.localStorage.setItem(SHOW_MONEY_KEY, next ? "1" : "0");
  } catch {
    // Blocked storage: the choice holds until the page is reloaded.
  }
  for (const listener of listeners) listener();
}

/** `[shown, setShown]`: one choice shared by every money widget on the page. */
export function useShowMoney(): [boolean, (next: boolean) => void] {
  const shown = useSyncExternalStore(subscribe, read, () => false);
  return [shown, write];
}

/** The eye that reveals or hides money; the same button, and the same setting, on every money widget. */
export function MoneyEye({ what, className = "tv2-eye" }: { what: string; className?: string }) {
  const [shown, setShown] = useShowMoney();
  return (
    <button
      type="button"
      className={className}
      aria-pressed={shown}
      aria-label={shown ? `Hide ${what}` : `Show ${what}`}
      onClick={() => {
        setShown(!shown);
      }}
    >
      {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
    </button>
  );
}
