// Pinned options (present-studio-design §10, slice 2e): the doctor pins any option card to keep it for the deck,
// the side-by-side compare and "What we discussed". Pins and "Patient prefers" live in memory only, in this showing;
// nothing is saved until the doctor taps Save in "What we discussed", and nothing goes in a URL.
import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { PresentOption, PresentSituation } from "@aarogyam/api-client";

/** One pinned option with the situation it answers. */
export interface Pinned {
  /** `situation key:tooth:option key`. */
  id: string;
  situation: string;
  tooth: number;
  title: string;
  option: PresentOption;
}

/** The scenario a pinned option belongs to: one situation on one tooth. */
export const scenarioOf = (p: Pick<Pinned, "situation" | "tooth">): string => `${p.situation}:${String(p.tooth)}`;

export interface PinsApi {
  pins: readonly Pinned[];
  isPinned: (id: string) => boolean;
  toggle: (pin: Pinned) => void;
  /** Option key the patient prefers, by scenario. */
  prefers: Readonly<Record<string, string>>;
  setPrefers: (scenario: string, optionKey: string | undefined) => void;
}

const PinsContext = createContext<PinsApi | undefined>(undefined);

/** Holds this showing's pins. Without it no Pin button shows. */
export function PinsProvider({ children }: { children: ReactNode }): ReactElement {
  const [pins, setPins] = useState<readonly Pinned[]>([]);
  const [prefers, setPreferred] = useState<Readonly<Record<string, string>>>({});
  const toggle = useCallback((pin: Pinned) => {
    setPins((now) => (now.some((p) => p.id === pin.id) ? now.filter((p) => p.id !== pin.id) : [...now, pin]));
    // an unpinned option can't stay preferred
    setPreferred((now) => (now[scenarioOf(pin)] === pin.option.key ? Object.fromEntries(Object.entries(now).filter(([k]) => k !== scenarioOf(pin))) : now));
  }, []);
  const setPrefers = useCallback((scenario: string, optionKey: string | undefined) => {
    setPreferred((now) => {
      const rest = Object.fromEntries(Object.entries(now).filter(([k]) => k !== scenario));
      return optionKey === undefined ? rest : { ...rest, [scenario]: optionKey };
    });
  }, []);
  const api = useMemo<PinsApi>(() => ({ pins, isPinned: (id) => pins.some((p) => p.id === id), toggle, prefers, setPrefers }), [pins, toggle, prefers, setPrefers]);
  return <PinsContext.Provider value={api}>{children}</PinsContext.Provider>;
}

export const usePins = (): PinsApi | undefined => useContext(PinsContext);

export const pinOf = (situation: PresentSituation, option: PresentOption): Pinned => ({
  id: `${situation.key}:${String(situation.tooth)}:${option.key}`,
  situation: situation.key,
  tooth: situation.tooth,
  title: situation.title,
  option,
});

/** Pin or unpin one option. */
export function PinButton({ situation, option }: { situation: PresentSituation; option: PresentOption }): ReactElement | null {
  const pins = usePins();
  if (pins === undefined) return null;
  const pin = pinOf(situation, option);
  const on = pins.isPinned(pin.id);
  return (
    <button type="button" className="ps-pin" aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"} ${option.label}`} onClick={() => { pins.toggle(pin); }}>
      {on ? "Pinned" : "Pin"}
    </button>
  );
}
