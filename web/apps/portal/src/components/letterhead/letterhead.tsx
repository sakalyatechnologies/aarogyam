// moves to sakalya-web: the sheet, the six header designs and the sample are generic once
// `LetterheadDocument` is replaced by a product-neutral "letterhead data" type.
import type { CSSProperties, ReactNode } from "react";

import type {
  LetterheadDocument,
  LetterheadTemplate,
} from "@aarogyam/api-client";

import "./letterhead.css";

/** The designs a clinic can pick, in picker order, with the names pickers show. */
export const LETTERHEAD_TEMPLATES: readonly {
  id: LetterheadTemplate;
  name: string;
  hint: string;
}[] = [
  {
    id: "logo_left",
    name: "Logo and doctors",
    hint: "Logo on the left, doctor block on the right",
  },
  {
    id: "classic",
    name: "Classic centred",
    hint: "Centred serif name with a double rule",
  },
  {
    id: "modern_band",
    name: "Modern band",
    hint: "A coloured band across the top",
  },
  {
    id: "minimal_line",
    name: "Minimal line",
    hint: "One quiet line, lots of room",
  },
  {
    id: "two_doctor",
    name: "Two doctors",
    hint: "Two doctor blocks side by side",
  },
  {
    id: "bilingual",
    name: "Bilingual",
    hint: "Clinic name in two scripts, such as English and Hindi",
  },
];

const FALLBACK_ACCENT = "#136650";

/** `#RRGGBB` as relative luminance, for choosing dark or light text on the accent. */
function luminance(colour: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(colour.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function accentOf(document: LetterheadDocument): string {
  const picked =
    document.letterhead.accent ?? document.brand ?? FALLBACK_ACCENT;
  return /^#[0-9a-fA-F]{6}$/.test(picked) ? picked : FALLBACK_ACCENT;
}

function present(value: string | null | undefined): value is string {
  return value != null && value !== "";
}

interface Parts {
  name: string;
  local: string | undefined;
  address: string | undefined;
  phone: string | undefined;
  email: string | undefined;
  timings: string | undefined;
  gstin: string | undefined;
  doctors: { name: string; line: string | undefined }[];
  logo: string | undefined;
}

/** Only what the clinic chose to show, ready to lay out. */
function partsOf(document: LetterheadDocument): Parts {
  const { clinic, letterhead, doctors } = document;
  const show = letterhead.show;
  const address = [
    clinic.address.line1,
    clinic.address.line2,
    clinic.address.city,
    clinic.address.state,
    clinic.address.pincode,
  ]
    .filter(present)
    .join(", ");
  return {
    name: clinic.name,
    local: present(letterhead.local_name) ? letterhead.local_name : undefined,
    address: show.address && address !== "" ? address : undefined,
    phone: show.phone && present(clinic.phone) ? clinic.phone : undefined,
    email:
      show.email && present(letterhead.email) ? letterhead.email : undefined,
    timings:
      show.timings && present(letterhead.timings)
        ? letterhead.timings
        : undefined,
    gstin: show.gstin && present(clinic.gstin) ? clinic.gstin : undefined,
    doctors: show.doctors
      ? doctors.map((doctor) => ({
          name: doctor.name,
          line: [
            doctor.qualifications,
            show.registration && present(doctor.registration_number)
              ? `Reg. No. ${doctor.registration_number}`
              : undefined,
          ]
            .filter(present)
            .join(" · "),
        }))
      : [],
    logo:
      show.logo && present(document.logo_url) ? document.logo_url : undefined,
  };
}

/** The first letter of the clinic's name, for when there is no logo. */
function monogram(name: string): string {
  const first = name.trim().codePointAt(0);
  return first === undefined ? "A" : String.fromCodePoint(first).toUpperCase();
}

function Logo({ parts }: { parts: Parts }) {
  if (parts.logo !== undefined) {
    return (
      <img className="lh-logo" src={parts.logo} alt={`${parts.name} logo`} />
    );
  }
  return (
    <span className="lh-mono" aria-hidden="true">
      {monogram(parts.name)}
    </span>
  );
}

function Doctors({ parts, limit }: { parts: Parts; limit?: number }) {
  return parts.doctors.slice(0, limit).map((doctor) => (
    <p key={doctor.name} className="lh-doc">
      <b>{doctor.name}</b>
      {doctor.line === undefined || doctor.line === "" ? null : (
        <span>{doctor.line}</span>
      )}
    </p>
  ));
}

function Contact({ parts, bare = false }: { parts: Parts; bare?: boolean }) {
  const lines = [
    parts.address,
    parts.phone,
    parts.email,
    parts.timings,
    parts.gstin === undefined ? undefined : `GSTIN ${parts.gstin}`,
  ].filter(present);
  return lines.map((line) => (
    <p key={line} className={`lh-line lh-small ${bare ? "" : "lh-muted"}`}>
      {line}
    </p>
  ));
}

function Names({ parts }: { parts: Parts }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h2 className="lh-name">{parts.name}</h2>
      {parts.local === undefined ? null : (
        <p className="lh-local" lang="hi">
          {parts.local}
        </p>
      )}
    </div>
  );
}

function Design({
  template,
  parts,
}: {
  template: LetterheadTemplate;
  parts: Parts;
}) {
  switch (template) {
    case "logo_left":
      return (
        <div className="lh-head">
          <div className="lh-logo-left">
            <div className="lh-id">
              <Logo parts={parts} />
              <div style={{ minWidth: 0 }}>
                <Names parts={parts} />
                <Contact parts={parts} />
              </div>
            </div>
            <div className="lh-docs">
              <Doctors parts={parts} />
            </div>
          </div>
        </div>
      );
    case "classic":
      return (
        <div className="lh-head">
          <div className="lh-classic">
            <Logo parts={parts} />
            <Names parts={parts} />
            <div className="lh-docs">
              <Doctors parts={parts} />
            </div>
            <Contact parts={parts} />
          </div>
        </div>
      );
    case "modern_band":
      return (
        <div className="lh-band-wrap">
          <div className="lh-band">
            <div className="lh-id">
              <Logo parts={parts} />
              <Names parts={parts} />
            </div>
            <div className="lh-contact">
              <Contact parts={parts} bare />
            </div>
          </div>
          {parts.doctors.length === 0 ? null : (
            <div className="lh-band-docs">
              <Doctors parts={parts} />
            </div>
          )}
        </div>
      );
    case "minimal_line":
      return (
        <div className="lh-head">
          <div className="lh-minimal">
            <h2 className="lh-name">{parts.name}</h2>
            <div className="lh-contact">
              <Contact parts={parts} />
            </div>
            {parts.doctors.length === 0 ? null : (
              <div className="lh-docs">
                <Doctors parts={parts} />
              </div>
            )}
          </div>
        </div>
      );
    case "two_doctor":
      return (
        <div className="lh-head">
          <div className="lh-two">
            <div className="lh-top">
              <Logo parts={parts} />
              <Names parts={parts} />
            </div>
            {parts.doctors.length === 0 ? null : (
              <div className="lh-pair">
                <Doctors parts={parts} limit={2} />
              </div>
            )}
            <div className="lh-contact">
              <Contact parts={parts} />
            </div>
          </div>
        </div>
      );
    case "bilingual":
      return (
        <div className="lh-head">
          <div className="lh-bi">
            <div className="lh-id">
              <Logo parts={parts} />
              <Names parts={parts} />
            </div>
            <div className="lh-docs">
              <Doctors parts={parts} />
            </div>
            <Contact parts={parts} />
          </div>
        </div>
      );
  }
}

/** The clinic's header: its uploaded letterhead image, or the chosen design filled from its details. */
export function LetterheadHeader({
  document,
}: {
  document: LetterheadDocument;
}) {
  const { letterhead } = document;
  if (letterhead.mode === "upload" && present(document.image_url)) {
    return (
      <img
        className="lh-upload"
        src={document.image_url}
        alt={`${document.clinic.name} letterhead`}
      />
    );
  }
  return <Design template={letterhead.template} parts={partsOf(document)} />;
}

/** The footer line, when the clinic set one. */
export function LetterheadFooter({
  document,
}: {
  document: LetterheadDocument;
}) {
  const footer = document.letterhead.footer;
  return present(footer) ? (
    <div className="lh-foot">{footer}</div>
  ) : (
    <div className="lh-foot lh-foot-empty" />
  );
}

export interface LetterheadSheetProps {
  document: LetterheadDocument;
  /** The page content between header and footer. */
  children?: ReactNode;
  /** A small, non-interactive rendering for pickers. */
  thumbnail?: boolean;
  className?: string;
}

/** A paper page: the clinic letterhead on top, `children` in the body, the footer at the bottom. */
export function LetterheadSheet({
  document,
  children,
  thumbnail = false,
  className = "",
}: LetterheadSheetProps) {
  const accent = accentOf(document);
  const style: CSSProperties = Object.fromEntries([
    ["--lh-accent", accent],
    ["--lh-on-accent", luminance(accent) > 0.45 ? "#14201b" : "#ffffff"],
  ]);
  return (
    <article
      className={`lh-sheet ${thumbnail ? "lh-thumb" : ""} ${className}`}
      style={style}
      aria-hidden={thumbnail ? true : undefined}
    >
      <div className="lh-page">
        <LetterheadHeader document={document} />
        <div className="lh-body">{children}</div>
        <LetterheadFooter document={document} />
      </div>
    </article>
  );
}
