/**
 * Everything done in one visit, opened from the history: the notes, the treatments, the prescriptions, the images and
 * the payment. Money shows only with billing.read.
 */
import { Link } from "react-router";

import type { PatientId, Visit } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime, formatRupees } from "@aarogyam/app-kit";
import { Drawer } from "@sakalya/ui";

import { Tag, statusTone } from "../../../components/mk/index.js";
import { SkeletonRows } from "../../../components/skeleton-rows.js";
import { useClinic } from "../../../clinic.js";
import { useVisit } from "../../../queries.js";
import { useInvoices, usePayments } from "../../billing/queries.js";
import { usePrescriptions } from "../../prescriptions/queries.js";
import { RecordingPlayer } from "../../visits/voice/recording-player.js";
import { ImageGrid, isGalleryFile } from "./images.js";
import { NOTE_SECTIONS } from "./visit-session.js";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p360-vd-section" aria-label={title}>
      <h3 className="p360-label">{title}</h3>
      {children}
    </section>
  );
}

export function VisitDetail({ patientId, visit, onClose }: { patientId: PatientId; visit: Visit; onClose: () => void }) {
  const { can } = useClinic();
  const canBill = can("billing.read");
  const detail = useVisit(visit.id);
  const prescriptions = usePrescriptions(can("prescriptions.issue") || can("clinical.read") ? patientId : undefined);
  const invoices = useInvoices({ patientId }, canBill);
  const payments = usePayments({}, canBill);

  const rxs = (prescriptions.data?.items ?? []).filter((r) => r.encounter_id === visit.id);
  const bills = (invoices.data?.items ?? []).filter((i) => i.encounter_id === visit.id && i.status !== "void");
  const billIds = new Set(bills.map((b) => b.id));
  const paid = (payments.data?.items ?? []).filter((p) => p.status !== "void" && p.allocations.some((a) => billIds.has(a.invoice_id)));
  const images = (detail.data?.attachments ?? []).filter(isGalleryFile);
  const recordings = (detail.data?.attachments ?? []).filter((a) => a.kind === "audio");

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
        <p className="mk-hint" style={{ margin: 0 }}>
          {formatDateTime(visit.started_at)} · {visit.clinician.name} · {visit.status === "open" ? "Open" : "Closed"}
        </p>
        {detail.isPending ? (
          <SkeletonRows count={3} label="Loading the visit" />
        ) : detail.isError ? (
          <ApiErrorNotice title="Couldn't load this visit" error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <Section title="Notes">
              {detail.data.notes.length === 0 ? (
                <p className="mk-hint">No notes in this visit.</p>
              ) : (
                detail.data.notes.map((note) => (
                  <div key={note.id} className="p360-vd-note">
                    <p className="mk-hint" style={{ margin: "0 0 4px" }}>
                      {note.author.name} · {note.status === "signed" ? "Signed" : "Draft"}
                    </p>
                    {NOTE_SECTIONS.map(({ key, label }) => {
                      const text = note.sections[key];
                      return text == null || text.trim() === "" ? null : (
                        <p key={key} className="p360-vd-text">
                          <b>{label}: </b>
                          {text}
                        </p>
                      );
                    })}
                  </div>
                ))
              )}
              {recordings.length === 0 ? null : (
                <ul aria-label="Voice recordings" className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                  {recordings.map((recording) => (
                    <li key={recording.id}>
                      <RecordingPlayer recording={recording} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Treatments">
              {detail.data.procedures.length === 0 ? (
                <p className="mk-hint">No treatments recorded.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {detail.data.procedures.map((p) => (
                    <li key={p.id} className="p360-histrow">
                      <b>{p.name}</b>
                      {p.tooth == null ? null : <span className="mk-hint" style={{ margin: 0 }}>Tooth {p.tooth}</span>}
                      <Tag tone={statusTone(p.status === "done" ? "success" : "neutral")}>{p.status}</Tag>
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
                      </Link>{" "}
                      <span className="mk-hint" style={{ margin: 0 }}>
                        {rx.items.map((line) => `${line.drug_name ?? ""} ${line.strength ?? ""}`.trim()).join(" · ") || "No medicines"}
                      </span>
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
                    {paid.map((p) => (
                      <li key={p.id} className="p360-histrow">
                        <b>{p.number}</b>
                        <span>{formatRupees(p.amount_paise)}</span>
                        <span className="mk-hint" style={{ margin: 0 }}>
                          {p.method.toUpperCase()} · {formatDateTime(p.received_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            ) : null}
          </>
        )}
      </div>
    </Drawer>
  );
}
