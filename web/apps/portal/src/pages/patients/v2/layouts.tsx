/**
 * The three arrangements of the same few blocks: Console (the chart and Records on the left, Today and Wrap up on a
 * sticky rail), Stage with drawers (a docked toolbar opens Voice, Prescribe, Records and More), and Tabs with a ribbon
 * (dictate and add a set from anywhere). Besides the chart there are at most three blocks: Today (notes, prescription,
 * done today), Records (one card with small tabs) and Wrap up (only while a visit is open). They differ only in where
 * the blocks sit; each block reads the same data. What is rarely needed lives under "More".
 */
import { FileText, Mic, PanelRight, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Patient } from "@aarogyam/api-client";
import { Drawer, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useQuickPicks } from "../../../walk-in-queries.js";
import { setItems } from "../../prescriptions/medicine-sets.js";
import { apiErrorOf } from "@aarogyam/api-client";
import { ClinicalFlagsPanel } from "../clinical-flags-panel.js";
import { FilesPanel } from "../files-panel.js";
import { NotesPanel } from "../notes-panel.js";
import { BillsPanel } from "../records-panels.js";
import { DetailsBlock, FlagsBlock, RecordsCard, RxBlock, TodayBlock, TodayStageBlock, ToothBlock, VoiceBlock, WrapCard } from "./blocks.js";
import { Fold, PillTabs } from "./kit.js";
import { useVisitSession } from "./visit-session.js";

export interface LayoutProps {
  patient: Patient;
  canClinical: boolean;
  /** Opened by `?tab=prescriptions` (old links and the command palette). */
  showPastRx: boolean;
}

/** What is not needed during a visit, each in its own collapsed fold. */
function MoreFolds({ patient, canClinical, nested = false }: { patient: LayoutProps["patient"]; canClinical: boolean; /** The folds go inside one "More" fold. */ nested?: boolean }) {
  const { can } = useClinic();
  const rare = (
    <>
      {canClinical ? (
        <>
          <Fold title="Files" quiet={nested}>
            <FilesPanel patientId={patient.id} />
          </Fold>
          <Fold title="Notes" quiet={nested}>
            <NotesPanel patientId={patient.id} />
          </Fold>
          <Fold title="Clinical flags" quiet={nested}>
            <ClinicalFlagsPanel patientId={patient.id} />
          </Fold>
          <Fold title="Details" quiet={nested}>
            <DetailsBlock patient={patient} />
          </Fold>
        </>
      ) : null}
      {can("billing.read") ? (
        <Fold title="Billing" quiet={nested}>
          <BillsPanel patientId={patient.id} />
        </Fold>
      ) : null}
    </>
  );
  return nested ? <Fold title="More">{rare}</Fold> : rare;
}

/** Console: the chart and Records on the left; Today and Wrap up on a sticky rail; the rarely used folded below. */
export function ConsoleLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  return (
    <>
      <div className="p360-console">
        <div className="p360-stack">
          {canClinical ? (
            <ToothBlock patientId={patient.id} />
          ) : (
            <>
              <DetailsBlock patient={patient} />
              <FlagsBlock patientId={patient.id} />
            </>
          )}
          <RecordsCard canClinical={canClinical} initial={showPastRx ? "prescriptions" : "history"} />
        </div>
        <div className="p360-rail">
          {canClinical ? <TodayBlock /> : <RxBlock />}
          <WrapCard />
        </div>
      </div>
      <div className="p360-folds">
        <MoreFolds patient={patient} canClinical={canClinical} nested />
      </div>
    </>
  );
}

type DrawerKey = "voice" | "prescribe" | "records" | "more";

/** Stage with drawers: the chart is the stage; a docked toolbar opens each tool in a drawer. */
export function StageLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const session = useVisitSession();
  const toast = useToast();
  const [drawer, setDrawer] = useState<DrawerKey | null>(showPastRx && canClinical ? "records" : null);
  const medicines = session.rx.draft?.items.length ?? 0;
  const dock: { key: DrawerKey; label: string; icon: ReactNode; show: boolean }[] = [
    { key: "voice", label: "Voice", icon: <Mic aria-hidden="true" />, show: canClinical && session.canWrite },
    { key: "prescribe", label: "Prescribe", icon: <FileText aria-hidden="true" />, show: session.canRx },
    { key: "records", label: "Records", icon: <PanelRight aria-hidden="true" />, show: true },
    { key: "more", label: "More", icon: <PanelRight aria-hidden="true" />, show: true },
  ];
  const close = () => {
    // A prescription still being typed is saved before its drawer goes; if that fails the drawer stays so nothing is lost.
    const save = drawer === "prescribe" ? (session.rx.handle.current?.save() ?? Promise.resolve()) : Promise.resolve();
    save.then(
      () => {
        setDrawer(null);
      },
      (thrown: unknown) => {
        toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't save the prescription draft, so it stays open.", tone: "danger" });
      },
    );
  };
  const titles: Record<DrawerKey, string> = { voice: "Today's notes", prescribe: "Prescribe", records: "Patient records", more: "More" };
  return (
    <>
      <div className="p360-dock" role="toolbar" aria-label="Open a panel">
        {dock
          .filter((item) => item.show)
          .map((item) => (
            <button
              key={item.key}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={drawer === item.key}
              onClick={() => {
                setDrawer(item.key);
              }}
            >
              {item.icon}
              {item.label}
              {item.key === "prescribe" && medicines > 0 ? <span className="p360-count">{medicines}</span> : null}
            </button>
          ))}
      </div>
      {canClinical ? <ToothBlock patientId={patient.id} /> : <DetailsBlock patient={patient} />}
      {canClinical ? <TodayStageBlock /> : <FlagsBlock patientId={patient.id} />}
      <WrapCard />
      <Drawer
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={drawer === null ? "Panel" : titles[drawer]}
        size="md"
      >
        <div className="p360-drawer-body">
          {drawer === "voice" ? <VoiceBlock /> : null}
          {drawer === "prescribe" ? <RxBlock /> : null}
          {drawer === "records" ? <RecordsCard canClinical={canClinical} initial={showPastRx ? "prescriptions" : "history"} /> : null}
          {drawer === "more" ? <MoreFolds patient={patient} canClinical={canClinical} /> : null}
        </div>
      </Drawer>
    </>
  );
}

type TabKey = "visit" | "records" | "details" | "more";

/** Tabs with a ribbon: dictate and add a medicine set from any tab. */
export function TabsLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const session = useVisitSession();
  const picks = useQuickPicks();
  const [tab, setTab] = useState<TabKey>(showPastRx && canClinical ? "records" : canClinical ? "visit" : "details");
  const sets = (picks.data?.medicine_sets ?? []).slice(0, 3);
  const note = session.note;
  const voice = session.voice;
  const ribbon = canClinical && session.canWrite;
  const status =
    voice.phase === "recording"
      ? "Recording"
      : voice.phase === "paused"
        ? "Recording paused"
        : Object.values(note.values).some((v) => v.trim() !== "")
          ? "Note drafted"
          : "Tap to dictate";
  const options: { value: TabKey; label: string }[] = canClinical
    ? [
        { value: "visit", label: "Visit" },
        { value: "records", label: "Records" },
        { value: "more", label: "More" },
      ]
    : [
        { value: "details", label: "Details" },
        { value: "more", label: "More" },
      ];
  return (
    <>
      {ribbon ? (
        <div className="p360-ribbon" role="toolbar" aria-label="Dictate and prescribe">
          <button
            type="button"
            className="p360-mic"
            aria-label="Go to the voice recorder"
            disabled={session.visit === undefined}
            onClick={() => {
              setTab("visit");
              // The recorder is on the Visit tab; once it shows, focus its button.
              requestAnimationFrame(() => {
                document.querySelector<HTMLElement>('[aria-label="Voice recorder"] button')?.focus();
              });
            }}
          >
            <Mic aria-hidden="true" />
          </button>
          <span className="p360-status" role="status">
            {session.visit === undefined ? "Start a visit to dictate" : status}
          </span>
          {session.canRx && sets.length > 0 ? <span className="p360-sep" aria-hidden="true" /> : null}
          {session.canRx
            ? sets.map((set) => (
                <button
                  key={set.id}
                  type="button"
                  className="p360-set"
                  disabled={session.rx.busy}
                  onClick={() => {
                    void session.rx.addItems(setItems(set));
                  }}
                >
                  <Plus aria-hidden="true" />
                  {set.label}
                </button>
              ))
            : null}
        </div>
      ) : null}
      <PillTabs
        label="Patient record"
        options={options}
        value={tab}
        onChange={setTab}
        panels={{
          visit: canClinical ? (
            <div className="p360-stack">
              <ToothBlock patientId={patient.id} />
              <TodayBlock columns />
              <WrapCard />
            </div>
          ) : null,
          records: (
            <div className="p360-stack">
              <RecordsCard canClinical={canClinical} initial={showPastRx ? "prescriptions" : "history"} />
            </div>
          ),
          details: (
            <div className="p360-stack">
              <DetailsBlock patient={patient} />
              <FlagsBlock patientId={patient.id} />
              <RecordsCard canClinical={false} />
            </div>
          ),
          more: (
            <div className="p360-stack">
              <MoreFolds patient={patient} canClinical={canClinical} />
            </div>
          ),
        }}
      />
    </>
  );
}
