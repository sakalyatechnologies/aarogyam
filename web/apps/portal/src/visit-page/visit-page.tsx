/**
 * The patient's visit page at `/shared/{token}`: why they came, what was done, their plan with
 * estimates, care at home and medicines, behind the link's PIN. Patients open it from WhatsApp on
 * any phone, so it is its own small entry (`shared.html`), with no router, query library or UI
 * kit. Links of other kinds (prescriptions, records) go to the full portal page.
 */
import { useEffect, useState, type SubmitEvent } from "react";

import { openVisit, previewLink, type Failure, type Visit } from "./public-client.js";
import { dayWords, doses, firstName, rupees, timingWords, toothWords } from "./words.js";

type Stage =
  | { readonly kind: "loading" }
  | { readonly kind: "pin"; readonly clinicName: string }
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
        setStage({ kind: "pin", clinicName: result.value.clinicName });
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
    case "pin":
      return (
        <PinGate
          clinicName={stage.clinicName}
          token={token}
          onOpened={(visit) => {
            setStage({ kind: "open", visit });
          }}
          onStopped={(failure) => {
            setStage({ kind: "stopped", failure, clinicName: stage.clinicName });
          }}
        />
      );
    case "stopped":
      return <Stopped failure={stage.failure} clinicName={stage.clinicName} />;
    case "open":
      return <VisitStory visit={stage.visit} />;
  }
}

function PinGate({ clinicName, token, onOpened, onStopped }: { clinicName: string; token: string; onOpened: (visit: Visit) => void; onStopped: (failure: Failure) => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    setError(undefined);
    void openVisit(token, pin).then((result) => {
      setBusy(false);
      if (result.ok) {
        onOpened(result.value);
      } else if (result.failure.kind === "wrong_pin") {
        setError(result.failure.message);
        setPin("");
      } else if (result.failure.kind === "offline") {
        setError("No connection. Check your internet and try again.");
      } else {
        onStopped(result.failure);
      }
    });
  };

  return (
    <main className="vp">
      <section className="vp-card vp-gate">
        <p className="vp-eyebrow">{clinicName}</p>
        <h1 className="vp-title">Your visit summary</h1>
        <p className="vp-muted">Enter the 6-digit PIN from your message.</p>
        <form onSubmit={submit} className="vp-pin-form">
          <label className="vp-sr" htmlFor="vp-pin">
            PIN
          </label>
          <input
            id="vp-pin"
            className="vp-pin"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            }}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? undefined : "vp-pin-error"}
          />
          <button className="vp-button" type="submit" disabled={pin.length !== 6 || busy}>
            {busy ? "Opening…" : "Open"}
          </button>
        </form>
        {error === undefined ? null : (
          <p id="vp-pin-error" className="vp-error" role="alert">
            {error}
          </p>
        )}
        <p className="vp-fine">This link opens your health record. Please don't forward it.</p>
      </section>
    </main>
  );
}

const STOPPED: Readonly<Record<Failure["kind"], { title: string; body: string }>> = {
  wrong_pin: { title: "That PIN didn't match", body: "Please try again." },
  locked: { title: "This link is locked", body: "Too many wrong PINs. Please ask the clinic to send a new link." },
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

function VisitStory({ visit }: { visit: Visit }) {
  const book = bookingUrl(visit);
  const total = visit.plan.reduce((sum, item) => sum + (item.estimatePaise ?? 0), 0);
  const phone = visit.clinicPhone === null || visit.clinicPhone === undefined ? undefined : visit.clinicPhone;
  return (
    <main className="vp">
      <header className="vp-hero vp-reveal">
        <p className="vp-eyebrow">{visit.clinicName}</p>
        <h1 className="vp-title">Hi {firstName(visit.patientName)}, here's your visit</h1>
        <p className="vp-muted">
          {dayWords(visit.visitedOn)}
          {visit.doctorName === null || visit.doctorName === undefined ? "" : ` · ${visit.doctorName}`} · {visit.visitNumber}
        </p>
      </header>

      {visit.chiefComplaint === null || visit.chiefComplaint === undefined ? null : (
        <Section title="Why you came">
          <p>{visit.chiefComplaint}</p>
        </Section>
      )}

      {visit.treatments.length === 0 ? null : (
        <Section title="What we did today">
          <ul className="vp-list">
            {visit.treatments.map((treatment, index) => (
              <li key={index} className="vp-item">
                <span className="vp-dot vp-dot-done" aria-hidden="true" />
                <span>
                  <strong>{treatment.name}</strong>
                  {toothWords(treatment.tooth) === undefined ? null : <span className="vp-muted"> · {toothWords(treatment.tooth)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {visit.plan.length === 0 ? null : (
        <Section title="Your plan">
          <ol className="vp-list vp-plan">
            {visit.plan.map((item) => (
              <li key={item.id} className="vp-item">
                <span className="vp-dot" aria-hidden="true" />
                <span className="vp-grow">
                  <strong>{item.name}</strong>
                  {toothWords(item.tooth) === undefined ? null : <span className="vp-muted"> · {toothWords(item.tooth)}</span>}
                </span>
                {item.estimatePaise === null || item.estimatePaise === undefined || item.estimatePaise <= 0 ? null : (
                  <span className="vp-price">{rupees(item.estimatePaise)}</span>
                )}
              </li>
            ))}
          </ol>
          {total > 0 ? <p className="vp-fine">Estimate {rupees(total)} in all; the final cost is confirmed after examination.</p> : null}
          {visit.followUpOn === null || visit.followUpOn === undefined ? null : (
            <p className="vp-next">Next visit due by {dayWords(visit.followUpOn)}</p>
          )}
          {book === undefined ? null : (
            <a className="vp-button vp-button-wide" href={book}>
              Book my next visit
            </a>
          )}
        </Section>
      )}

      {visit.aftercare.length === 0 ? null : (
        <Section title="Care at home">
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vp-card vp-reveal" aria-label={title}>
      <h2 className="vp-h2">{title}</h2>
      {children}
    </section>
  );
}
