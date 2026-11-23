/**
 * The history's two overlay styles on the patient's page: a large pop-up (visit list and one visit side by side) and
 * a patient story (a 30-second read, then folding sections). Both open from `?history=1` and `?visit=<id>`, close on Esc
 * (an open visit first) and return focus to the History button. Loaded on demand, like the page route.
 */
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import type { HistoryVisit, PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime, formatRupees } from "@aarogyam/app-kit";

import { Empty, Initials, Tag } from "../../../../components/mk/index.js";
import { SkeletonRows } from "../../../../components/skeleton-rows.js";
import { useClinic } from "../../../../clinic.js";
import { ageSex, displayName, patientPath } from "../../../../lib/patients.js";
import { useClinicalFlags, usePatient } from "../../../../queries.js";
import { usePlans } from "../../../treatment-plans/queries.js";
import { AllergyTag } from "../patient-360.js";
import { VisitDetailBody } from "../visit-detail.js";
import { HISTORY_FILTERS, billTag, kindsOf, matches, NO_FILTER, titleOf, toothLabel, type HistoryFilter, type HistoryKind } from "./history-model.js";
import { HistoryFilters, usePatientHistory } from "./history-page.js";
import { HistoryStyleSwitch, historyTarget, setSessionHistoryStyle, type HistoryStyle } from "./history-style.js";
import "./history.css";
import "./history-overlay.css";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const ANY_DIALOG = "[role='dialog']:not([aria-hidden='true']), [role='alertdialog']:not([aria-hidden='true'])";

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']") !== null);
}

export function HistoryOverlay({ patientId, style, onClose }: { patientId: PatientId; style: Exclude<HistoryStyle, "page">; onClose: () => void }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const openId = search.get("visit") ?? undefined;
  const history = usePatientHistory(can("clinical.read") ? patientId : undefined);
  const patient = usePatient(patientId).data;
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  const shell = useRef<HTMLDivElement>(null);
  const label = style === "popup" ? "Patient history" : "Patient story";

  const visits = useMemo(() => (history.data?.pages ?? []).flatMap((p) => p.visits), [history.data]);
  const shown = useMemo(() => visits.filter((v) => matches(v, filter)), [visits, filter]);
  const found = openId === undefined || visits.some((v) => v.id === openId);
  useEffect(() => {
    if (!found && history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
  }, [found, history]);

  const open = (id: string | undefined) => {
    setSearch(id === undefined ? { history: "1" } : { history: "1", visit: id }, { replace: true });
  };
  const switchTo = (next: HistoryStyle) => {
    setSessionHistoryStyle(next);
    if (next === "page") void navigate(historyTarget(patientPath({ id: patientId }), "page", openId), { replace: true });
  };

  // Esc closes an open visit, then the overlay. An image dialog inside it takes its own Esc first.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      if ([...document.querySelectorAll(ANY_DIALOG)].some((d) => d !== shell.current)) return;
      e.preventDefault();
      if (openId !== undefined) open(undefined);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  });
  useEffect(() => {
    shell.current?.focus();
  }, []);

  // Tab stays inside the overlay.
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const items = [...(shell.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === shell.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const at = shown.findIndex((v) => v.id === openId);
  const move = (by: 1 | -1) => {
    const next = shown[at < 0 ? (by === 1 ? 0 : shown.length - 1) : at + by];
    if (next === undefined) return;
    open(next.id);
    requestAnimationFrame(() => {
      shell.current?.querySelector<HTMLElement>(`[data-visit="${next.id}"]`)?.focus();
    });
  };
  // Down goes to the older visit and Up to the newer one, from the list (not while typing or reading a visit).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    trap(e);
    if (e.defaultPrevented || style !== "popup" || (e.key !== "ArrowDown" && e.key !== "ArrowUp") || typing(e.target)) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target !== shell.current && target?.closest(".hov-list") == null) return;
    e.preventDefault();
    move(e.key === "ArrowDown" ? 1 : -1);
  };

  const who = patient === undefined ? null : (
    <span className="hist-who">
      <Initials name={patient.full_name} size="sm" />
      <span>
        {displayName(patient.full_name)} · {ageSex(patient.age_years ?? null, patient.sex, patient.birth_date_estimated)}
      </span>
      <AllergyTag patientId={patientId} />
    </span>
  );

  return (
    <div className={`hov-scrim hov-${style}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={shell} className="hov hist" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} data-detail={openId === undefined ? "list" : "visit"} onKeyDown={onKeyDown}>
        <header className="hov-top">
          <h2>{style === "popup" ? "History" : "Story"}</h2>
          {who}
          <span className="hist-sp" />
          <HistoryStyleSwitch value={style} onChange={switchTo} />
          <button type="button" className="hist-btn sm" aria-label="Close history" onClick={onClose}>
            <X aria-hidden="true" /> Close <kbd aria-hidden="true">Esc</kbd>
          </button>
        </header>
        {!can("clinical.read") ? (
          <Empty art="notes" title="History needs clinical access">
            Ask the clinic owner for clinical.read to see visits, notes and treatments.
          </Empty>
        ) : history.isPending ? (
          <SkeletonRows count={4} tall label="Loading the history" />
        ) : history.isError ? (
          <ApiErrorNotice title="Couldn't load the history" error={history.error} onRetry={() => void history.refetch()} />
        ) : style === "popup" ? (
          <Popup patientId={patientId} visits={visits} shown={shown} openId={openId} filter={filter} onFilter={setFilter} onOpen={open} onMove={move} at={at} />
        ) : (
          <Story patientId={patientId} visits={visits} shown={shown} openId={openId} filter={filter} onFilter={setFilter} onOpen={open} />
        )}
      </div>
    </div>
  );
}

interface PaneProps {
  patientId: PatientId;
  visits: readonly HistoryVisit[];
  shown: readonly HistoryVisit[];
  openId: string | undefined;
  filter: HistoryFilter;
  onFilter: (next: HistoryFilter) => void;
  onOpen: (id: string | undefined) => void;
}

function Popup({ patientId, visits, shown, openId, filter, onFilter, onOpen, onMove, at }: PaneProps & { onMove: (by: 1 | -1) => void; at: number }) {
  const current = shown[at];
  const stop = at < 0 ? 0 : at;
  return (
    <>
      <HistoryFilters visits={visits} filter={filter} onChange={onFilter} />
      {visits.length === 0 ? (
        <Empty art="notes" title="No visits yet">
          Visits appear here as they are recorded.
        </Empty>
      ) : (
        <div className="hov-body">
          <section className="hov-listpane" aria-label="Visits, newest first">
            <p className="hist-count">{`${String(shown.length)} of ${String(visits.length)} visit${visits.length === 1 ? "" : "s"} · newest first`}</p>
            {shown.length === 0 ? (
              <p className="hist-count">
                No visit has that.{" "}
                <button type="button" className="hist-btn sm" onClick={() => { onFilter(NO_FILTER); }}>Clear the filters</button>
              </p>
            ) : (
              <ul className="hov-list" role="listbox" aria-label="Visits">
                {shown.map((v, i) => (
                  <li key={v.id} role="presentation">
                    <button type="button" role="option" aria-selected={v.id === openId} data-visit={v.id} tabIndex={i === stop ? 0 : -1} className="hov-row" onClick={() => { onOpen(v.id); }}>
                      <b>{titleOf(v)}</b>
                      <span>{formatDate(v.started_at)} · {v.clinician.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="hov-visit" aria-label="Visit">
            {current === undefined ? (
              <p className="hist-count">{openId === undefined ? "Pick a visit to read it here. Up and Down keys move between visits." : "Loading that visit…"}</p>
            ) : (
              <>
                <div className="hov-visit-bar">
                  <button type="button" className="hist-btn sm hov-backbtn" onClick={() => { onOpen(undefined); }}>
                    <ArrowLeft aria-hidden="true" /> All visits
                  </button>
                  <h3>{titleOf(current)}</h3>
                  <span className="hist-sp" />
                  <button type="button" className="hist-btn sm" disabled={at <= 0} onClick={() => { onMove(-1); }}>
                    <ArrowUp aria-hidden="true" /> Newer
                  </button>
                  <button type="button" className="hist-btn sm" disabled={at >= shown.length - 1} onClick={() => { onMove(1); }}>
                    <ArrowDown aria-hidden="true" /> Older
                  </button>
                </div>
                <div className="hov-visit-body" key={current.id}>
                  <VisitDetailBody patientId={patientId} visit={current} />
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

const SECTIONS: readonly { kind: HistoryKind; title: string; line: (v: HistoryVisit) => string }[] = [
  { kind: "treatments", title: "Treatments", line: (v) => (v.teeth.length === 0 ? titleOf(v) : v.teeth.map((t) => `${String(t.tooth)} ${toothLabel(t)}`).join(", ")) },
  { kind: "xrays", title: "X-rays", line: (v) => `${String(v.image_count)} image${v.image_count === 1 ? "" : "s"}` },
  { kind: "notes", title: "Notes and voice", line: (v) => v.note_first_line ?? (v.counts.recordings > 0 ? "Voice note" : "Note") },
  { kind: "medicines", title: "Medicines", line: (v) => v.medicines.join(", ") },
  {
    kind: "bills",
    title: "Billing",
    line: (v) => {
      const bill = billTag(v);
      return bill === undefined ? "" : bill.tone === "due" ? `${formatRupees(bill.due)} due of ${formatRupees(bill.total)}` : `Paid ${formatRupees(bill.total)}`;
    },
  },
];

/** The 30-second read: what a doctor needs before anything else. Uses data the patient's page already loads. */
function QuickRead({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const patient = usePatient(patientId).data;
  const flags = useClinicalFlags(can("clinical.read") ? patientId : undefined).data;
  const plans = usePlans(patientId).data?.items ?? [];
  const plan = plans.find((p) => p.status !== "declined" && p.status !== "completed");
  const items = plan?.items.filter((i) => i.status !== "cancelled") ?? [];
  const done = items.filter((i) => i.status === "done").length;
  const activeAllergies = flags?.allergies.filter((a) => a.status === "active") ?? [];
  const conditions = flags?.conditions.filter((c) => c.status === "active") ?? [];
  const allergyText =
    flags === undefined ? "…" : flags.details_hidden ? `${String(flags.allergy_count)} recorded` : activeAllergies.length > 0 ? activeAllergies.map((a) => a.substance).join(", ") : flags.allergies_reviewed === "none_known" ? "No known allergies" : "None recorded";
  const due = patient?.balance_paise ?? 0;
  const facts: { label: string; value: string; warn: boolean }[] = [
    { label: "Allergies", value: allergyText, warn: flags?.severe_allergy === true },
    { label: "Conditions", value: flags === undefined ? "…" : flags.details_hidden ? `${String(flags.condition_count)} recorded` : conditions.length > 0 ? conditions.map((c) => c.display_text).join(", ") : "None recorded", warn: false },
    { label: "Active plan", value: plan === undefined ? "No active plan" : `${plan.title} · ${String(done)} of ${String(items.length)} done`, warn: false },
    { label: "Last visit", value: patient?.last_visit_at == null ? "None yet" : formatDate(patient.last_visit_at), warn: false },
    { label: "Next visit", value: patient?.next_appointment == null ? "Nothing booked" : formatDateTime(patient.next_appointment.starts_at), warn: false },
  ];
  if (can("billing.read")) facts.push({ label: "Money due", value: formatRupees(due), warn: due > 0 });
  return (
    <section className="hov-read" aria-label="30-second read">
      <p className="hist-label">30-second read</p>
      <dl>
        {facts.map((f) => (
          <div key={f.label} className={f.warn ? "hov-fact warn" : "hov-fact"}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Story({ patientId, visits, shown, openId, filter, onFilter, onOpen }: PaneProps) {
  const current = visits.find((v) => v.id === openId);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (current !== undefined && panel.current !== null && "scrollIntoView" in panel.current) panel.current.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <div className="hov-story-body">
      <QuickRead patientId={patientId} />
      <HistoryFilters visits={visits} filter={filter} onChange={onFilter} />
      {current === undefined ? null : (
        <section ref={panel} className="hov-open" aria-label={`Visit ${current.number}`}>
          <div className="hov-visit-bar">
            <h3>{titleOf(current)}</h3>
            <Tag tone="info">{formatDate(current.started_at)}</Tag>
            <span className="hist-sp" />
            <button type="button" className="hist-btn sm" onClick={() => { onOpen(undefined); }}>
              <X aria-hidden="true" /> Close visit
            </button>
          </div>
          <VisitDetailBody patientId={patientId} visit={current} head={false} />
        </section>
      )}
      {visits.length === 0 ? (
        <Empty art="notes" title="No visits yet">
          Visits appear here as they are recorded.
        </Empty>
      ) : (
        SECTIONS.filter((s) => s.kind !== "bills" || visits.some((v) => kindsOf(v).has("bills"))).map((s) => {
          const rows = shown.filter((v) => kindsOf(v).has(s.kind));
          const chip = HISTORY_FILTERS.find((f) => f.kind === s.kind)?.label ?? s.title;
          return (
            <details key={s.kind} className="hov-sec" open={s.kind === "treatments" || filter.kinds.has(s.kind)}>
              <summary>
                <ChevronDown aria-hidden="true" />
                {s.title} <span className="n">{rows.length}</span>
              </summary>
              {rows.length === 0 ? (
                <p className="hist-count">{`No ${chip.toLowerCase()} to show.`}</p>
              ) : (
                <ul className="hov-rows">
                  {rows.map((v) => (
                    <li key={v.id}>
                      <button type="button" className="hov-row" aria-expanded={v.id === openId} aria-label={`${s.title}: open visit ${v.number}`} onClick={() => { onOpen(v.id === openId ? undefined : v.id); }}>
                        <b>{formatDate(v.started_at)}</b>
                        <span>{s.line(v)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })
      )}
    </div>
  );
}
