// Shared Show patient blocks (present-studio-design §5.3, §11.1): the badges, the "What we found" list,
// the provenance footer, the text fallback and the style switcher. Every style uses these, so the
// provenance rules live here once. Words come only from the PresentModel.
import { Component, useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { dayLabel } from "../mouth-view/model.js";
import { dottedTeeth, type FactItem, type FactKind, type PresentModel } from "./model.js";

/** Solid "Recorded 20 Oct" on one recorded item; a bare "Recorded" where the snapshot has no date. */
export function RecordBadge({ on }: { on?: string | undefined }): ReactElement {
  return <span className="ps-badge ps-badge-rec">{on === undefined ? "Recorded" : `Recorded ${dayLabel(on, false)}`}</span>;
}

/** Dashed: "Illustration · general guidance", "Example, not your tooth" or "Painting based on your record". */
export function IllustrationBadge({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <span className={`ps-badge ps-badge-ill${className === undefined ? "" : ` ${className}`}`}>{children}</span>;
}

export type DotTone = "problem" | "plan" | "note";
const TONE: Readonly<Record<FactKind, DotTone>> = { problem: "problem", in_progress: "plan", plan: "plan", recommended: "plan", work: "note", detail: "note" };
const RANK: Readonly<Record<DotTone, number>> = { problem: 0, plan: 1, note: 2 };
/** A tooth's dot colour: its most pressing recorded item. */
export function toneOf(facts: readonly FactItem[]): DotTone {
  return facts.map((f) => TONE[f.kind]).sort((a, b) => RANK[a] - RANK[b])[0] ?? "note";
}

/** The numbered dots of a picture: one per tooth with recorded facts, in list order. */
export function dotsOf(model: PresentModel): { n: number; tooth: number; tone: DotTone; label: string }[] {
  return dottedTeeth(model).map((tooth, i) => {
    const facts = model.facts.filter((f) => f.tooth === tooth);
    const where = facts[0]?.where ?? `Tooth ${String(tooth)}`;
    return { n: i + 1, tooth, tone: toneOf(facts), label: `${String(i + 1)}: ${where}, ${String(tooth)}: ${facts.map((f) => f.words).join("; ")}` };
  });
}

/**
 * "What we found": the model's facts only, grouped by tooth and numbered like the dots. With `onBitingSide`,
 * "On the biting side" links to Open wide (the front picture can't show that decay).
 */
export function FactList({ model, onOpen, numbered = true, onBitingSide }: {
  model: PresentModel; onOpen?: ((tooth: number) => void) | undefined; numbered?: boolean; onBitingSide?: (() => void) | undefined;
}): ReactElement {
  const dots = dotsOf(model);
  return (
    <section className="ps-found" aria-label="What we found">
      <h3 className="ps-h">What we found</h3>
      {dots.length === 0 ? <p className="ps-muted">Nothing is recorded for this visit yet.</p> : (
        <ol className="ps-found-list">
          {dots.map((d) => {
            const facts = model.facts.filter((f) => f.tooth === d.tooth);
            const body = (
              <>
                {numbered ? <span className="ps-n" data-tone={d.tone} aria-hidden="true">{d.n}</span> : null}
                <span className="ps-found-text">
                  <span className="ps-where">{facts[0]?.where}<span className="ps-fdi">{` · ${String(d.tooth)}`}</span></span>
                  {facts.map((f) => (
                    <span key={f.id} className="ps-fact" data-kind={f.kind} data-fact={f.id}>
                      <b>{f.words}</b>
                      {f.biting_side !== true ? null : onBitingSide === undefined ? <span className="ps-note">On the biting side</span> : (
                        <button type="button" className="ps-note ps-note-link" onClick={onBitingSide}>On the biting side: open wide</button>
                      )}
                      <RecordBadge on={f.recorded_on} />
                    </span>
                  ))}
                </span>
              </>
            );
            return (
              <li key={d.tooth}>
                {onOpen === undefined ? <div className="ps-found-item">{body}</div> : (
                  // the whole card opens the tooth; a link inside it (Open wide) sits above the card's button
                  <div className="ps-found-item ps-found-card">
                    <button type="button" className="ps-found-open" aria-label={d.label} onClick={() => { onOpen(d.tooth); }} />
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {model.facts.some((f) => f.tooth === undefined) ? (
        <ul className="ps-found-list">{model.facts.filter((f) => f.tooth === undefined).map((f) => <li key={f.id} className="ps-fact"><b>{f.words}</b><RecordBadge on={f.recorded_on} /></li>)}</ul>
      ) : null}
    </section>
  );
}

/** What in the current picture is recorded and what is illustration (§11.1). */
export function ProvenanceFooter({ recorded, illustration }: { recorded: readonly string[]; illustration: readonly string[] }): ReactElement {
  return (
    <footer className="ps-prov" aria-label="Where this comes from">
      {recorded.length === 0 ? null : <p><RecordBadge /> {recorded.join(" ")}</p>}
      {illustration.length === 0 ? null : <p><IllustrationBadge>Illustration</IllustrationBadge> {illustration.join(" ")}</p>}
    </footer>
  );
}

/** The same facts as plain text, shown when a style's chunk fails or times out (§13). Retry is one tap. */
export function TextFallback({ model, onRetry, onOpen }: { model: PresentModel; onRetry: () => void; onOpen?: ((tooth: number) => void) | undefined }): ReactElement {
  return (
    <div className="ps-fallback" data-present-fallback="">
      <p className="ps-fallback-note" role="status">
        The picture didn't load, so here is the same record as text.
        <button type="button" className="ps-retry" onClick={onRetry}>Try the picture again</button>
      </p>
      <FactList model={model} onOpen={onOpen} numbered={false} />
    </div>
  );
}

/**
 * A lazy chunk with an 8 s limit: "loading", then "ready", or "failed" (the caller shows TextFallback).
 * A chunk that arrives after the limit still replaces the fallback.
 */
export function useChunk<T>(load: () => Promise<T>, timeoutMs = 8000): { state: "loading" | "ready" | "failed"; value: T | undefined; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: "ready" | "failed"; value?: T } | undefined>(undefined);
  const start = useEffectEvent(() => load());
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => { if (live) setResult((prev) => (prev?.attempt === attempt ? prev : { attempt, state: "failed" })); }, timeoutMs);
    start().then(
      (value) => { clearTimeout(timer); if (live) setResult({ attempt, state: "ready", value }); },
      () => { clearTimeout(timer); if (live) setResult({ attempt, state: "failed" }); },
    );
    return () => { live = false; clearTimeout(timer); };
  }, [attempt, timeoutMs]);
  const current = result?.attempt === attempt ? result : undefined;
  return { state: current?.state ?? "loading", value: current?.value, retry: () => { setAttempt((n) => n + 1); } };
}

export interface SwitcherOption {
  id: string;
  label: string;
  /** Why it can't be chosen ("Coming soon", "No X-ray for this visit"). */
  disabled?: string | undefined;
  beta?: boolean | undefined;
  /** A short tag on a style that can be chosen ("Default"). */
  note?: string | undefined;
  /** Starts a new group under a line (the doctor's chart looks). */
  separate?: boolean | undefined;
}

/** The style switcher inside Show patient: a button that opens a list; session-only. */
export function StyleSwitcher({ options, value, onChange, label = "Style" }: { options: readonly SwitcherOption[]; value: string; onChange: (id: string) => void; label?: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.id === value);
  const enabled = options.filter((o) => o.disabled === undefined);
  const [active, setActive] = useState(value);
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const away = (e: PointerEvent) => { if (e.target instanceof Node && ref.current?.contains(e.target) !== true) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("pointerdown", away); };
  }, [open]);
  const choose = (o: SwitcherOption) => {
    if (o.disabled !== undefined) return;
    onChange(o.id);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    const i = enabled.findIndex((o) => o.id === active);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = enabled[(i + (e.key === "ArrowDown" ? 1 : enabled.length - 1)) % enabled.length];
      if (next !== undefined) setActive(next.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = enabled[i];
      if (o !== undefined) choose(o);
    }
  };
  return (
    <div className="ps-switch" ref={ref}>
      <button type="button" className="pm-chip ps-switch-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => { setActive(value); setOpen(!open); }}>
        <span className="ps-switch-k">{label}</span>
        <span>{current?.label ?? value}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open ? (
        <ul id={`${id}-list`} ref={listRef} className="ps-switch-list" role="listbox" aria-label={label} tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={onKey}>
          {options.map((o) => (
            <li key={o.id} id={`${id}-${o.id}`} role="option" aria-selected={o.id === value} aria-disabled={o.disabled === undefined ? undefined : true}
              className="ps-switch-opt" data-active={o.id === active ? "" : undefined} data-separate={o.separate === true ? "" : undefined}
              onClick={() => { choose(o); }}>
              <span>{o.label}{o.beta === true ? <span className="ps-beta">Beta</span> : null}{o.note === undefined || o.disabled !== undefined ? null : <span className="ps-default">{o.note}</span>}</span>
              {o.disabled === undefined ? (o.id === value ? <span className="ps-check" aria-hidden="true">✓</span> : null) : <span className="ps-soon">{o.disabled}</span>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A style that throws while drawing shows its fallback (the text) instead of a blank screen. */
export class StyleBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
