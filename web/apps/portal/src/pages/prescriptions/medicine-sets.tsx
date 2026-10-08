import { ListPlus } from "lucide-react";

import type { MedicineSet, RxItem } from "@aarogyam/api-client";

import { useQuickPicks } from "../../walk-in-queries.js";
import "../../components/quick-picks.css";

/** A set's medicines as prescription lines; each stays editable, and the allergy check still runs on issue. */
export function setItems(set: MedicineSet): RxItem[] {
  return set.items.map((m) => ({
    drug_name: m.drug_name,
    strength: m.strength,
    form: m.form,
    dose: m.dose,
    frequency: m.frequency,
    timing: m.timing ?? null,
    duration_days: m.duration_days ?? null,
    instructions: m.instructions ?? null,
  }));
}

/** One tap adds a whole medicine set (such as after an extraction) from the specialty's quick picks. */
export function MedicineSets({ onAdd }: { onAdd: (items: RxItem[], label: string) => void }) {
  const picks = useQuickPicks();
  const sets = picks.data?.medicine_sets ?? [];
  if (sets.length === 0) {
    return null;
  }
  return (
    <div className="mb-3">
      <p className="qp-label">Medicine sets</p>
      <div className="qp-chips" role="group" aria-label="Medicine sets">
        {sets.map((set) => (
          <button
            key={set.id}
            type="button"
            className="qp-chip"
            title={set.items.map((m) => `${m.drug_name} ${m.strength}`).join(" · ")}
            onClick={() => {
              onAdd(setItems(set), set.label);
            }}
          >
            <ListPlus aria-hidden="true" />
            {set.label}
          </button>
        ))}
      </div>
    </div>
  );
}
