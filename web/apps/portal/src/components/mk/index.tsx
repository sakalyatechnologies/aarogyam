// Everything here is free of clinic types. // moves to sakalya-web (mock-up styled kpi tile, tag, bars, donut, toggle, drawer)
import { X } from "lucide-react";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

export type MkTone = "up" | "down" | "warn" | "info";
export type TagTone = "wait" | "done" | "next" | "info" | "down" | "neutral";

/** The mock-up's avatar colours, picked by a stable hash so a person keeps their colour. */
const AVATAR_COLOURS = ["#1b734a", "#a86e0f", "#4338ca", "#136650", "#be123c", "#0ea5e9", "#7c3aed"] as const;

export function avatarColour(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length] ?? AVATAR_COLOURS[0];
}

export function initials(name: string): string {
  const words = name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter((word) => word !== "");
  return (words.length > 1 ? `${words[0]?.charAt(0) ?? ""}${words[words.length - 1]?.charAt(0) ?? ""}` : (words[0] ?? "").slice(0, 2)).toUpperCase();
}

export function Tag({ tone = "neutral", children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={`mk-tag ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}

/** Maps the shared library's status tones onto the mock-up's tag colours. */
export function statusTone(tone: "neutral" | "success" | "warning" | "danger" | "info"): TagTone {
  return tone === "success" ? "done" : tone === "warning" ? "wait" : tone === "danger" ? "down" : tone === "info" ? "info" : "neutral";
}

export function MkPill({ tone, children }: { tone?: MkTone | undefined; children: ReactNode }) {
  return <span className={`mk-pill ${tone ?? ""}`}>{children}</span>;
}

export function MkAvatar({ name, size = "pav" }: { name: string; size?: "pav" | "pa" }) {
  return (
    <span aria-hidden="true" className={size === "pa" ? "mk-pa" : "mk-pav"} style={{ background: avatarColour(name) }}>
      {initials(name)}
    </span>
  );
}

export interface MkCardProps {
  title?: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Card with the mock-up's heading, hint line and a right-hand link. */
export function MkCard({ title, hint, action, className = "", children }: MkCardProps) {
  return (
    <section className={`mk-card ${className}`}>
      {title === undefined ? null : (
        <div className="mk-card-h">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {hint === undefined ? null : <p className="mk-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** A stat tile: label, big number, a pill and an optional sparkline. Empty values show an em dash. */
export function Kpi({ label, value, pill, pillTone, warn = false, spark }: { label: string; value: ReactNode; pill?: ReactNode; pillTone?: MkTone; warn?: boolean; spark?: readonly number[] }) {
  return (
    <div className={`mk-kpi ${warn ? "warn" : ""}`}>
      <div className="mk-lbl">{label}</div>
      <div className="mk-row">
        <div className="mk-num">{value}</div>
        {pill === undefined ? null : <MkPill tone={pillTone}>{pill}</MkPill>}
      </div>
      {spark !== undefined && spark.length > 1 ? <Spark values={spark} /> : null}
    </div>
  );
}

export function Spark({ values }: { values: readonly number[] }) {
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const step = 120 / (values.length - 1);
  const d = values.map((value, index) => `${index === 0 ? "M" : "L"}${String(Math.round(index * step))} ${String(Math.round(32 - ((value - min) / range) * 28))}`).join(" ");
  return (
    <svg aria-hidden="true" className="mk-spark" viewBox="0 0 120 36" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--kc)" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface MkBar {
  label: string;
  value: number;
  /** Green bar, as the mock-up shows completed hours. */
  done?: boolean;
  tip: string;
}

/** The mock-up's bar chart: hover or focus a bar for its value. */
export function Bars({ data, summary }: { data: readonly MkBar[]; summary: string }) {
  const max = Math.max(1, ...data.map((bar) => bar.value));
  return (
    <div className="mk-bars" role="list" aria-label={summary}>
      {data.map((bar) => (
        <div key={bar.label} role="listitem" tabIndex={0} aria-label={bar.tip} className={`mk-bar ${bar.done === true ? "done" : ""}`}>
          <span className="mk-tip" aria-hidden="true">
            {bar.tip}
          </span>
          <div className="mk-col" style={{ height: `${String(Math.round((bar.value / max) * 118) + 10)}px` }} />
          <span aria-hidden="true">{bar.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface MkSlice {
  label: string;
  value: number;
}

const DONUT_COLOURS = ["var(--brand)", "#e2ac4a", "var(--sk-info)", "var(--rule)"] as const;
const CIRCUMFERENCE = 2 * Math.PI * 48;

/** The mock-up's donut with its legend: share of total, largest three slices and the rest as Other. */
export function Donut({ data, centre, summary }: { data: readonly MkSlice[]; centre: string; summary: string }) {
  const sorted = [...data].filter((slice) => slice.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, slice) => sum + slice.value, 0);
  const top = sorted.slice(0, 3);
  const restValue = sorted.slice(3).reduce((sum, slice) => sum + slice.value, 0);
  const slices = restValue > 0 ? [...top, { label: "Other", value: restValue }] : top;
  const starts = slices.map((_, index) => slices.slice(0, index).reduce((sum, slice) => sum + (slice.value / total) * CIRCUMFERENCE, 0));
  return (
    <div className="mk-donut">
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${summary}: ${slices.map((s) => `${s.label} ${String(Math.round((s.value / total) * 100))}%`).join(", ")}`}>
        <circle cx="60" cy="60" r="48" fill="none" stroke="var(--bg)" strokeWidth="16" />
        {slices.map((slice, index) => {
          const length = (slice.value / total) * CIRCUMFERENCE;
          return (
            <circle
              key={slice.label}
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke={DONUT_COLOURS[index]}
              strokeWidth="16"
              strokeDasharray={`${String(length)} ${String(CIRCUMFERENCE)}`}
              strokeDashoffset={-(starts[index] ?? 0)}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
            />
          );
        })}
        <text x="60" y="66" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--ink)">
          {centre}
        </text>
      </svg>
      <div className="mk-legend">
        {slices.map((slice, index) => (
          <span key={slice.label}>
            <i style={{ background: DONUT_COLOURS[index] }} />
            {slice.label} · {Math.round((slice.value / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

export function MkMeter({ value, max, low, label }: { value: number; max: number; low?: boolean; label: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className={`mk-meter ${low === true ? "low" : ""}`} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <i style={{ width: `${String(pct)}%` }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="mk-tgl"
      onClick={() => {
        onChange?.(!checked);
      }}
    />
  );
}

/**
 * Row-link pattern: the row's own link stays the keyboard and screen-reader control, and a mouse
 * click anywhere else on the row follows it. Spread the result onto the `<tr>`.
 */
export function rowLink(open: () => void): { className: string; onClick: (event: MouseEvent<HTMLElement>) => void } {
  return {
    className: "mk-rowlink",
    onClick: (event) => {
      if (event.target instanceof Element && event.target.closest("a, button, input, select, textarea, label") !== null) {
        return;
      }
      open();
    },
  };
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <p className="mk-empty">
      <b>{title}</b>
      {children}
    </p>
  );
}

export interface MkDrawerProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}

/** Slide-over from the right: gradient header, scroll body. Traps focus, closes on Escape or the scrim. */
export function MkDrawer({ open, onClose, eyebrow, title, meta, children }: MkDrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab" && ref.current !== null) {
        const items = [...ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
        const first = items[0];
        const last = items[items.length - 1];
        if (first !== undefined && last !== undefined) {
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [open, onClose]);
  return (
    <>
      <div className={`mk-scrim ${open ? "on" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className={`mk-drawer ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open}>
        <div className="mk-drawer-h">
          <button ref={closeRef} type="button" className="mk-x" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" size={15} />
          </button>
          <small>{eyebrow}</small>
          <h2>{title}</h2>
          {meta === undefined ? null : <div>{meta}</div>}
        </div>
        <div className="mk-drawer-b">{open ? children : null}</div>
      </aside>
    </>
  );
}
