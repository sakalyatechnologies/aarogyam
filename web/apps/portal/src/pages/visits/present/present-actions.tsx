/**
 * The doctor's additions to Show patient (founder: no going back to the chart): Edit a tooth in a side sheet, "Go with this" on an
 * option card, and today's photo of a tooth. This host is itself lazy and only rendered for people with clinical write, so the
 * Present route carries none of it; it hands the actions to Show patient and draws the sheets they open.
 */
import { Suspense, lazy, useEffect, useState } from "react";

import type { DentalTerm, PatientId, PlanItem, PresentStudio, VisitId } from "@aarogyam/api-client";
import { setPresentActions, type ChooseTarget } from "@aarogyam/app-kit/present";

import { singleTreatment } from "./option-map.js";

const EditSheet = lazy(() => import("./edit-sheet.js").then((m) => ({ default: m.EditSheet })));
const ToothPhoto = lazy(() => import("./tooth-photo.js").then((m) => ({ default: m.ToothPhoto })));
const ChooseHost = lazy(() => import("./choose-host.js").then((m) => ({ default: m.ChooseHost })));

interface Props {
  patientId: PatientId;
  visitId: VisitId;
  studio: PresentStudio | undefined;
  planItems: readonly PlanItem[];
  terms: readonly DentalTerm[];
}

export function PresentActionsHost({ patientId, visitId, studio, planItems, terms }: Props) {
  const [editing, setEditing] = useState<number | undefined>(undefined);
  const [chosen, setChosen] = useState<{ target: ChooseTarget } | undefined>(undefined);
  useEffect(() => {
    setPresentActions({
      onEditTooth: setEditing,
      onChoose: (target) => { setChosen({ target }); },
      canChoose: ({ option }) => singleTreatment(option) !== undefined,
      photo: (tooth) => <Suspense fallback={null}><ToothPhoto patientId={patientId} tooth={tooth} /></Suspense>,
      overlayOpen: editing !== undefined,
    });
  }, [patientId, editing]);
  useEffect(() => () => { setPresentActions(undefined); }, []);
  return (
    <>
      {editing === undefined ? null : (
        <Suspense fallback={null}>
          <EditSheet patientId={patientId} visitId={visitId} tooth={editing} onClose={() => { setEditing(undefined); }} />
        </Suspense>
      )}
      {chosen === undefined ? null : (
        <Suspense fallback={null}>
          <ChooseHost patientId={patientId} visitId={visitId} studio={studio} planItems={planItems} terms={terms} chosen={chosen} onDone={() => { setChosen(undefined); }} />
        </Suspense>
      )}
    </>
  );
}
