/**
 * The patient's visit page at `/shared/{token}`: why they came, what was done, their plan with
 * estimates, care at home and medicines. It opens straight from the link, with no PIN (the long
 * random token is the secret). Patients open it from WhatsApp on
 * any phone, so it is its own small entry (`shared.html`), with no router, query library or UI
 * kit. Links of other kinds (prescriptions, records) go to the full portal page.
 */
import { useRef, useEffect, useState } from "react";

import { brushHighlight, brushingBand } from "@aarogyam/app-kit/mouth-view";

import { answerPlan, openVisit, previewLink, type Failure, type PlanChoice, type Visit } from "./public-client.js";
import { OffersSection } from "./offers-section.js";
import { BrushingBlock, MouthHero, ToothRow, foundRows } from "./mouth-sections.js";
import { dayWords, doses, firstName, rupees, timingWords, toothWords } from "./words.js";

type Stage =
  | { readonly kind: "loading" }
  | { readonly kind: "open"; readonly visit: Visit }
  | { readonly kind: "stopped"; readonly failure: Failure; readonly clinicName?: string };

/** The token in `/shared/{token}`, or empty. */
export function tokenFromPath(pathname: string): string {
  const match = /^\/shared\/([^/?#]+)/.exec(pathname);
  return match?.[1] === undefined ? "" : decodeURIComponent(match[1]);
}

/** The full portal page for a link this page doesn't show. */
export const fullPageUrl = (token: string) => `/shared/${encodeURIComponent(token)}?full=1`;

const leavePage = (url: string) => {
  window.location.replace(url);
};

export function VisitPage({ token, leave = leavePage }: { token: string; leave?: (url: string) => void }) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void previewLink(token).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setStage({ kind: "stopped", failure: result.failure });
      } else if (result.value.resource !== "visit") {
        leave(fullPageUrl(token));
      } else if (result.value.state === "expired" || result.value.state === "revoked") {
        setStage({ kind: "stopped", failure: { kind: "expired" }, clinicName: result.value.clinicName });
      } else if (result.value.state === "locked") {
        setStage({ kind: "stopped", failure: { kind: "locked" }, clinicName: result.value.clinicName });
      } else {
        // The preview holds no data; the visit itself comes only from this POST.
        const clinicName = result.value.clinicName;
        void openVisit(token).then((opened) => {
          if (!live) return;
          setStage(opened.ok ? { kind: "open", visit: opened.value } : { kind: "stopped", failure: opened.failure, clinicName });
        });
      }
    });
    return () => {
      live = false;
    };
  }, [token, leave]);

  useEffect(() => {
    document.title = stage.kind === "open" ? `Your visit · ${stage.visit.clinicName}` : "Your visit";
  }, [stage]);

  switch (stage.kind) {
    case "loading":
      return (
        <main className="vp">
          <p className="vp-status" role="status">
            Opening your visit…
          </p>
        </main>
      );
    case "stopped":
      return <Stopped failure={stage.failure} clinicName={stage.clinicName} />;
    case "open":
      return <VisitStory visit={stage.visit} token={token} />;
  }
}

const STOPPED: Readonly<Record<Failure["kind"], { title: string; body: string }>> = {
  locked: { title: "This link is locked", body: "Please ask the clinic to send a new link." },
  expired: { title: "This link has expired", body: "For your privacy, links work for a few days. Please ask the clinic for a new one." },
  missing: { title: "We couldn't find this link", body: "Please check the link in your message, or ask the clinic to send it again." },
  offline: { title: "No connection", body: "Check your internet and open the link again." },
};

function Stopped({ failure, clinicName }: { failure: Failure; clinicName?: string | undefined }) {
  const words = STOPPED[failure.kind];
  return (
    <main className="vp">
      <section className="vp-card vp-gate" role="alert">
        {clinicName === undefined || clinicName === "" ? null : <p className="vp-eyebrow">{clinicName}</p>}
        <h1 className="vp-title">{words.title}</h1>
        <p className="vp-muted">{words.body}</p>
      </section>
    </main>
  );
}

const digits = (phone: string) => phone.replace(/\D/g, "");

/** The booking page on this host, with the visit's doctor chosen; never carries the token. */
export function bookingUrl(visit: Visit): string | undefined {
  if (visit.bookingPath === null || visit.bookingPath === undefined) return undefined;
  const path = visit.bookingPath.startsWith("/") ? visit.bookingPath : "/book";
  return visit.practitionerId === null || visit.practitionerId === undefined
    ? path
    : `${path}?practitioner=${encodeURIComponent(visit.practitionerId)}`;
}

const SLOTS = ["Morning", "Afternoon", "Night"];

function VisitStory({ visit, token }: { visit: Visit; token: string }) {
  const book = bookingUrl(visit);
  const total = visit.plan.reduce((sum, item) => sum + (item.estimatePaise ?? 0), 0);
  const phone = visit.clinicPhone === null || visit.clinicPhone === undefined ? undefined : visit.clinicPhone;
  const name = firstName(visit.patientName);
  const chart = visit.chart;
  const hero = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ tooth: number; nonce: number } | undefined>(undefined);
  const openTooth = (tooth: number) => {
    setOpen((before) => ({ tooth, nonce: (before?.nonce ?? 0) + 1 }));
  };
  const showHero = () => {
    const box = hero.current?.getBoundingClientRect();
    if (box === undefined || (box.top >= 0 && box.top < window.innerHeight * 0.5)) return;
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    hero.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };
  const found = foundRows(chart);
  const canOpen = chart !== undefined;
  const careSteps = visit.aftercare.flatMap((care) => care.steps);
  const band = brushingBand(chart, visit.aftercare.map((care) => care.key));
  return (
    <main className={chart === undefined ? "vp" : "vp vp-has-chart"}>
      <header className="vp-hero vp-reveal">
        <p className="vp-eyebrow">{visit.clinicName}</p>
        <h1 className="vp-title">Hi {firstName(visit.patientName)}, here's your visit</h1>
        <p className="vp-muted">
          {dayWords(visit.visitedOn)}
          {visit.doctorName === null || visit.doctorName === undefined ? "" : ` · ${visit.doctorName}`} · {visit.visitNumber}
        </p>
      </header>

      {chart === undefined ? null : (
        <div ref={hero} className="vp-hero-mouth vp-reveal">
          <MouthHero chart={chart} name={name} open={open} onScreen={showHero} />
        </div>
      )}

      {visit.chiefComplaint === null || visit.chiefComplaint === undefined ? null : (
        <Section title="Why you came">
          <p>{visit.chiefComplaint}</p>
        </Section>
      )}

      {visit.treatments.length === 0 ? null : (
        <Section title="Done today">
          <ul className="vp-list">
            {visit.treatments.map((treatment, index) => (
              <ToothRow key={index} tooth={treatment.tooth} canOpen={canOpen} onOpen={openTooth} dot="vp-dot vp-dot-done">
                <strong>{treatment.name}</strong>
                {toothWords(treatment.tooth) === undefined ? null : <span className="vp-muted"> · {toothWords(treatment.tooth)}</span>}
              </ToothRow>
            ))}
          </ul>
        </Section>
      )}

      {found.length === 0 ? null : (
        <Section title="What we found">
          <ul className="vp-list">
            {found.map((row) => (
              <ToothRow key={row.tooth} tooth={row.tooth} canOpen={canOpen} onOpen={openTooth} dot="vp-dot vp-dot-found">
                <strong>{row.words}</strong>
                <span className="vp-muted"> · {row.where}</span>
              </ToothRow>
            ))}
          </ul>
        </Section>
      )}

      {visit.plan.length === 0 ? null : (
        <Section title="Your plan">
          <ol className="vp-list vp-plan">
            {visit.plan.map((item) => (
              <ToothRow
                key={item.id}
                tooth={item.tooth}
                canOpen={canOpen}
                onOpen={openTooth}
                dot="vp-dot"
                end={item.estimatePaise === null || item.estimatePaise === undefined || item.estimatePaise <= 0 ? undefined : <span className="vp-price">{rupees(item.estimatePaise)}</span>}
              >
                <strong>{item.name}</strong>
                {toothWords(item.tooth) === undefined ? null : <span className="vp-muted"> · {toothWords(item.tooth)}</span>}
              </ToothRow>
            ))}
          </ol>
          {total > 0 ? <p className="vp-fine">Estimate {rupees(total)} in all; the final cost is confirmed after examination.</p> : null}
          {visit.followUpOn === null || visit.followUpOn === undefined ? null : (
            <p className="vp-next">Next visit due by {dayWords(visit.followUpOn)}</p>
          )}
          <PlanReply token={token} phone={phone} />
          {book === undefined ? null : (
            <a className="vp-button vp-button-wide" href={book}>
              Book my next visit
            </a>
          )}
        </Section>
      )}

      <OffersSection visit={visit} />

      {visit.discussed.map((row, index) => (
        <Section key={index} title={row.tooth === null || row.tooth === undefined ? row.title : `${row.title} (tooth ${String(row.tooth)})`}>
          <ul className="vp-steps">
            {row.options.map((option) => (
              <li key={option.label}>
                <strong>{option.label}</strong>
                {option.material === null || option.material === undefined ? null : <span className="vp-muted"> · {option.material}</span>}
                {option.preferred ? <span className="vp-muted"> · you prefer this</span> : null}
                <br />
                {option.summary} {option.looksLike} {option.comfort}
                {option.fromPaise === null || option.fromPaise === undefined ? null : <span className="vp-muted"> From {rupees(option.fromPaise)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {visit.aftercare.length === 0 && chart === undefined ? null : (
        <Section title="Care at home">
          {chart === undefined ? null : <BrushingBlock band={band} highlight={brushHighlight(chart, careSteps)} name={name} />}
          {visit.aftercare.map((care) => (
            <div key={care.key} className="vp-care">
              <h3 className="vp-care-title">{care.title}</h3>
              <ul className="vp-steps">
                {care.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ul>
              {care.callIf === null || care.callIf === undefined ? null : <p className="vp-call-if">{care.callIf}</p>}
            </div>
          ))}
        </Section>
      )}

      {visit.medicines.length === 0 ? null : (
        <Section title="Your medicines">
          <ul className="vp-meds">
            {visit.medicines.map((medicine, index) => {
              const plan = doses(medicine.frequency);
              return (
                <li key={index} className="vp-med">
                  <p>
                    <strong>{medicine.name}</strong>
                    {medicine.strength === null || medicine.strength === undefined ? null : <span className="vp-muted"> {medicine.strength}</span>}
                  </p>
                  {plan === undefined || plan.length !== 3 ? (
                    <p className="vp-muted">{[medicine.dose, medicine.frequency].filter(Boolean).join(" · ")}</p>
                  ) : (
                    <div className="vp-slots" role="list">
                      {plan.map((count, slot) => (
                        <span key={slot} role="listitem" className={count > 0 ? "vp-slot vp-slot-on" : "vp-slot"}>
                          {SLOTS[slot]}
                          <b>{count > 0 ? count : "–"}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="vp-fine">
                    {[timingWords(medicine.timing), medicine.durationDays === null || medicine.durationDays === undefined ? undefined : `for ${String(medicine.durationDays)} days`]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {phone === undefined && book === undefined ? null : (
        <Section title="Talk to us">
          <div className="vp-actions">
            {phone === undefined ? null : (
              <>
                <a className="vp-button vp-button-soft" href={`tel:${phone}`}>
                  Call the clinic
                </a>
                <a className="vp-button vp-button-soft" href={`https://wa.me/${digits(phone)}`} rel="noreferrer">
                  WhatsApp the clinic
                </a>
              </>
            )}
            {book === undefined || visit.plan.length > 0 ? null : (
              <a className="vp-button" href={book}>
                Book a visit
              </a>
            )}
          </div>
        </Section>
      )}

      <footer className="vp-foot">
        <p>This link works until {dayWords(visit.expiresAt)}. It opens your health record, so please don't forward it.</p>
      </footer>
    </main>
  );
}

const ANSWER_FAILED: Readonly<Record<Failure["kind"], string>> = {
  locked: "This link is locked. Please ask the clinic for a new link.",
  expired: "This link has expired. Please ask the clinic for a new one.",
  missing: "We couldn't send your answer. Please call the clinic.",
  offline: "No connection. Check your internet and try again.",
};

/** "Go ahead" or "I have a question" about the plan. */
function PlanReply({ token, phone }: { token: string; phone: string | undefined }) {
  const [busy, setBusy] = useState<PlanChoice>();
  const [answered, setAnswered] = useState<PlanChoice>();
  const [error, setError] = useState<string>();

  const send = (choice: PlanChoice) => {
    if (busy !== undefined) return;
    setBusy(choice);
    setError(undefined);
    void answerPlan(token, choice).then((result) => {
      setBusy(undefined);
      if (result.ok) {
        setAnswered(result.value.choice);
      } else {
        setError(ANSWER_FAILED[result.failure.kind]);
      }
    });
  };

  if (answered !== undefined) {
    return (
      <div className="vp-reply">
        <p className="vp-thanks" role="status">
          {answered === "go_ahead" ? "Thanks, the clinic will call you to book." : "Thanks, the clinic will get back to you."}
        </p>
        {answered === "question" && phone !== undefined ? (
          <a className="vp-button vp-button-wide" href={`https://wa.me/${digits(phone)}`} rel="noreferrer">
            WhatsApp the clinic
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <div className="vp-reply">
      <div className="vp-actions">
        <button
          className="vp-button"
          type="button"
          disabled={busy !== undefined}
          onClick={() => {
            send("go_ahead");
          }}
        >
          {busy === "go_ahead" ? "Sending…" : "Yes, I want to go ahead"}
        </button>
        <button
          className="vp-button vp-button-soft"
          type="button"
          disabled={busy !== undefined}
          onClick={() => {
            send("question");
          }}
        >
          {busy === "question" ? "Sending…" : "I have a question"}
        </button>
      </div>
      {error === undefined ? null : (
        <p className="vp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vp-card vp-reveal" aria-label={title}>
      <h2 className="vp-h2">{title}</h2>
      {children}
    </section>
  );
}
