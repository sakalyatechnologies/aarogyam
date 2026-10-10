/**
 * Local primitives for the new Patient 360. They carry no clinic concept, so they can move to @sakalya/ui
 * (the shared kit being built by F1: Bento card, Pills, ribbon, pinned action bar) once it lands. Until then they live here.
 * Move later: Bento, Pills, PillTabs, Fold, Chip.
 */
import { Plus } from "lucide-react";
import { useId, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";

import "./p360.css";

/** A rounded card with a title and a one-line hint. */
export function Bento({ title, sub, action, children, label }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; label?: string }) {
  const id = useId();
  return (
    <section className="p360-bento" aria-labelledby={title === undefined ? undefined : id} aria-label={title === undefined ? label : undefined}>
      {title === undefined && action === undefined ? null : (
        <header>
          <div>
            {title === undefined ? null : <h3 id={id}>{title}</h3>}
            {sub === undefined ? null : <p className="p360-sub">{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export interface PillOption<V extends string> {
  value: V;
  label: string;
  /** A small count after the label. */
  count?: number;
}

function move<V extends string>(options: readonly PillOption<V>[], value: V, key: string): V | undefined {
  const index = options.findIndex((option) => option.value === value);
  if (key === "ArrowRight" || key === "ArrowDown") return options[(index + 1) % options.length]?.value;
  if (key === "ArrowLeft" || key === "ArrowUp") return options[(index - 1 + options.length) % options.length]?.value;
  if (key === "Home") return options[0]?.value;
  if (key === "End") return options[options.length - 1]?.value;
  return undefined;
}

/** A single choice shown as pills: a radio group, so arrow keys move and select. */
export function Pills<V extends string>({ label, options, value, onChange, size = "md" }: { label: string; options: readonly PillOption<V>[]; value: V; onChange: (next: V) => void; size?: "sm" | "md" }) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = move(options, value, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
    requestAnimationFrame(() => {
      group.current?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
    });
  };
  return (
    <div ref={group} className={`p360-pills ${size}`} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-value={option.value}
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Pill tabs. Every panel stays mounted (the inactive ones are hidden), so a draft being typed in one tab is never lost
 * by looking at another.
 */
export function PillTabs<V extends string>({ label, options, value, onChange, panels }: { label: string; options: readonly PillOption<V>[]; value: V; onChange: (next: V) => void; panels: Readonly<Record<V, ReactNode>> }) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = move(options, value, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
    requestAnimationFrame(() => {
      list.current?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
    });
  };
  return (
    <>
      <div ref={list} className="p360-pills" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`${base}-tab-${option.value}`}
            data-value={option.value}
            aria-selected={value === option.value}
            aria-controls={`${base}-panel-${option.value}`}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {options.map((option) => (
        <div
          key={option.value}
          role="tabpanel"
          className="p360-panel"
          id={`${base}-panel-${option.value}`}
          aria-labelledby={`${base}-tab-${option.value}`}
          hidden={value !== option.value}
        >
          {panels[option.value]}
        </div>
      ))}
    </>
  );
}

/** A collapsible card. */
export function Fold({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="p360-fold" open={open}>
      <summary>
        {title}
        <Plus aria-hidden="true" />
      </summary>
      <div className="p360-fold-body">{children}</div>
    </details>
  );
}

/** A toggle chip. */
export function Chip({ pressed, onClick, children, disabled }: { pressed?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="p360-chip" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** A pill-shaped button (primary or ghost) in the portal's button colours. */
export function PillButton({ variant = "primary", icon, children, className = "", type = "button", ...rest }: ComponentProps<"button"> & { variant?: "primary" | "ghost"; icon?: ReactNode }) {
  return (
    <button type={type} className={`mk-btn ${variant === "primary" ? "mk-btn-primary" : "mk-btn-ghost"} p360-pill-btn ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}
