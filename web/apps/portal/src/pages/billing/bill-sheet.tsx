import type { CSSProperties, ReactNode } from "react";

import type { ClinicSettings, LetterheadDocument } from "@aarogyam/api-client";

import "./bill-sheet.css";

/** What a printed bill or receipt says about the clinic, from its settings and letterhead (no fields of its own). */
export interface ClinicFacts {
  name: string;
  legalName: string | undefined;
  localName: string | undefined;
  address: string | undefined;
  phone: string | undefined;
  email: string | undefined;
  gstin: string | undefined;
  logo: string | undefined;
  /** The clinic's uploaded letterhead picture, which replaces the drawn header. */
  headerImage: string | undefined;
  footer: string | undefined;
  upi: string | undefined;
  accent: string;
}

const FALLBACK_ACCENT = "#136650";
const present = (text: string | null | undefined): text is string => text != null && text.trim() !== "";
const orUndefined = (text: string | null | undefined): string | undefined => (present(text) ? text : undefined);

export function clinicFacts(settings: ClinicSettings, document: LetterheadDocument | undefined): ClinicFacts {
  const name = document?.clinic.name ?? settings.name;
  const place = settings.address;
  const address = [place.line1, place.line2, place.city, place.state, place.pincode].filter(present).join(", ");
  const accent = document?.letterhead.accent ?? document?.brand ?? FALLBACK_ACCENT;
  const legalName = settings.legal_name ?? document?.clinic.legal_name;
  return {
    name,
    legalName: present(legalName) && legalName !== name ? legalName : undefined,
    localName: orUndefined(document?.letterhead.local_name),
    address: address === "" ? undefined : address,
    phone: orUndefined(settings.phone ?? document?.clinic.phone),
    email: orUndefined(document?.letterhead.email),
    gstin: orUndefined(settings.gstin ?? document?.clinic.gstin),
    logo: orUndefined(document?.logo_url),
    headerImage: document?.letterhead.mode === "upload" ? orUndefined(document.image_url) : undefined,
    footer: orUndefined(document?.letterhead.footer),
    upi: orUndefined(settings.upi_id),
    accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : FALLBACK_ACCENT,
  };
}

/** The first letter of the clinic's name, for when it has no logo. */
function monogram(name: string): string {
  const first = name.trim().codePointAt(0);
  return first === undefined ? "A" : String.fromCodePoint(first).toUpperCase();
}

/**
 * An A4 bill or receipt: the clinic's logo, name and contact details on top, the document's kind, number and date in a
 * band below, then `children`.
 */
export function BillSheet({ clinic, kind, number, date, isVoid = false, children }: { clinic: ClinicFacts; kind: string; number: string; date: string | undefined; isVoid?: boolean; children: ReactNode }) {
  const style: CSSProperties = Object.fromEntries([["--bp-accent", clinic.accent]]);
  return (
    <article className="bp-sheet" style={style} aria-label={`${kind} ${number}`}>
      {clinic.headerImage === undefined ? (
        <header className="bp-head">
          <div className="bp-brand">
            {clinic.logo === undefined ? (
              <span className="bp-mono" aria-hidden="true">
                {monogram(clinic.name)}
              </span>
            ) : (
              <img className="bp-logo" src={clinic.logo} alt={`${clinic.name} logo`} />
            )}
            <div>
              <h1>{clinic.name}</h1>
              {clinic.localName === undefined ? null : <p className="bp-local">{clinic.localName}</p>}
              {clinic.legalName === undefined ? null : <p className="bp-legal">{clinic.legalName}</p>}
            </div>
          </div>
          <address className="bp-contact">
            {clinic.address === undefined ? null : <span>{clinic.address}</span>}
            {clinic.phone === undefined ? null : <span>Phone {clinic.phone}</span>}
            {clinic.email === undefined ? null : <span>{clinic.email}</span>}
            {clinic.gstin === undefined ? null : <span>GSTIN {clinic.gstin}</span>}
          </address>
        </header>
      ) : (
        <header className="bp-head bp-head-image">
          <img className="bp-upload" src={clinic.headerImage} alt={`${clinic.name} letterhead`} />
          <h1 className="bp-sr">{clinic.name}</h1>
        </header>
      )}
      <div className="bp-band">
        <h2>
          {kind}
          {isVoid ? <span className="bp-void">Void</span> : null}
        </h2>
        <dl>
          <div>
            <dt>No.</dt>
            <dd className="bp-num">{number}</dd>
          </div>
          {date === undefined ? null : (
            <div>
              <dt>Date</dt>
              <dd>{date}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="bp-body">{children}</div>
    </article>
  );
}

/** Who signs: the treating doctor, or the clinic when the document names no doctor. */
export interface Signer {
  name: string;
  line: string | undefined;
}

/** The foot of a bill or receipt: how to pay, a thank-you line and the clinic's own footer, and the signature block. */
export function BillFooter({ clinic, signer }: { clinic: ClinicFacts; signer: Signer | undefined }) {
  return (
    <footer className="bp-foot">
      <div className="bp-foot-note">
        {clinic.upi === undefined ? null : (
          <p>
            Pay by UPI: <b>{clinic.upi}</b>
          </p>
        )}
        <p className="bp-thanks">Thank you for choosing {clinic.name}. Wishing you good health.</p>
        {clinic.footer === undefined ? null : <p>{clinic.footer}</p>}
      </div>
      <div className="bp-sign">
        <div className="bp-sign-space" aria-hidden="true" />
        <p className="bp-sign-name">{signer?.name ?? clinic.name}</p>
        {signer?.line === undefined ? null : <p className="bp-sign-line">{signer.line}</p>}
        <p className="bp-sign-role">Authorised signatory</p>
      </div>
    </footer>
  );
}
