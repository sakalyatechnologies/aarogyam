import { History } from "lucide-react";

import type { NoteSections, PatientId, VisitId } from "@aarogyam/api-client";

import { useQuickPicks } from "../../walk-in-queries.js";
import { usePatientNotes } from "../patients/queries.js";
import "../../components/quick-picks.css";

export type PickSection = "subjective" | "objective" | "plan";

/**
 * One-tap note lines from the specialty's quick picks (complaints, findings, advice), plus "Same as last visit",
 * which carries the complaint and plan forward from the patient's previous signed note. The doctor edits after.
 */
export function QuickPickBar({
  patientId,
  visitId,
  onPick,
}: {
  patientId: PatientId;
  visitId: VisitId;
  onPick: (section: PickSection, text: string) => void;
}) {
  const picks = useQuickPicks();
  const notes = usePatientNotes(patientId);
  const last = notes.data?.visit_notes.find((note) => note.visit_id !== visitId && note.status === "signed");
  const lastSections: NoteSections | undefined = last?.sections;
  const groups: { label: string; section: PickSection; items: readonly { id: string; label: string; text: string }[] }[] = [
    { label: "Complaint", section: "subjective", items: picks.data?.complaints ?? [] },
    { label: "Finding", section: "objective", items: picks.data?.findings ?? [] },
    { label: "Advice", section: "plan", items: picks.data?.advice ?? [] },
  ];
  return (
    <div className="flex flex-col gap-3" aria-label="Quick picks">
      {lastSections === undefined ? null : (
        <div>
          <button
            type="button"
            className="qp-chip"
            onClick={() => {
              if (lastSections.subjective != null) onPick("subjective", lastSections.subjective);
              if (lastSections.plan != null) onPick("plan", lastSections.plan);
            }}
          >
            <History aria-hidden="true" />
            Same as last visit{last === undefined ? "" : ` (${last.visit_number})`}
          </button>
        </div>
      )}
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.label}>
            <p className="qp-label">{group.label}</p>
            <div className="qp-chips" role="group" aria-label={group.label}>
              {group.items.map((item) => (
                <button key={item.id} type="button" className="qp-chip" onClick={() => { onPick(group.section, item.text); }}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
