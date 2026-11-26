// The doctor-only buttons of Show patient (Edit on a tooth, Go with this). Lazy, so the patient's route and the phone bundle
// never carry them; they are asked for only when the portal provides the actions.
import type { ReactElement } from "react";

export function EditButton({ tooth, onEdit }: { tooth: number; onEdit: (fdi: number) => void }): ReactElement {
  return (
    <button type="button" className="pm-chip ps-edit" aria-label={`Edit tooth ${String(tooth)}`} onClick={() => { onEdit(tooth); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Edit
    </button>
  );
}

export function GoButton({ onGo }: { onGo: () => void }): ReactElement {
  return <button type="button" className="pm-chip ps-opt-go" onClick={onGo}>Go with this</button>;
}
