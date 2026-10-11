import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import type { DentalTerm, ToothSurface } from "@aarogyam/api-client";
import { Button, Field, Select, TextInput } from "@sakalya/ui";

import { SURFACES, surfaceLabel } from "../../../visits/odontogram/model.js";
import { Chip } from "../kit.js";
import { TREATMENTS, allowsSurfaces, defaultMaterial, canalOptions, lengthProblem, materialChoices, statusesFor, treatmentOf, type Draft, type TreatmentKey, type TxStatus } from "./model.js";

const NO_MATERIAL = "none";

/** The Add / Edit treatment form: treatment, surfaces, material (only those that suit the treatment), status, root canal details and a note. */
export function TreatmentForm({
  tooth,
  draft,
  onChange,
  terms,
  editing,
  planned,
  busy,
  error,
  onAddMaterial,
  onSave,
  onBack,
  onClose,
}: {
  tooth: number;
  draft: Draft;
  onChange: (next: Draft) => void;
  terms: readonly DentalTerm[];
  /** Editing a recorded row: Planned is not offered, since the work already happened. */
  editing: boolean;
  /** Editing a planned row: saving records the work. */
  planned: boolean;
  busy: boolean;
  error: string | undefined;
  onAddMaterial: (label: string) => Promise<DentalTerm>;
  onSave: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const tx = treatmentOf(draft.tx);
  const materials = materialChoices(tx, terms);
  const [newMaterial, setNewMaterial] = useState("");
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const rct = draft.tx === "root_canal";
  const lengthError = rct ? lengthProblem(draft.length) : undefined;
  const surfaces = allowsSurfaces(tx, draft.status);
  const toggle = <T extends string>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const pickTreatment = (key: TreatmentKey) => {
    const next = treatmentOf(key);
    const keep = materialChoices(next, terms).some((m) => m.id === draft.material);
    onChange({
      ...draft,
      tx: key,
      material: keep ? draft.material : defaultMaterial(next, terms),
      canals: [],
      surfaces: allowsSurfaces(next, draft.status) ? draft.surfaces : [],
      status: statusesFor(key).includes(draft.status) ? draft.status : "Completed",
    });
  };
  const statuses = statusesFor(draft.tx).filter((s) => !(editing && s === "Planned"));

  const addMaterial = () => {
    const label = newMaterial.trim();
    if (label === "") return;
    setAddError(undefined);
    onAddMaterial(label).then(
      (term) => {
        setNewMaterial("");
        onChange({ ...draft, material: term.id });
      },
      () => {
        setAddError("Couldn't add that material. Please try again.");
      },
    );
  };

  return (
    <form
      className="tc-form"
      aria-label={`${editing ? "Edit" : "Add"} treatment for tooth ${String(tooth)}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (lengthError === undefined) onSave();
      }}
    >
      <p className="tc-label" id="tc-tx-label">
        Treatment
      </p>
      <div className="tc-chips" role="group" aria-labelledby="tc-tx-label">
        {TREATMENTS.map((t) => (
          <Chip
            key={t.key}
            pressed={draft.tx === t.key}
            onClick={() => {
              pickTreatment(t.key);
            }}
          >
            {t.label}
          </Chip>
        ))}
      </div>

      {rct ? (
        <div className="tc-rct">
          <p className="tc-label" style={{ margin: 0 }} id="tc-canals-label">
            Root canal details
          </p>
          <div className="tc-chips" role="group" aria-labelledby="tc-canals-label">
            {canalOptions(tooth).map((name) => (
              <Chip
                key={name}
                pressed={draft.canals.includes(name)}
                onClick={() => {
                  onChange({ ...draft, canals: toggle(draft.canals, name) });
                }}
              >
                {name}
              </Chip>
            ))}
          </div>
          <div className="tc-two">
            <Field label="Sitting">
              <Select
                options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `Sitting ${String(n)}` }))}
                value={String(draft.sitting)}
                onValueChange={(value) => {
                  onChange({ ...draft, sitting: Number(value) });
                }}
              />
            </Field>
            <Field label="Working length" error={lengthError} hint={lengthError === undefined ? "In mm, for every canal chosen" : undefined}>
              <TextInput
                value={draft.length}
                placeholder="21 mm"
                inputMode="decimal"
                onChange={(event) => {
                  onChange({ ...draft, length: event.target.value });
                }}
              />
            </Field>
          </div>
        </div>
      ) : surfaces ? (
        <>
          <p className="tc-label" id="tc-surf-label">
            Surfaces
          </p>
          <div className="tc-chips" role="group" aria-labelledby="tc-surf-label">
            {SURFACES.map((s: ToothSurface) => (
              <Chip
                key={s}
                pressed={draft.surfaces.includes(s)}
                onClick={() => {
                  onChange({ ...draft, surfaces: toggle(draft.surfaces, s) });
                }}
              >
                {surfaceLabel(tooth, s)}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {tx.materials.length === 0 ? null : (
        <>
          <Field label="Material">
            <Select
              options={[{ value: NO_MATERIAL, label: "None" }, ...materials.map((m) => ({ value: m.id, label: m.label }))]}
              value={draft.material === "" ? NO_MATERIAL : draft.material}
              onValueChange={(value) => {
                onChange({ ...draft, material: value === NO_MATERIAL ? "" : value });
              }}
            />
          </Field>
          <div className="tc-add">
            <div>
              <Field label="New material" error={addError}>
                <TextInput
                  value={newMaterial}
                  placeholder="Add a material the clinic uses"
                  onChange={(event) => {
                    setNewMaterial(event.target.value);
                  }}
                />
              </Field>
            </div>
            <Button variant="secondary" type="button" onClick={addMaterial} disabled={newMaterial.trim() === ""}>
              Add
            </Button>
          </div>
        </>
      )}

      <p className="tc-label" id="tc-status-label">
        Status
      </p>
      <div className="tc-chips" role="group" aria-labelledby="tc-status-label">
        {statuses.map((s: TxStatus) => (
          <Chip
            key={s}
            pressed={draft.status === s}
            onClick={() => {
              onChange({ ...draft, status: s, surfaces: allowsSurfaces(tx, s) ? draft.surfaces : [] });
            }}
          >
            {s}
          </Chip>
        ))}
      </div>
      {draft.status === "Planned" ? <p className="tc-meta">Adds the treatment to the patient's plan with no estimate yet.</p> : null}
      {planned ? <p className="tc-meta">Saving records this planned treatment as work on the tooth.</p> : null}

      <Field label="Note">
        <TextInput
          value={draft.note}
          placeholder={rct ? "e.g. BMP done, CaOH placed" : "e.g. Class II, shade A2"}
          onChange={(event) => {
            onChange({ ...draft, note: event.target.value });
          }}
        />
      </Field>

      {error === undefined ? null : (
        <p role="alert" className="tc-error">
          {error}
        </p>
      )}
      <div className="tc-actions" style={{ marginTop: 12 }}>
        <Button type="submit" disabled={busy || lengthError !== undefined}>
          {busy ? "Saving…" : editing ? "Update treatment" : "Save treatment"}
        </Button>
        <Button variant="secondary" type="button" icon={<ArrowLeft aria-hidden="true" className="size-4" />} onClick={onBack}>
          Back
        </Button>
        <Button variant="secondary" type="button" onClick={onClose}>
          Close
        </Button>
      </div>
    </form>
  );
}
