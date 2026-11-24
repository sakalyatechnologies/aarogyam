// Show patient's X-rays on the phone: the X-rays tab and the Own X-ray style, drawn from the pictures native
// fetched (signed links) with the doctor's pins; a pin change goes back as `save_pins` for native to PUT. Lazy.
import { useState, type ReactElement } from "react";

import { XrayStyle, XrayView, type PresentModel } from "@aarogyam/app-kit/present";
import { PinnableXray, type XrayPin } from "@aarogyam/app-kit/present/xray-pins";

import type { XrayInput } from "./options.js";

export interface XrayPins {
  /** The pins now on one X-ray (edited here, else the ones native sent). */
  of: (id: string) => readonly XrayPin[];
  /** Set the whole set; undefined when the member may not edit pins. */
  set: ((id: string, pins: readonly XrayPin[]) => void) | undefined;
}

const words = (x: XrayInput): string => {
  const day = x.taken_at === undefined ? undefined : new Date(x.taken_at);
  const when = day === undefined || Number.isNaN(day.getTime()) ? "" : ` from ${day.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
  return `${x.kind === undefined || x.kind === "" ? "X-ray" : x.kind}${when}`;
};

function Picker({ xrays, id, onPick }: { xrays: readonly XrayInput[]; id: string; onPick: (id: string) => void }): ReactElement | null {
  if (xrays.length < 2) return null;
  return (
    <div className="ps-seg" role="group" aria-label="Choose an image">
      {xrays.map((x) => <button key={x.id} type="button" aria-pressed={x.id === id} onClick={() => { onPick(x.id); }}>{words(x)}</button>)}
    </div>
  );
}

function Pinnable({ xray, pins }: { xray: XrayInput; pins: XrayPins }): ReactElement {
  const change = pins.set;
  return (
    <PinnableXray
      key={xray.id}
      src={xray.url}
      alt={words(xray)}
      caption={words(xray)}
      pins={pins.of(xray.id)}
      onChange={change === undefined ? undefined : (next) => { change(xray.id, next); }}
    />
  );
}

/** The X-rays tab. */
export function XraysTab({ xrays, pins }: { xrays: readonly XrayInput[]; pins: XrayPins }): ReactElement {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const xray = xrays.find((x) => x.id === chosen) ?? xrays[0];
  if (xray === undefined) return <p className="ps-muted">No X-ray or photo yet.</p>;
  return (
    <div className="pm-xrays">
      <Picker xrays={xrays} id={xray.id} onPick={setChosen} />
      <Pinnable xray={xray} pins={pins} />
    </div>
  );
}

/** The Own X-ray style: the picture with pins beside this visit's recorded findings. */
export function OwnXraySlot({ model, xrays, pins }: { model: PresentModel; xrays: readonly XrayInput[]; pins: XrayPins }): ReactElement {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const xray = xrays.find((x) => x.id === chosen) ?? xrays[0];
  if (xray === undefined) return <p className="ps-muted">No X-ray yet.</p>;
  return <XrayStyle model={model} stage={<><Picker xrays={xrays} id={xray.id} onPick={setChosen} /><Pinnable xray={xray} pins={pins} /></>} />;
}

/** The story card's picture: the first X-ray, plain, with its edge labels. */
export function StoryXrayPicture({ xray }: { xray: XrayInput }): ReactElement {
  return <XrayView src={xray.url} alt={words(xray)} caption={words(xray)} />;
}
