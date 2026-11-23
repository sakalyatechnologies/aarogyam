/**
 * `/patients/:id/history`: the patient's whole history on its own page (design: docs/plans/history-views-design.md).
 * A timeline of rich visit cards with a jump-to-month rail and a side column for plans and money. A card expands in
 * place into the full visit (`VisitDetailBody`); `?visit=<id>` is the one link that opens a visit here. Back and Esc
 * return to the patient page.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, FileText, Mic, Pill, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { patientId as patientIdSchema, unwrap, type HistoryFile, type HistoryVisit, type PatientId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatRupees, useDocumentTitle } from "@aarogyam/app-kit";

import { Empty, Initials, Tag } from "../../../../components/mk/index.js";
import { SkeletonRows } from "../../../../components/skeleton-rows.js";
import { useClinic } from "../../../../clinic.js";
import { ageSex, displayName, patientPath } from "../../../../lib/patients.js";
import { usePatient } from "../../../../queries.js";
import { NotFoundPage } from "../../../not-found-page.js";
import { usePlans } from "../../../treatment-plans/queries.js";
import { AllergyTag, OPEN_DIALOG } from "../patient-360.js";
import { VisitDetailBody } from "../visit-detail.js";
import { countsText } from "../visit-timeline.js";
import { HISTORY_FILTERS, MONTHS, NO_FILTER, billTag, kindsOf, matches, monthKey, titleOf, toothLabel, WORK_WORDS, type HistoryFilter, type HistoryKind } from "./history-model.js";
import { HistoryStyleSwitch, historyTarget, setSessionHistoryStyle } from "./history-style.js";
import { ToothGlyph } from "./tooth-glyph.js";
import "./history.css";

const FIRST_PAGE: string | undefined = undefined;

/** Scrolls an element into view where the browser can (test DOMs can't). */
function scrollToEl(el: HTMLElement | null, options: ScrollIntoViewOptions) {
  if (el !== null && "scrollIntoView" in el) el.scrollIntoView(options);
}

/** The history's pages: up to 200 visits each, so nearly every patient's history arrives in one response. */
export function usePatientHistory(patientId: PatientId | undefined) {
  const { api, access } = useClinic();
  return useInfiniteQuery({
    queryKey: ["patient-history", access.org_id, patientId],
    queryFn: ({ pageParam, signal }) =>
      patientId === undefined ? Promise.reject(new Error("no patient")) : unwrap(api.getPatientHistory(patientId, pageParam, { signal })),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last) => last.next_cursor,
    enabled: patientId !== undefined,
    staleTime: 30_000,
  });
}

export function HistoryPage() {
  const params = useParams();
  const parsed = patientIdSchema.safeParse(params["id"]);
  if (!parsed.success) return <NotFoundPage title="We couldn't find that patient" />;
  return <History patientId={parsed.data} />;
}

function History({ patientId }: { patientId: PatientId }) {
  const { can, session } = useClinic();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const openId = search.get("visit") ?? undefined;
  const patient = usePatient(patientId);
  const history = usePatientHistory(can("clinical.read") ? patientId : undefined);
  const [filter, setFilter] = useState<HistoryFilter>(NO_FILTER);
  useDocumentTitle(patient.data === undefined ? "History" : `History · ${patient.data.number}`, "Patients", session.clinic.name);

  const back = () => void navigate(patientPath({ id: patientId }), { state: { focusHistory: true } });
  const open = (id: string | undefined) => {
    setSearch(id === undefined ? {} : { visit: id }, { replace: true });
  };

  // Esc closes the open visit, then returns to the patient. Never while a dialog (an image) is open or someone types.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      if (document.querySelector(OPEN_DIALOG) !== null) return;
      e.preventDefault();
      if (openId !== undefined) open(undefined);
      else back();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  });

  const visits = useMemo(() => (history.data?.pages ?? []).flatMap((p) => p.visits), [history.data]);
  const loose = history.data?.pages[0]?.loose_files ?? [];

  // A deep link to a visit beyond the first page loads older pages until it is found.
  const found = openId === undefined || visits.some((v) => v.id === openId);
  useEffect(() => {
    if (!found && history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
  }, [found, history]);
  useEffect(() => {
    if (openId === undefined || !found) return;
    scrollToEl(document.getElementById(`hist-${openId}`), { block: "start" });
  }, [openId, found]);

  if (!can("clinical.read")) {
    return (
      <div className="hist">
        <Empty art="notes" title="History needs clinical access">
          Ask the clinic owner for clinical.read to see visits, notes and treatments.
        </Empty>
      </div>
    );
  }

  const shown = visits.filter((v) => matches(v, filter));
  const filtering = filter.q.trim() !== "" || filter.kinds.size > 0 || filter.doctor !== "all";
  return (
    <div className="hist">
      <header className="hist-top">
        <button type="button" className="hist-back" onClick={back}>
          <ChevronLeft aria-hidden="true" />
          Back to patient
        </button>
        <h1>History</h1>
        {patient.data === undefined ? null : (
          <span className="hist-who">
            <Initials name={patient.data.full_name} size="sm" />
            <span>
              {displayName(patient.data.full_name)} · {ageSex(patient.data.age_years ?? null, patient.data.sex, patient.data.birth_date_estimated)}
            </span>
            <AllergyTag patientId={patientId} />
          </span>
        )}
        <span className="hist-sp" />
        <HistoryStyleSwitch
          value="page"
          onChange={(next) => {
            setSessionHistoryStyle(next);
            if (next !== "page") void navigate(historyTarget(patientPath({ id: patientId }), next, openId), { replace: true });
          }}
        />
        <span className="hist-esc" aria-hidden="true">
          <kbd>Esc</kbd> back
        </span>
      </header>

      <HistoryFilters visits={visits} filter={filter} onChange={setFilter} />

      {history.isPending ? (
        <SkeletonRows count={4} tall label="Loading the history" />
      ) : history.isError ? (
        <ApiErrorNotice title="Couldn't load the history" error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <div className="hist-grid">
          <aside className="hist-side" aria-label="Jump, money and plans">
            <MonthRail visits={shown} />
            <MoneyCard patientId={patientId} />
            <PlansCard patientId={patientId} />
          </aside>
          <section aria-label="Visits, newest first">
            <p className="hist-count">
              {visits.length === 0 ? "No visits yet" : `${String(shown.length)} of ${String(visits.length)} visit${visits.length === 1 ? "" : "s"} · newest first`}
            </p>
            {visits.length === 0 ? (
              <Empty art="notes" title="No visits yet">
                Visits appear here as they are recorded: treatments, X-rays, notes, medicines and bills.
              </Empty>
            ) : shown.length === 0 ? (
              <Empty
                art="search"
                title="No visit has that"
                action={
                  <button type="button" className="hist-btn" onClick={() => {
                      setFilter(NO_FILTER);
                    }}>
                    Clear the filters
                  </button>
                }
              >
                Try another word or clear the filters.
              </Empty>
            ) : (
              <ol className="hist-tl" aria-label="Visits" aria-busy={history.isFetchingNextPage}>
                {shown.map((v, i) => {
                  const year = new Date(v.started_at).getFullYear();
                  const prev = i === 0 ? undefined : new Date(shown[i - 1]?.started_at ?? "").getFullYear();
                  return (
                    <li key={v.id} className="hist-item" id={`hist-${v.id}`} data-month={monthKey(v.started_at)}>
                      {year === prev ? null : (
                        <p className="hist-year" id={`hist-y${String(year)}`}>
                          {year}
                        </p>
                      )}
                      <VisitCard patientId={patientId} visit={v} open={v.id === openId} q={filter.q} onToggle={() => {
                          open(v.id === openId ? undefined : v.id);
                        }} />
                    </li>
                  );
                })}
              </ol>
            )}
            {history.hasNextPage ? (
              <button type="button" className="hist-btn hist-more" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                {history.isFetchingNextPage ? "Loading older visits…" : "Load older visits"}
              </button>
            ) : null}
            {loose.length === 0 || filtering ? null : <OutsideVisits files={loose} />}
          </section>
        </div>
      )}
    </div>
  );
}

/** Search plus the chips and the doctor: one state, shared by every history style. */
export function HistoryFilters({ visits, filter, onChange }: { visits: readonly HistoryVisit[]; filter: HistoryFilter; onChange: (next: HistoryFilter) => void }) {
  const counts = useMemo(() => {
    const out: Record<HistoryKind, number> = { treatments: 0, xrays: 0, notes: 0, medicines: 0, bills: 0 };
    for (const v of visits) for (const k of kindsOf(v)) out[k] += 1;
    return out;
  }, [visits]);
  const doctors = useMemo(() => [...new Map(visits.map((v) => [String(v.clinician.id), v.clinician.name])).entries()], [visits]);
  const toggle = (kind: HistoryKind) => {
    const kinds = new Set(filter.kinds);
    if (kinds.has(kind)) kinds.delete(kind);
    else kinds.add(kind);
    onChange({ ...filter, kinds });
  };
  return (
    <div className="hist-tools" role="search">
      <label className="hist-field">
        <Search aria-hidden="true" />
        <input type="search" placeholder="Search notes, teeth, medicines" aria-label="Search the history" value={filter.q} onChange={(e) => {
            onChange({ ...filter, q: e.target.value });
          }} />
      </label>
      <div className="hist-chips" role="group" aria-label="Show only">
        {HISTORY_FILTERS.filter((f) => f.kind !== "bills" || counts.bills > 0).map((f) => (
          <button key={f.kind} type="button" className="hist-chip" aria-pressed={filter.kinds.has(f.kind)} onClick={() => {
              toggle(f.kind);
            }}>
            {f.label} <span className="n">{counts[f.kind]}</span>
          </button>
        ))}
      </div>
      {doctors.length > 1 ? (
        <select className="hist-sel" aria-label="Doctor" value={filter.doctor} onChange={(e) => {
            onChange({ ...filter, doctor: e.target.value });
          }}>
          <option value="all">All doctors</option>
          {doctors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function Mark({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="hist-mark">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function VisitCard({ patientId, visit: v, open, q, onToggle }: { patientId: PatientId; visit: HistoryVisit; open: boolean; q: string; onToggle: () => void }) {
  const when = new Date(v.started_at);
  const bill = billTag(v);
  const title = titleOf(v);
  const time = when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const extra = countsText({ ...v.counts, files: Math.max(0, v.counts.files - v.image_count), notes: 0 });
  const detailId = `hist-detail-${v.id}`;
  return (
    <>
      <div className="hist-when" aria-hidden="true">
        <b>{when.getDate()}</b>
        <span>
          {MONTHS[when.getMonth()]} {when.getFullYear()}
        </span>
      </div>
      <span className="hist-dot" aria-hidden="true" />
      <article tabIndex={-1} className={`hist-card${open ? " open" : ""}`} aria-labelledby={`hist-t-${v.id}`}>
        <div className="hist-card-h">
          <h2 id={`hist-t-${v.id}`}>
            <Mark text={title} q={q} />
          </h2>
          <span className="hist-by">
            <Mark text={v.clinician.name} q={q} /> · {v.number} · {time}
          </span>
          <span className="hist-sp" />
          {v.status === "open" ? <Tag tone="wait">Open</Tag> : null}
          {v.plans.map((p) => (
            <Tag key={p.id} tone="info">
              {`Plan ${p.status.replace(/_/g, " ")}`}
            </Tag>
          ))}
          {bill === undefined ? null : bill.tone === "due" ? <Tag tone="down">{`${formatRupees(bill.due)} due`}</Tag> : <Tag tone="done">{`Paid ${formatRupees(bill.total)}`}</Tag>}
        </div>
        {v.chief_complaint == null || v.chief_complaint === "" || v.chief_complaint === title ? null : (
          <p className="hist-came">
            Came in for: <Mark text={v.chief_complaint} q={q} />
          </p>
        )}
        {open ? (
          <div className="hist-detail" id={detailId} role="region" aria-label={`Visit ${v.number} detail`}>
            <VisitDetailBody patientId={patientId} visit={v} head={false} />
          </div>
        ) : (
          <>
            {v.teeth.length + v.images.length === 0 ? null : (
              <div className="hist-row">
                {v.teeth.length === 0 ? null : (
                  <ul className="hist-teeth" aria-label="Teeth">
                    {v.teeth.map((t, i) => (
                      <li key={`${String(t.tooth)}-${String(i)}`} className="hist-tooth">
                        <ToothGlyph tooth={t.tooth} finding={t.finding} />
                        <span>
                          <b>{t.tooth}</b> · <Mark text={toothLabel(t)} q={q} />
                          <small>{WORK_WORDS[t.work] ?? t.work}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {v.images.length === 0 ? null : (
                  <ul className="hist-thumbs" aria-label={`${String(v.image_count)} image${v.image_count === 1 ? "" : "s"}`}>
                    {v.images.map((f) => (
                      <li key={f.id}>
                        <Thumb file={f} />
                      </li>
                    ))}
                    {v.image_count > v.images.length ? <li className="hist-more-n">+{v.image_count - v.images.length}</li> : null}
                  </ul>
                )}
              </div>
            )}
            {v.note_first_line == null ? null : (
              <p className="hist-note">
                {v.counts.recordings > 0 ? <Mic aria-hidden="true" /> : <FileText aria-hidden="true" />}
                <span>
                  <Mark text={v.note_first_line} q={q} />
                </span>
              </p>
            )}
          </>
        )}
        <div className="hist-foot">
          {open
            ? null
            : v.medicines.map((m) => (
                <span key={m} className="hist-rx">
                  <Pill aria-hidden="true" />
                  <Mark text={m} q={q} />
                </span>
              ))}
          {open || extra === "" ? null : <span className="hist-rx">{extra}</span>}
          <span className="hist-sp" />
          <button type="button" className="hist-btn sm" aria-label={`${open ? "Close" : "Open"} visit ${v.number}`} aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={onToggle}>
            {open ? (
              <>
                <X aria-hidden="true" /> Close visit
              </>
            ) : (
              <>
                Open visit <ArrowRight aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </article>
    </>
  );
}

/** An image preview, asked for only when it scrolls near the screen (one short-lived link per image). */
function Thumb({ file }: { file: HistoryFile }) {
  const { api, access } = useClinic();
  const ref = useRef<HTMLSpanElement>(null);
  // Without IntersectionObserver (old browsers, tests) every preview loads at once.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (el === null || near) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setNear(true);
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, [near]);
  const image = file.mime_type.startsWith("image/");
  const link = useQuery({
    queryKey: ["attachment-link", access.org_id, file.id],
    queryFn: () => unwrap(api.getDownloadLink(file.id)),
    enabled: image && near,
    staleTime: 4 * 60_000,
  });
  return (
    <span ref={ref} className="hist-thumb">
      {image && link.data !== undefined ? <img src={link.data.url} alt={file.label ?? "Patient image"} loading="lazy" /> : <FileText aria-hidden="true" />}
      <span>{file.label ?? (file.kind === "xray" ? "X-ray" : "Photo")}</span>
    </span>
  );
}

function MonthRail({ visits }: { visits: readonly HistoryVisit[] }) {
  const months = useMemo(() => {
    const out: { key: string; first: string; count: number }[] = [];
    for (const v of visits) {
      const key = monthKey(v.started_at);
      const last = out.at(-1);
      if (last?.key === key) last.count += 1;
      else out.push({ key, first: v.id, count: 1 });
    }
    return out;
  }, [visits]);
  if (months.length === 0) return null;
  const jump = (id: string) => {
    const el = document.getElementById(id);
    scrollToEl(el, { behavior: "smooth", block: "start" });
    el?.querySelector<HTMLElement>("article")?.focus({ preventScroll: true });
  };
  return (
    <nav className="hist-panel hist-rail" aria-label="Jump to month">
      <p className="hist-label">Jump to</p>
      {months.map((m, i) => {
        const year = m.key.slice(0, 4);
        return (
          <div key={m.key}>
            {i === 0 || months[i - 1]?.key.slice(0, 4) !== year ? <p className="hist-rail-y">{year}</p> : null}
            <button type="button" onClick={() => {
                jump(`hist-${m.first}`);
              }}>
              {MONTHS[Number(m.key.slice(5)) - 1]}
              <span>{m.count}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function MoneyCard({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const patient = usePatient(patientId).data;
  if (!can("billing.read") || patient === undefined) return null;
  const paid = patient.lifetime_paid_paise ?? 0;
  const due = patient.balance_paise ?? 0;
  const billed = paid + due;
  return (
    <section className="hist-panel" aria-label="Money">
      <p className="hist-label">Money</p>
      <div className="hist-money">
        <div>
          <span>Billed</span>
          <b>{formatRupees(billed)}</b>
        </div>
        <div className="hist-bar" aria-hidden="true">
          <i style={{ width: `${String(billed === 0 ? 0 : Math.round((paid / billed) * 100))}%` }} />
        </div>
        <div>
          <span>Paid</span>
          <span>{formatRupees(paid)}</span>
        </div>
        <div>
          <span>Due</span>
          <b className={due > 0 ? "hist-due" : undefined}>{formatRupees(due)}</b>
        </div>
      </div>
    </section>
  );
}

function PlansCard({ patientId }: { patientId: PatientId }) {
  const plans = usePlans(patientId).data?.items ?? [];
  const live = plans.filter((p) => p.status !== "declined");
  if (live.length === 0) return null;
  return (
    <section className="hist-panel" aria-label="Plans">
      <p className="hist-label">Plans</p>
      <ul className="hist-plans">
        {live.map((p) => {
          const items = p.items.filter((i) => i.status !== "cancelled");
          const done = items.filter((i) => i.status === "done").length;
          return (
            <li key={p.id}>
              <b>{p.title}</b>
              <Tag tone={p.status === "completed" ? "done" : "info"}>
                {`${p.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())} · ${String(done)} of ${String(items.length)} done`}
              </Tag>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Files that belong to no visit (uploaded from the records card, imported), so nothing recorded is missing here. */
function OutsideVisits({ files }: { files: readonly HistoryFile[] }) {
  return (
    <section className="hist-outside" aria-label="Outside visits">
      <p className="hist-label">Outside visits</p>
      <ul className="hist-thumbs">
        {files.map((f) => (
          <li key={f.id}>
            <Thumb file={f} />
            <small>{formatDate(f.created_at)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
