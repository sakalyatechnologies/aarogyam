// Aarogyam-owned. One layout for every legal page, rendered from data (see ./privacy.ts and friends).
import { Fragment } from "react";

import "./legal.css";
import { LEGAL_DOCS, DRAFT_NOTICE, type Block, type LegalDoc } from "./index";
import { legalPath } from "./paths";
import { LAST_UPDATED } from "./shared";

/** Text with its [placeholders] marked, so nobody ships one by accident. */
export function Marked({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("[") && part.endsWith("]") ? (
          <mark key={index} className="legal-ph">{part}</mark>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p><Marked text={block.text} /></p>;
    case "note":
      return <p className="legal-note"><Marked text={block.text} /></p>;
    case "ul":
      return <ul>{block.items.map((item) => <li key={item}><Marked text={item} /></li>)}</ul>;
    case "ol":
      return <ol>{block.items.map((item) => <li key={item}><Marked text={item} /></li>)}</ol>;
    case "table":
      return (
        <div className="legal-table" role="region" tabIndex={0} aria-label="Table">
          <table>
            <thead><tr>{block.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>{row.map((cell, index) => <td key={index}><Marked text={cell} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="legal-page">
      <div className="legal-wrap">
        <p className="legal-draft" role="note"><strong>{DRAFT_NOTICE}</strong> · Placeholders are shown <mark className="legal-ph">[like this]</mark>.</p>
        <p className="legal-crumb"><a href="/legal">Legal</a></p>
        <h1 className="font-d">{doc.title}</h1>
        <p className="legal-aud">{doc.audience}</p>
        <p className="legal-meta">Last updated: <Marked text={LAST_UPDATED} />. Applies in India.</p>
        <nav className="legal-toc" aria-label="On this page">
          <ol>{doc.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol>
        </nav>
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`}>
            <h2 id={`${section.id}-h`}>{section.title}</h2>
            {section.blocks.map((block, index) => <BlockView key={index} block={block} />)}
          </section>
        ))}
        {doc.slug === "patient-notice" ? (
          <p className="legal-print"><button type="button" className="btn ghost" onClick={() => window.print()}>Print this notice</button></p>
        ) : null}
        <nav className="legal-more" aria-label="Other legal pages">
          {LEGAL_DOCS.filter((other) => other.slug !== doc.slug).map((other) => (
            <a key={other.slug} href={legalPath(other.slug)}>{other.title}</a>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** The index at /legal. */
export function LegalIndex() {
  return (
    <div className="legal-page">
      <div className="legal-wrap">
        <p className="legal-draft" role="note"><strong>{DRAFT_NOTICE}</strong></p>
        <h1 className="font-d">Legal</h1>
        <p className="legal-aud">How Aarogyam handles personal data, written in plain language for India. Aarogyam is run by Sakalya Technologies. Clinics are the data fiduciaries for their patients under the Digital Personal Data Protection Act, 2023; Sakalya is their processor.</p>
        <ul className="legal-index">
          {LEGAL_DOCS.map((doc) => (
            <li key={doc.slug}>
              <a href={legalPath(doc.slug)}>{doc.title}</a>
              <span>{doc.summary}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
