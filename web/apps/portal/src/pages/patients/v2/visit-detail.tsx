/**
 * Everything done in one visit: the notes, the treatments, the prescriptions, the images and the payment. Money shows
 * only with billing.read. `VisitDetailBody` renders anywhere (the history page's expanded card); `VisitDetail` wraps it
 * in a drawer for callers that open a visit over the page.
 */
import { Link } from "react-router";

import type { PatientId, Visit, VisitDetail as VisitRecord, VisitId } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatRupees } from "@aarogyam/app-kit";
import { Drawer } from "@sakalya/ui";

import { Empty, Tag, statusTone } from "../../../components/mk/index.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useClinic } from "../../../clinic.js";
import { useVisit } from "../../../queries.js";
import { vitalsOf } from "../../visits/vitals.js";
import { FINDING_STYLE, surfaceLabel } from "../../visits/odontogram/model.js";
import { useInvoices } from "../../billing/queries.js";
import { usePrescriptions } from "../../prescriptions/queries.js";
import { RecordingPlayer } from "../../visits/voice/recording-player.js";
import { ImageGrid, isGalleryFile } from "./images.js";
import { splitNote } from "./note-lines.js";
import { VisitNotes } from "./note-history.js";
import { VitalChips } from "./vitals-block.js";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p360-vd-section" aria-label={title}>
      <h3 className="p360-label">{title}</h3>
      {children}
    </section>
  );
}

type ChartEntry = VisitRecord["chart_entries"][number];

/** What was recorded on the chart in this visit, current rows only: a correction replaces the entry it supersedes, and a clear is not a treatment. */
export function currentEntries(entries: readonly ChartEntry[]): ChartEntry[] {
  const replaced = new Set(entries.map((e) => e.supersedes_id).filter((id): id is string => id != null));
  return entries.filter((e) => !replaced.has(e.id) && !(e.finding === "sound" && e.supersedes_id != null));
}

function findingLabel(entry: ChartEntry): string {
  if (entry.procedure != null) return entry.procedure.label;
  return Object.entries(FINDING_STYLE).find(([key]) => key === entry.finding)?.[1].label ?? entry.finding;
}

function entryDetail(entry: ChartEntry): string {
  const canals = entry.canals.map((c) => (c.working_length_mm == null ? c.name : `${c.name} ${String(c.working_length_mm)} mm`)).join(", ");
  return [
    entry.surface == null ? undefined : surfaceLabel(entry.tooth, entry.surface),
    canals === "" ? undefined : canals,
    entry.sitting == null ? undefined : `Sitting ${String(entry.sitting)}`,
    entry.material?.label,
    entry.note ?? undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
}

/** What the body needs to know about the visit before its record loads: a listed `Visit` or a history card. */
export interface VisitHead {
  id: VisitId;
  number: string;
  started_at: string;
  ended_at?: string | null | undefined;
  status: string;
  clinician: { name: string };
  chief_complaint?: string | null | undefined;
}

/** The visit opened over the page, in a drawer. */
export function VisitDetail({ patientId, visit, onClose }: { patientId: PatientId; visit: Visit; onClose: () => void }) {
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Visit ${visit.number}`}
      size="md"
    >
      <div className="p360-drawer-body" aria-label="Visit detail">
        <VisitDetailBody patientId={patientId} visit={visit} />
      </div>
    </Drawer>
  );
}

/** Everything recorded in the visit. `head` adds the date, clinician and reason line (the drawer has no other). */
export function VisitDetailBody({ patientId, visit, head = true }: { patientId: PatientId; visit: VisitHead; head?: boolean }) {
  const { can } = useClinic();
  const canBill = can("billing.read");
  const detail = useVisit(visit.id);
  const prescriptions = usePrescriptions(can("prescriptions.issue") || can("clinical.read") ? patientId : undefined);
  const invoices = useInvoices({ patientId }, canBill);

  // A prescription belongs to the visit it was written in; one with no visit link still counts when it was written while the visit ran.
  const began = Date.parse(visit.started_at);
  const ended = visit.ended_at == null ? Number.POSITIVE_INFINITY : Date.parse(visit.ended_at);
  const rxs = (prescriptions.data?.items ?? []).filter((r) => {
    if (r.status === "cancelled") return false;
    if (r.encounter_id != null) return r.encounter_id === visit.id;
    const at = Date.parse(r.issued_at ?? r.created_at);
    return at >= began && at <= ended;
  });
  const bills = (invoices.data?.items ?? []).filter((i) => i.encounter_id === visit.id && i.status !== "void");
  const images = (detail.data?.attachments ?? []).filter(isGalleryFile);
  const recordings = (detail.data?.attachments ?? []).filter((a) => a.kind === "audio");
  const entries = currentEntries(detail.data?.chart_entries ?? []);
  const treated = entries.length + (detail.data?.procedures.length ?? 0);
  const noted = (detail.data?.notes ?? []).map((note) => ({ note, parts: splitNote(note.sections) })).filter(({ parts }) => parts.voice.length + parts.other.length > 0);
  const vitals = detail.data?.observations ?? [];
  const waiting = detail.isPending || prescriptions.isLoading || invoices.isLoading;
  const empty = !waiting && !detail.isError && noted.length === 0 && recordings.length === 0 && treated === 0 && vitalsOf(vitals).length === 0 && rxs.length === 0 && images.length === 0 && bills.length === 0;

  return (
    <>
        {head ? (
          <>
            <p className="mk-hint" style={{ margin: 0 }}>
              {formatDateTime(visit.started_at)} · {visit.clinician.name} · {visit.status === "open" ? "Open" : "Closed"}
            </p>
            {visit.chief_complaint == null || visit.chief_complaint === "" ? null : <p className="p360-vd-text">{visit.chief_complaint}</p>}
          </>
        ) : null}
        {detail.isPending ? (
          <SkeletonRows count={3} label="Loading the visit" />
        ) : detail.isError ? (
          <ApiErrorNotice title="Couldn't load this visit" error={detail.error} onRetry={() => void detail.refetch()} />
        ) : empty ? (
          <Empty art="notes" title="Nothing was recorded in this visit">
            No vitals, treatment, note, prescription, image or bill was saved with it. Anything recorded later will show here.
          </Empty>
        ) : (
          <>
            {vitalsOf(vitals).length === 0 ? null : (
              <Section title="Vitals">
                <VitalChips observations={vitals} />
              </Section>
            )}
            <Section title="Treatments">
              {treated === 0 ? (
                <p className="mk-hint">No treatments recorded.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {entries.map((entry) => (
                    <li key={entry.id} className="p360-histrow" style={{ display: "block" }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{findingLabel(entry)}</b>
                        <span className="mk-hint" style={{ margin: 0 }}>
                          Tooth {entry.tooth}
                        </span>
                        <Tag tone={statusTone(entry.in_progress ? "info" : entry.status === "planned" ? "warning" : "success")}>
                          {entry.in_progress ? "In progress" : entry.status === "planned" ? "Planned" : "Completed"}
                        </Tag>
                      </div>
                      {entryDetail(entry) === "" ? null : (
                        <p className="mk-hint" style={{ margin: "4px 0 0" }}>
                          {entryDetail(entry)}
                        </p>
                      )}
                    </li>
                  ))}
                  {(detail.data.procedures).map((p) => (
                    <li key={p.id} className="p360-histrow">
                      <b>{p.name}</b>
                      {p.tooth == null ? null : <span className="mk-hint" style={{ margin: 0 }}>Tooth {p.tooth}</span>}
                      <Tag tone={statusTone(p.status === "done" ? "success" : "neutral")}>{p.status}</Tag>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Notes">
              <VisitNotes notes={detail.data.notes} visit={detail.data.visit} canWrite={can("clinical.write")} />
              {recordings.length === 0 ? null : (
                <ul aria-label="Voice recordings" className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {recordings.map((recording) => (
                    <li key={recording.id}>
                      <p className="mk-hint" style={{ margin: "0 0 2px" }}>
                        {formatDateTime(recording.created_at)}
                      </p>
                      <RecordingPlayer recording={recording} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Prescriptions">
              {rxs.length === 0 ? (
                <p className="mk-hint">No prescription in this visit.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {rxs.map((rx) => (
                    <li key={rx.id} className="p360-histrow" style={{ display: "block" }}>
                      <Link className="mk-link mk-mono" to={`/prescriptions/${rx.id}`}>
                        {rx.number ?? "Draft"}
                      </Link>
                      <ul aria-label="Medicines" className="m-0 mt-1 list-none p-0">
                        {rx.items.length === 0 ? <li className="mk-hint">No medicines</li> : null}
                        {rx.items.map((line, index) => (
                          <li key={`${line.drug_name ?? "item"}-${String(index)}`} className="text-sm">
                            <b>{`${line.drug_name ?? ""} ${line.strength ?? ""}`.trim() || "Medicine"}</b>
                            <span className="mk-hint" style={{ margin: 0 }}>
                              {[line.dose, line.frequency, line.timing, line.duration_days == null ? undefined : `${String(line.duration_days)} days`].filter((part) => part != null && part !== "").map((part) => ` · ${String(part).replace(/_/g, " ")}`)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Images">{images.length === 0 ? <p className="mk-hint">No images in this visit.</p> : <ImageGrid files={images} />}</Section>
            {canBill ? (
              <Section title="Payment">
                {bills.length === 0 ? (
                  <p className="mk-hint">No bill for this visit.</p>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {bills.map((bill) => (
                      <li key={bill.id} className="p360-histrow">
                        <b>{bill.number ?? "Draft bill"}</b>
                        <span>{formatRupees(bill.total_paise)}</span>
                        <Tag tone={statusTone(bill.balance_paise === 0 && bill.status === "issued" ? "success" : "warning")}>
                          {bill.status === "draft" ? "Draft" : bill.balance_paise === 0 ? "Paid" : `Due ${formatRupees(bill.balance_paise)}`}
                        </Tag>
                      </li>
                    ))}
                    {bills
                      .filter((bill) => bill.paid_paise > 0)
                      .map((bill) => (
                        <li key={`${bill.id}-paid`} className="p360-histrow">
                          <b>Received</b>
                          <span>{formatRupees(bill.paid_paise)}</span>
                          <span className="mk-hint" style={{ margin: 0 }}>
                            {bill.methods.map((m) => m.toUpperCase()).join(", ")}
                            {bill.number == null ? "" : ` · ${bill.number}`}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </Section>
            ) : null}
          </>
        )}
    </>
  );
}
