// Show patient's one "More" menu: everything that is not the patient's path lives here (audit item 1):
// the Look, the doctor's chart, which way round, tooth colour, dark screen, How to brush, Make default.
// Shared by the portal and the phone bundle; each passes only the controls it has. A lazy chunk.
import { Brush, Moon, MoreHorizontal, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";

import type { SwitcherOption } from "./blocks.js";
import type { Orientation } from "./model.js";
import { SHADE_TRACK, shadeSwatch, type Shade } from "./painter.js";

interface Choice { value: string; label: string }

export interface MoreMenuProps {
  /** The Look: Your visit, Map + list. The chart is not one of them. */
  looks: readonly SwitcherOption[];
  look: string;
  onLook: (id: string) => void;
  /** The doctor's chart (portal only): the chart view, its look and dentition. */
  chart?: {
    active: boolean; onActive: (on: boolean) => void;
    looks: readonly Choice[]; look: string; onLook: (v: string) => void;
    dentitions: readonly Choice[]; dentition: string; onDentition: (v: string) => void;
  } | undefined;
  /** "Only today": highlights today's teeth. */
  onlyToday?: boolean | undefined;
  onOnlyToday?: ((on: boolean) => void) | undefined;
  orientation: Orientation;
  onOrientation: (o: Orientation) => void;
  shade: Shade;
  onShade: (s: Shade) => void;
  shadeDirty?: boolean | undefined;
  onSaveShade?: (() => void) | undefined;
  savingShade?: boolean | undefined;
  dark: boolean;
  onDark: (dark: boolean) => void;
  onBrush: () => void;
  /** Offered while the look differs from the saved one. */
  onMakeDefault?: (() => void) | undefined;
  makingDefault?: boolean | undefined;
}

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return <section className="pm-more-group" aria-label={title}><h3 className="pm-more-h">{title}</h3>{children}</section>;
}

function Seg({ label, choices, value, onChange }: { label: string; choices: readonly Choice[]; value: string; onChange: (v: string) => void }): ReactElement {
  return (
    <div className="ps-seg" role="group" aria-label={label}>
      {choices.map((c) => <button key={c.value} type="button" aria-pressed={value === c.value} onClick={() => { onChange(c.value); }}>{c.label}</button>)}
    </div>
  );
}

export function MoreMenu(p: MoreMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (e.target instanceof Node && ref.current?.contains(e.target) !== true) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const chart = p.chart;
  const inChart = chart?.active === true;
  const lookRow = (o: SwitcherOption) => {
    const on = !inChart && o.id === p.look;
    return (
      <li key={o.id} role="none">
        <button type="button" className="pm-more-row" role="menuitemradio" aria-checked={on} disabled={o.disabled !== undefined}
          onClick={() => { chart?.onActive(false); p.onLook(o.id); setOpen(false); }}>
          <span>{o.label}{o.note === undefined ? null : <span className="ps-default">{o.note}</span>}</span>
          {o.disabled !== undefined ? <span className="ps-soon">{o.disabled}</span> : on ? <span className="ps-check" aria-hidden="true">✓</span> : null}
        </button>
      </li>
    );
  };
  return (
    <div className="pm-more" ref={ref}>
      <button ref={btn} type="button" className="pm-chip pm-morechip" aria-haspopup="true" aria-expanded={open} aria-controls={`${id}-panel`} aria-label="More" onClick={() => { setOpen(!open); }}>
        <MoreHorizontal aria-hidden="true" />
        <span className="pm-more-label">More</span>
      </button>
      {open ? (
        <div id={`${id}-panel`} className="pm-more-panel" role="group" aria-label="More options">
          <Group title="Look">
            <ul className="pm-more-list" role="menu" aria-label="Look">{p.looks.map(lookRow)}</ul>
          </Group>
          {chart === undefined && p.onOnlyToday === undefined ? null : (
            <Group title="Doctor's chart">
              {chart === undefined ? null : (
                <button type="button" className="pm-more-row" aria-pressed={chart.active} onClick={() => { chart.onActive(!chart.active); }}>
                  <span>Show the chart</span>{chart.active ? <span className="ps-check" aria-hidden="true">✓</span> : null}
                </button>
              )}
              {chart !== undefined && chart.active ? (
                <>
                  <Seg label="Chart look" choices={chart.looks} value={chart.look} onChange={chart.onLook} />
                  <Seg label="Dentition" choices={chart.dentitions} value={chart.dentition} onChange={chart.onDentition} />
                </>
              ) : null}
              {p.onOnlyToday === undefined ? null : (
                <button type="button" className="pm-more-row" aria-pressed={p.onlyToday === true} onClick={() => { p.onOnlyToday?.(p.onlyToday !== true); }}>
                  <span>Only today</span>{p.onlyToday === true ? <span className="ps-check" aria-hidden="true">✓</span> : null}
                </button>
              )}
            </Group>
          )}
          <Group title="Picture">
            <Seg label="Which way round" choices={[{ value: "mirror", label: "As in your mirror" }, { value: "photo", label: "As in a photo" }]} value={p.orientation} onChange={(v) => { p.onOrientation(v === "photo" ? "photo" : "mirror"); }} />
            <div className="ps-shades" role="group" aria-label="Tooth colour">
              <span className="ps-shade-end">Lighter</span>
              <input
                type="range" className="ps-shade" min={0} max={100} step={1} value={p.shade} aria-label="Tooth colour"
                ref={(el) => { el?.style.setProperty("--ps-track", SHADE_TRACK); el?.style.setProperty("--ps-thumb", shadeSwatch(p.shade)); }}
                onChange={(e) => { p.onShade(e.currentTarget.valueAsNumber); }}
              />
              <span className="ps-shade-end">Deeper</span>
              {p.shadeDirty === true && p.onSaveShade !== undefined ? (
                <button type="button" className="ps-save-shade" disabled={p.savingShade === true} onClick={p.onSaveShade}>Save colour</button>
              ) : null}
            </div>
          </Group>
          <Group title="Screen">
            <button type="button" className="pm-more-row" aria-pressed={p.dark} onClick={() => { p.onDark(!p.dark); }}>
              <span>Dark screen</span>{p.dark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </button>
            <button type="button" className="pm-more-row" onClick={() => { setOpen(false); p.onBrush(); }}>
              <span>How to brush</span><Brush aria-hidden="true" />
            </button>
            {p.onMakeDefault === undefined ? null : (
              <button type="button" className="pm-more-row" disabled={p.makingDefault === true} onClick={p.onMakeDefault}>
                <span>Make this look the default</span>
              </button>
            )}
          </Group>
        </div>
      ) : null}
    </div>
  );
}
