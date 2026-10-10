import { createContext, useContext } from "react";

/** What every widget on the board shares: the day being shown and what clicking may do. */
export interface BoardState {
  /** The chosen day (`YYYY-MM-DD`), or `undefined` for the current day, which refreshes by itself. */
  date: string | undefined;
  /** Picks a day; `undefined` goes back to the current day. */
  setDate: (date: string | undefined) => void;
  /** The current clinic day, once known (the API says it; the fake clock differs from the browser's). */
  todayIso: string | undefined;
  /** The Studio's live preview: the same widgets, with nothing clickable. */
  preview: boolean;
}

export const BoardContext = createContext<BoardState>({ date: undefined, setDate: () => undefined, todayIso: undefined, preview: false });

export function useBoard(): BoardState {
  return useContext(BoardContext);
}
