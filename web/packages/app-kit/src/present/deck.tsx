// The pinned deck (present-studio-design §10, slice 2e): the options the doctor pinned, one at a time (swipe or arrow keys),
// two side by side, and "What we discussed" with "Patient prefers" and Save. The pen draws over the picture in memory only:
// it is never saved or sent. Loaded on demand (`@aarogyam/app-kit/present/deck`) so the Present route stays within its budget.
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";

import { OPTION_ROWS } from "./options.js";
import { scenarioOf, usePins, type Pinned } from "./pins.js";

// a discussed braces or aligners item has no situation card: its steps show under the saved line
const CaseFor = lazy(() => import("./case.js").then((m) => ({ default: m.CaseForOption })));
const ORTHO_KEYS = ["braces", "orthodontic_fixed", "aligners"];

/** One scenario to save: the options discussed for a situation on a tooth. */
export interface DiscussionDraft {
  tooth: number;
  situation: string;
  options: { key: string; preferred: boolean }[];
  /** The doctor's tick to send this row to the patient; off unless set. */
  send?: boolean;
}

/** A scenario already saved for this visit. */
export interface SavedDiscussion {
  tooth?: number | null;
  situation: string;
  options: { key: string; preferred?: boolean }[];
}

type Mode = "deck" | "compare" | "discussed";
const MODES: readonly { id: Mode; label: string }[] = [
  { id: "deck", label: "Deck" },
  { id: "compare", label: "Compare" },
  { id: "discussed", label: "What we discussed" },
];
/** Pixels of sideways drag that count as a swipe. */
const SWIPE_PX = 50;

/** Groups pins into scenarios, in pin order. */
export function draftsOf(pins: readonly Pinned[], prefers: Readonly<Record<string, string>>): DiscussionDraft[] {
  const drafts = new Map<string, DiscussionDraft>();
  for (const p of pins) {
    const id = scenarioOf(p);
    const draft = drafts.get(id) ?? { tooth: p.tooth, situation: p.situation, options: [] };
    draft.options.push({ key: p.option.key, preferred: prefers[id] === p.option.key });
    drafts.set(id, draft);
  }
  return [...drafts.values()];
}

function Facts({ pin }: { pin: Pinned }): ReactElement {
  return (
    <article className="pd-card" data-option={pin.option.key}>
      <small>{`${pin.title} · tooth ${String(pin.tooth)}`}</small>
      <h3>{pin.option.label}</h3>
      <dl className="ps-opt-facts">
        {OPTION_ROWS.map((r) => <div key={r.id} data-row={r.id}><dt>{r.label}</dt><dd>{r.cell(pin.option)}</dd></div>)}
      </dl>
    </article>
  );
}

function Pen({ on }: { on: boolean }): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | undefined>(undefined);
  const at = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    const el = canvas.current;
    const from = last.current;
    if (el === null || from === undefined) return;
    const ctx = typeof el.getContext === "function" ? el.getContext("2d") : null;
    const to = at(event);
    if (ctx !== null) {
      ctx.strokeStyle = "#e11d48";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    last.current = to;
  };
  return (
    <canvas
      ref={canvas}
      className="pd-pen"
      data-on={on}
      aria-hidden="true"
      onPointerDown={(event) => {
        const el = canvas.current;
        if (!on || el === null) return;
        // the canvas matches its box; resizing clears it, so only when the box changed
        const box = el.getBoundingClientRect();
        if (el.width !== Math.round(box.width) || el.height !== Math.round(box.height)) {
          el.width = Math.round(box.width);
          el.height = Math.round(box.height);
        }
        if (typeof el.setPointerCapture === "function") el.setPointerCapture(event.pointerId);
        last.current = at(event);
      }}
      onPointerMove={draw}
      onPointerUp={() => { last.current = undefined; }}
      onPointerCancel={() => { last.current = undefined; }}
    />
  );
}

export interface DeckProps {
  onClose: () => void;
  /** Saves each scenario; the portal calls the API. */
  onSave: (drafts: DiscussionDraft[]) => void;
  saving?: boolean;
  /** What was already saved for this visit. */
  saved?: readonly SavedDiscussion[];
  /** Words for an option key, for the saved list. */
  labelOf?: (key: string) => string;
}

/** The deck, the side-by-side compare and "What we discussed". Needs a `PinsProvider` above it. */
export function PinnedDeck({ onClose, onSave, saving = false, saved = [], labelOf = (key) => key }: DeckProps): ReactElement | null {
  const pins = usePins();
  const [mode, setMode] = useState<Mode>("deck");
  const [index, setIndex] = useState(0);
  const [pair, setPair] = useState<readonly string[]>([]);
  const [pen, setPen] = useState(false);
  const [sends, setSends] = useState<Readonly<Record<string, boolean>>>({});
  const down = useRef<number | undefined>(undefined);
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => { shell.current?.focus(); }, []);
  if (pins === undefined) return null;
  const list = pins.pins;
  const at = Math.min(index, Math.max(list.length - 1, 0));
  const go = (step: number) => { if (list.length > 0) setIndex((at + step + list.length) % list.length); };
  const chosen = (pair.length === 2 ? pair : list.slice(0, 2).map((p) => p.id))
    .map((id) => list.find((p) => p.id === id))
    .filter((p): p is Pinned => p !== undefined);
  const togglePair = (id: string) => {
    const now = pair.length === 2 ? pair : list.slice(0, 2).map((p) => p.id);
    setPair(now.includes(id) ? now.filter((x) => x !== id) : [...now, id].slice(-2));
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    else if (mode === "deck" && event.key === "ArrowRight") go(1);
    else if (mode === "deck" && event.key === "ArrowLeft") go(-1);
  };
  const drafts = draftsOf(list, pins.prefers).map((d) => (sends[scenarioOf(d)] === true ? { ...d, send: true } : d));
  return (
    <div ref={shell} className="pd-shell" role="dialog" aria-modal="true" aria-label="Pinned options" tabIndex={-1} onKeyDown={onKey}>
      <header className="pd-bar">
        <div className="pm-tabs" role="tablist" aria-label="Pinned">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="tab" className="pm-tab" aria-selected={mode === m.id} onClick={() => { setMode(m.id); }}>{m.label}</button>
          ))}
        </div>
        <button type="button" className="pm-chip" aria-pressed={pen} onClick={() => { setPen(!pen); }}>Pen</button>
        <button type="button" className="pm-chip" onClick={onClose}>Close</button>
      </header>
      <div className="pd-body">
        {mode === "discussed" ? (
          <section className="pd-discussed" aria-label="What we discussed">
            {drafts.length === 0 && saved.length === 0 ? <p className="ps-muted">Pin an option to keep it here.</p> : null}
            {drafts.map((d) => {
              const id = scenarioOf(d);
              return (
                <fieldset key={id} className="pd-scenario" data-scenario={id}>
                  <legend>{`Tooth ${String(d.tooth)} · ${list.find((p) => scenarioOf(p) === id)?.title ?? d.situation}`}</legend>
                  <ul>{d.options.map((o) => <li key={o.key}>{labelOf(o.key)}</li>)}</ul>
                  <label className="pd-send">
                    <input type="checkbox" checked={sends[id] === true} onChange={(event) => { setSends({ ...sends, [id]: event.target.checked }); }} />
                    {" Send to the patient"}
                  </label>
                  <div className="ps-seg" role="group" aria-label={`Patient prefers, tooth ${String(d.tooth)}`}>
                    <button type="button" aria-pressed={pins.prefers[id] === undefined} onClick={() => { pins.setPrefers(id, undefined); }}>No choice yet</button>
                    {d.options.map((o) => (
                      <button key={o.key} type="button" aria-pressed={o.preferred} onClick={() => { pins.setPrefers(id, o.key); }}>{`Patient prefers ${labelOf(o.key)}`}</button>
                    ))}
                  </div>
                </fieldset>
              );
            })}
            {drafts.length > 0 ? (
              <button type="button" className="pm-chip pd-save" disabled={saving} onClick={() => { onSave(drafts); }}>Save</button>
            ) : null}
            {saved.length > 0 ? (
              <div className="pd-saved" role="region" aria-label="Saved for this visit">
                <h4>Saved for this visit</h4>
                <ul>
                  {saved.map((s) => (
                    <li key={`${s.situation}:${String(s.tooth ?? 0)}`}>
                      {`${s.tooth == null ? "" : `Tooth ${String(s.tooth)}: `}${s.options.map((o) => `${labelOf(o.key)}${o.preferred === true ? " (patient prefers)" : ""}`).join(", ")}`}
                      {s.options.filter((o) => ORTHO_KEYS.includes(o.key)).map((o) => <Suspense key={o.key} fallback={null}><CaseFor optionKey={o.key} situationKey={s.situation} /></Suspense>)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : list.length === 0 ? (
          <p className="ps-muted">Pin an option to keep it here.</p>
        ) : mode === "deck" ? (
          <section
            className="pd-deck"
            aria-label="Pinned deck"
            onPointerDown={(event) => { down.current = event.clientX; }}
            onPointerUp={(event) => {
              const from = down.current;
              down.current = undefined;
              if (pen || from === undefined) return;
              if (event.clientX - from <= -SWIPE_PX) go(1);
              else if (event.clientX - from >= SWIPE_PX) go(-1);
            }}
          >
            {list[at] === undefined ? null : <Facts pin={list[at]} />}
            <footer className="pd-nav">
              <button type="button" className="pm-chip" aria-label="Previous option" onClick={() => { go(-1); }}>Back</button>
              <span role="status">{`${String(at + 1)} of ${String(list.length)}`}</span>
              <button type="button" className="pm-chip" aria-label="Next option" onClick={() => { go(1); }}>Next</button>
            </footer>
          </section>
        ) : (
          <section className="pd-compare" aria-label="Side by side">
            <div className="ps-seg" role="group" aria-label="Choose two">
              {list.map((p) => (
                <button key={p.id} type="button" aria-pressed={chosen.some((c) => c.id === p.id)} onClick={() => { togglePair(p.id); }}>{`${p.option.label} · ${String(p.tooth)}`}</button>
              ))}
            </div>
            {chosen.length < 2 ? <p className="ps-muted">Pin a second option to compare.</p> : (
              <div className="pd-sides">{chosen.map((p) => <Facts key={p.id} pin={p} />)}</div>
            )}
          </section>
        )}
        <Pen on={pen} />
      </div>
    </div>
  );
}
