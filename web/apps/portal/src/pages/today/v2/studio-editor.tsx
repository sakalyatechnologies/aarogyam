import { ChevronDown, ChevronUp, GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";

import { apiErrorOf, type DashboardCatalogue, type DashboardLayout, type DashboardLayoutView } from "@aarogyam/api-client";
import { Pills, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { Board } from "./board.js";
import {
  SIZE_LABEL,
  ZONES,
  ZONE_LABEL,
  addWidget,
  allowed,
  dropOn,
  inZone,
  isZone,
  moveInZone,
  optsOf,
  removeAt,
  sameLayout,
  setOpt,
  setZone,
  specOf,
  patchItem,
  templateLayout,
  type OptionSpec,
  type ShownItem,
  type WidgetSpec,
  type Zone,
} from "./layout-model.js";
import { useResetLayout, useSaveLayout } from "./queries.js";
import { entryOf, WIDGET_REGISTRY } from "./registry.js";

const toPills = (values: readonly string[], labels: Readonly<Record<string, string>> = {}) => values.map((value) => ({ value, label: labels[value] ?? value.charAt(0).toUpperCase() + value.slice(1) }));

/** The Studio's preview: the live Board at desktop width, scaled down to the room there is, and inert. */
function ScaledPreview({ layout, view }: { layout: DashboardLayout; view: DashboardLayoutView }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const frame = outer.current;
    const content = inner.current;
    if (frame === null || content === null || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const next = Math.min(1, Math.max(0.3, frame.clientWidth / 1100));
      setScale(next);
      setHeight(content.scrollHeight * next);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(frame);
    watch.observe(content);
    return () => {
      watch.disconnect();
    };
  }, []);
  return (
    <div className="tv2-preview" role="group" aria-label="Live preview of Today">
      <div ref={outer} className="tv2-preview-frame" style={height === undefined ? undefined : { height }}>
        <div ref={inner} className="tv2-preview-inner" style={{ transform: `scale(${String(scale)})` }} inert>
          <Board layout={layout} catalogue={view.catalogue} preview />
        </div>
      </div>
    </div>
  );
}

type MetricInfo = DashboardCatalogue["metrics"][number];

function OptionEditor({ spec, option, value, onChange, canSee, metrics }: { spec: WidgetSpec; option: OptionSpec; value: unknown; onChange: (next: unknown) => void; canSee: (requires: string | null | undefined) => boolean; metrics: readonly MetricInfo[] }) {
  const id = useId();
  const label = `${spec.label}: ${option.label}`;
  if (option.kind === "bool") {
    return (
      <label className="tv2-row">
        <input type="checkbox" checked={value === true} onChange={(event) => { onChange(event.currentTarget.checked); }} />
        {option.label}
      </label>
    );
  }
  if (option.kind === "choice") {
    const choices = (option.choices ?? []).filter((c): c is string => typeof c === "string");
    return <Pills label={label} size="sm" options={toPills(choices)} value={typeof value === "string" ? value : String(option.default)} onValueChange={onChange} />;
  }
  if (option.kind === "int_choice" || option.kind === "int_range") {
    const numbers =
      option.kind === "int_choice"
        ? (option.choices ?? []).filter((c): c is number => typeof c === "number")
        : Array.from({ length: (option.max ?? 0) - (option.min ?? 0) + 1 }, (_, index) => (option.min ?? 0) + index);
    return (
      <div className="tv2-row">
        <label htmlFor={id}>{option.label}</label>
        <select id={id} className="tv2-select" value={String(value)} onChange={(event) => { onChange(Number(event.currentTarget.value)); }}>
          {numbers.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </div>
    );
  }
  // metrics: an ordered pick of min..max headline numbers.
  const chosen = Array.isArray(value) ? value.filter((m): m is string => typeof m === "string") : [];
  return (
    <fieldset>
      <legend>
        {option.label} ({option.min}–{option.max})
      </legend>
      <div className="tv2-metrics">
        <MetricChoices metrics={metrics} chosen={chosen} min={option.min ?? 1} max={option.max ?? 6} onChange={onChange} canSee={canSee} />
      </div>
    </fieldset>
  );
}

/** Metric checkboxes: the numbers the member may see (plus any already chosen), between `min` and `max` of them. */
function MetricChoices({ metrics, chosen, min, max, onChange, canSee }: { metrics: readonly MetricInfo[]; chosen: string[]; min: number; max: number; onChange: (next: unknown) => void; canSee: (requires: string | null | undefined) => boolean }) {
  return (
    <>
      {metrics
        .filter((m) => canSee(m.requires) || chosen.includes(m.key))
        .map((m) => {
          const on = chosen.includes(m.key);
          const disabled = (on && chosen.length <= min) || (!on && chosen.length >= max);
          return (
            <label key={m.key} className="tv2-metric">
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => {
                  onChange(on ? chosen.filter((key) => key !== m.key) : [...chosen, m.key]);
                }}
              />
              {m.label}
            </label>
          );
        })}
    </>
  );
}

export interface StudioEditorProps {
  /** The layout being edited, with the catalogue. From `useMyLayout()`, or the clinic's default in setup. */
  view: DashboardLayoutView;
  /** `split` puts the preview beside the controls (Settings); `stacked` puts it below (a drawer). */
  layout?: "split" | "stacked";
  /** Where Save writes: the member's own layout, or the clinic default. Defaults to the member's. */
  scope?: "me" | "clinic";
  /** Called as the draft changes, so a host (the setup Look step) can keep it. */
  onChange?: (layout: DashboardLayout) => void;
  /** Called after a successful save. */
  onSaved?: (view: DashboardLayoutView) => void;
  /** Hides Save and the reset buttons, for a host that saves the draft itself. */
  hideActions?: boolean;
}

/**
 * The Dashboard Studio: pick a template, set density, card style and rail side, add, remove, resize and reorder widgets
 * (drag, or the up and down buttons), set each widget's options, and watch the same Board Today uses redraw as you go.
 * Save writes the member's layout; with `settings.manage` it can also be saved as the clinic's default.
 */
export function StudioEditor({ view, layout: arrangement = "stacked", scope = "me", onChange, onSaved, hideActions = false }: StudioEditorProps) {
  const { can } = useClinic();
  const toast = useToast();
  const [draft, setDraft] = useState<DashboardLayout>(view.layout);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [over, setOver] = useState<number | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const saveMine = useSaveLayout(scope);
  const saveClinic = useSaveLayout("clinic");
  const resetMine = useResetLayout();
  const catalogue = view.catalogue;
  const dirty = !sameLayout(draft, view.layout);

  // A saved change elsewhere (another tab, a refetch) replaces the draft only when nothing is being edited.
  const seen = useRef(view.layout);
  useEffect(() => {
    if (seen.current !== view.layout && !dirty) setDraft(view.layout);
    seen.current = view.layout;
  }, [view.layout, dirty]);

  const change = (next: DashboardLayout) => {
    setDraft(next);
    setProblem(undefined);
    onChange?.(next);
  };
  const canSee = (requires: string | null | undefined) => allowed(requires, can);

  const rows = (zone: Zone): ShownItem[] =>
    inZone(
      draft.items.flatMap((item, index) => {
        const spec = specOf(catalogue, item.key);
        return spec === undefined || !isZone(item.zone) ? [] : [{ item, spec, zone: item.zone, index }];
      }),
      zone,
    );

  const save = (target: "me" | "clinic") => {
    const mutation = target === "clinic" ? saveClinic : saveMine;
    mutation.mutate(draft, {
      onSuccess: (saved) => {
        toast.show({ title: target === "clinic" ? "Saved as the clinic's default" : "Layout saved", tone: "success" });
        onSaved?.(saved);
      },
      onError: (error) => {
        const message = apiErrorOf(error)?.message ?? "Couldn't save that layout. Please try again.";
        setProblem(message);
        toast.show({ title: message, tone: "danger" });
      },
    });
  };

  const present = new Set(draft.items.map((item) => item.key));
  const addable = WIDGET_REGISTRY.flatMap((entry) => {
    const spec = specOf(catalogue, entry.key);
    return spec !== undefined && !present.has(entry.key) && canSee(spec.requires) ? [{ entry, spec }] : [];
  });

  const onDrop = (event: DragEvent, to: number) => {
    event.preventDefault();
    if (dragging !== undefined) change(dropOn(draft, dragging, to, catalogue));
    setDragging(undefined);
    setOver(undefined);
  };

  const controls = (
    <div className="tv2-knobs">
      <fieldset>
        <legend>Template</legend>
        <div className="tv2-templates">
          {catalogue.templates.map((template) => (
            <button
              key={template.key}
              type="button"
              className="tv2-tpl"
              aria-pressed={draft.tpl === template.key}
              onClick={() => { change(template.layout); }}
            >
              <b>{template.label}</b>
              <span>{template.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="tv2-row">
        <Pills label="Density" size="sm" options={toPills(catalogue.densities)} value={draft.density} onValueChange={(density) => { change({ ...draft, density }); }} />
        <Pills label="Card style" size="sm" options={toPills(catalogue.cards)} value={draft.card} onValueChange={(card) => { change({ ...draft, card }); }} />
      </div>
      <div className="tv2-row">
        <Pills label="Rail side" size="sm" options={toPills(catalogue.rail_sides)} value={draft.rail.side} onValueChange={(side) => { change({ ...draft, rail: { ...draft.rail, side } }); }} />
        <Pills label="Rail width" size="sm" options={toPills(catalogue.rail_widths)} value={draft.rail.width} onValueChange={(width) => { change({ ...draft, rail: { ...draft.rail, width } }); }} />
      </div>

      <section aria-labelledby="studio-widgets">
        <h3 id="studio-widgets" className="tv2-field-label">
          Widgets
        </h3>
        <p className="tv2-note">Drag a widget to reorder it, or use the up and down buttons.</p>
        {ZONES.map((zone) => {
          const list = rows(zone);
          if (list.length === 0) return null;
          return (
            <div key={zone}>
              <h4 className="tv2-field-label" style={{ marginTop: 12 }}>
                {ZONE_LABEL[zone]}
              </h4>
              <ul className="tv2-items" aria-label={ZONE_LABEL[zone]}>
                {list.map((row, position) => {
                  const entry = entryOf(row.item.key);
                  const Icon = entry?.icon ?? Settings2;
                  const expanded = open === row.item.key;
                  const hidden = !canSee(row.spec.requires);
                  const opts = optsOf(row.spec, row.item);
                  return (
                    <li
                      key={row.item.key}
                      className="tv2-item"
                      draggable
                      data-dragging={dragging === row.index ? "1" : undefined}
                      data-over={over === row.index && dragging !== row.index ? "1" : undefined}
                      onDragStart={() => { setDragging(row.index); }}
                      onDragEnd={() => { setDragging(undefined); setOver(undefined); }}
                      onDragOver={(event) => { event.preventDefault(); setOver(row.index); }}
                      onDrop={(event) => { onDrop(event, row.index); }}
                    >
                      <div className="tv2-item-head">
                        <span className="tv2-grip" aria-hidden="true">
                          <GripVertical className="size-4" />
                        </span>
                        <Icon className="size-4" aria-hidden="true" />
                        <span className="tv2-grow">
                          <span className="tv2-name">{row.spec.label}</span>
                          {hidden ? <span className="tv2-sub">Hidden for your role</span> : <span className="tv2-sub">{zone === "rail" ? "In the rail" : `Size ${SIZE_LABEL[row.item.size] ?? row.item.size}`}</span>}
                        </span>
                        <button type="button" className="tv2-icon-btn" aria-label={`Move ${row.spec.label} up`} disabled={position === 0} onClick={() => { change(moveInZone(draft, row.index, -1)); }}>
                          <ChevronUp className="size-4" aria-hidden="true" />
                        </button>
                        <button type="button" className="tv2-icon-btn" aria-label={`Move ${row.spec.label} down`} disabled={position === list.length - 1} onClick={() => { change(moveInZone(draft, row.index, 1)); }}>
                          <ChevronDown className="size-4" aria-hidden="true" />
                        </button>
                        <button type="button" className="tv2-icon-btn" aria-expanded={expanded} aria-label={`Settings for ${row.spec.label}`} onClick={() => { setOpen(expanded ? undefined : row.item.key); }}>
                          <Settings2 className="size-4" aria-hidden="true" />
                        </button>
                        <button type="button" className="tv2-icon-btn" aria-label={`Remove ${row.spec.label}`} onClick={() => { change(removeAt(draft, row.index)); }}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                      {expanded ? (
                        <div className="tv2-item-body">
                          <p className="tv2-note">{row.spec.description}</p>
                          {row.spec.zones.length > 1 ? (
                            <div className="tv2-row">
                              <label htmlFor={`zone-${row.item.key}`}>Place in</label>
                              <select id={`zone-${row.item.key}`} className="tv2-select" value={row.zone} onChange={(event) => { const zoneValue = event.currentTarget.value;
                                if (isZone(zoneValue)) change(setZone(draft, row.index, zoneValue, catalogue)); }}>
                                {row.spec.zones.filter(isZone).map((z) => (
                                  <option key={z} value={z}>
                                    {ZONE_LABEL[z]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          {row.zone === "rail" || row.spec.sizes.length < 2 ? null : (
                            <Pills label={`${row.spec.label} size`} size="sm" options={toPills(row.spec.sizes, SIZE_LABEL)} value={row.item.size} onValueChange={(size) => { change(patchItem(draft, row.index, { size })); }} />
                          )}
                          {row.spec.options.map((option) => (
                            <OptionEditor key={option.key} metrics={catalogue.metrics} spec={row.spec} option={option} value={opts[option.key]} canSee={canSee} onChange={(next) => { change(setOpt(draft, row.index, option.key, next)); }} />
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {draft.items.length === 0 ? <p className="tv2-note">No widgets yet. Add some below.</p> : null}
      </section>

      <section aria-labelledby="studio-add">
        <h3 id="studio-add" className="tv2-field-label">
          Add a widget
        </h3>
        {addable.length === 0 ? (
          <p className="tv2-note">Every widget you can see is already on the board.</p>
        ) : (
          <div className="tv2-metrics">
            {addable.map(({ entry, spec }) => (
              <button key={entry.key} type="button" className="tv2-chip" aria-label={`Add ${spec.label}`} onClick={() => { change(addWidget(draft, spec)); }}>
                <Plus className="size-3.5" aria-hidden="true" />
                {spec.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {hideActions ? null : (
        <div className="tv2-actions">
          <button type="button" className="mk-btn mk-btn-primary" disabled={saveMine.isPending || !dirty} onClick={() => { save(scope); }}>
            {saveMine.isPending ? "Saving…" : scope === "clinic" ? "Save clinic default" : "Save"}
          </button>
          {scope === "me" && can("settings.manage") ? (
            <button type="button" className="mk-btn mk-btn-ghost" disabled={saveClinic.isPending} onClick={() => { save("clinic"); }}>
              Save as clinic default
            </button>
          ) : null}
          <button
            type="button"
            className="mk-btn mk-btn-ghost"
            onClick={() => {
              const base = templateLayout(catalogue, draft.tpl);
              if (base !== undefined) change(base);
            }}
          >
            Reset to template
          </button>
          {scope === "me" && view.source === "member" ? (
            <button
              type="button"
              className="mk-btn mk-btn-ghost"
              disabled={resetMine.isPending}
              onClick={() => {
                resetMine.mutate(undefined, {
                  onSuccess: (next) => {
                    setDraft(next.layout);
                    toast.show({ title: "Using the clinic's layout", tone: "success" });
                  },
                });
              }}
            >
              Use the clinic's layout
            </button>
          ) : null}
          <span role="status" className="tv2-note">
            {dirty ? "Unsaved changes" : ""}
          </span>
        </div>
      )}
      {problem === undefined ? null : (
        <p role="alert" className="tv2-note" style={{ color: "var(--sk-danger-text)" }}>
          {problem}
        </p>
      )}
    </div>
  );

  return (
    <div className="tv2-studio" data-layout={arrangement}>
      {controls}
      <ScaledPreview layout={draft} view={view} />
    </div>
  );
}
