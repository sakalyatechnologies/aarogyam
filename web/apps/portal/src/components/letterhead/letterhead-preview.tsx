// moves to sakalya-web (with the sheet): a live preview of a letterhead on a sample page.
import type { LetterheadDocument } from "@aarogyam/api-client";

import { LetterheadSheet } from "./letterhead.js";
import { SAMPLE_PRESCRIPTION, withSampleDoctors } from "./sample.js";

/**
 * The letterhead on a sample prescription, so a clinic sees what patients will get before saving.
 * Pass the document with the unsaved choices applied for a live preview. Shows made-up people only.
 */
export function LetterheadPreview({
  document,
  label = "Letterhead preview",
}: {
  document: LetterheadDocument;
  label?: string;
}) {
  const sample = SAMPLE_PRESCRIPTION;
  return (
    <figure aria-label={label} style={{ margin: 0 }}>
      <LetterheadSheet document={withSampleDoctors(document)}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1em",
            flexWrap: "wrap",
            fontSize: "0.95em",
          }}
        >
          <div>
            <b>{sample.patient}</b>
            <div className="lh-muted lh-small">Sample prescription</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <b>{sample.number}</b>
            <div className="lh-muted lh-small">{sample.date}</div>
          </div>
        </div>
        <p className="lh-small" style={{ margin: "1em 0 0.4em" }}>
          Diagnosis: {sample.diagnosis}
        </p>
        <ol style={{ margin: 0, paddingLeft: "1.3em" }}>
          {sample.items.map((item) => (
            <li key={item.name} style={{ marginBottom: "0.5em" }}>
              <b>{item.name}</b>
              <div className="lh-muted lh-small">{item.dose}</div>
            </li>
          ))}
        </ol>
        <p className="lh-small" style={{ marginTop: "1em" }}>
          Advice: {sample.advice}
        </p>
      </LetterheadSheet>
      <figcaption className="mk-hint" style={{ textAlign: "center" }}>
        Sample content only. Your patients' prescriptions use the same header
        and footer.
      </figcaption>
    </figure>
  );
}
