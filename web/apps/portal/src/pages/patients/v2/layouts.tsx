/**
 * The three arrangements of the same few blocks: Console (the chart on the left, today's notes and the prescription on a
 * sticky rail), Stage with drawers (a docked toolbar opens Voice, Prescribe, History and More), and Tabs with a ribbon
 * (dictate and add a set from anywhere). They differ only in where blocks sit; each block reads the same data. Everything
 * that is not needed during a visit lives under "More".
 */
import { FileText, Mic, PanelRight, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { Patient } from "@aarogyam/api-client";
import { Drawer, useToast } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { useVisits } from "../../../queries.js";
import { useQuickPicks } from "../../../walk-in-queries.js";
import { setItems } from "../../prescriptions/medicine-sets.js";
import { apiErrorOf } from "@aarogyam/api-client";
import { ClinicalFlagsPanel } from "../clinical-flags-panel.js";
import { ConsentPanel } from "../consent-panel.js";
import { FilesPanel } from "../files-panel.js";
import { NotesPanel } from "../notes-panel.js";
import { BillsPanel } from "../records-panels.js";
import {
  DetailsBlock,
  DoneTodayBlock,
  FlagsBlock,
  HistoryBlock,
  ImagesBlock,
  PastRxBlock,
  PlanBlock,
  RxBlock,
  SaysBlock,
  ToothBlock,
  VoiceBlock,
  WrapBlock,
} from "./blocks.js";
import { GalleryBlock } from "./images.js";
import { Bento, Fold, PillTabs } from "./kit.js";
import { useVisitSession } from "./visit-session.js";

export interface LayoutProps {
  patient: Patient;
  canClinical: boolean;
  /** Opened by `?tab=prescriptions` (old links and the command palette). */
  showPastRx: boolean;
}

/** What is not needed during a visit, each in its own fold. */
function MoreFolds({ patient, canClinical, pastRx, open = false }: { patient: LayoutProps["patient"]; canClinical: boolean; pastRx: boolean; open?: boolean }) {
  const { can } = useClinic();
  return (
    <>
      {canClinical && pastRx ? (
        <Fold title="Past prescriptions" open={open}>
          <PastRxBlock />
        </Fold>
      ) : null}
      {canClinical ? (
        <Fold title="Treatment plans">
          <PlanBlock />
        </Fold>
      ) : null}
      <Fold title="Consent forms">
        <ConsentPanel patientId={patient.id} />
      </Fold>
      {canClinical ? (
        <>
          <Fold title="Files">
            <FilesPanel patientId={patient.id} />
          </Fold>
          <Fold title="Notes">
            <NotesPanel patientId={patient.id} />
          </Fold>
          <Fold title="Clinical flags">
            <ClinicalFlagsPanel patientId={patient.id} />
          </Fold>
          <Fold title="Details">
            <DetailsBlock patient={patient} />
          </Fold>
        </>
      ) : null}
      {can("billing.read") ? (
        <Fold title="Billing">
          <BillsPanel patientId={patient.id} />
        </Fold>
      ) : null}
    </>
  );
}

/** Console: the chart and what the patient says on the left; today's notes, prescription and wrap up on a sticky rail. */
export function ConsoleLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const session = useVisitSession();
  const visits = useVisits(canClinical ? patient.id : undefined);
  const count = visits.data?.items.length;
  return (
    <div className="p360-console">
      <div className="p360-stack">
        {canClinical ? (
          <>
            <ToothBlock patientId={patient.id} />
            <SaysBlock />
            <DoneTodayBlock />
            <ImagesBlock patientId={patient.id} />
          </>
        ) : (
          <>
            <DetailsBlock patient={patient} />
            <FlagsBlock patientId={patient.id} />
          </>
        )}
      </div>
      <div className="p360-rail">
        {session.canWrite ? <VoiceBlock /> : null}
        <RxBlock />
        {session.canWrite ? <WrapBlock /> : null}
        {canClinical ? (
          <Fold title={count === undefined ? "Visit history" : `Visit history · ${String(count)}`}>
            <HistoryBlock />
          </Fold>
        ) : null}
        <Fold title="More" open={showPastRx && canClinical}>
          <MoreFolds patient={patient} canClinical={canClinical} pastRx open={showPastRx && canClinical} />
        </Fold>
      </div>
    </div>
  );
}

type DrawerKey = "voice" | "prescribe" | "history" | "more";

/** Stage with drawers: the chart is the stage; a docked toolbar opens each tool in a drawer. */
export function StageLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const session = useVisitSession();
  const toast = useToast();
  const [drawer, setDrawer] = useState<DrawerKey | null>(showPastRx && canClinical ? "history" : null);
  const medicines = session.rx.draft?.items.length ?? 0;
  const dock: { key: DrawerKey; label: string; icon: ReactNode; show: boolean }[] = [
    { key: "voice", label: "Voice", icon: <Mic aria-hidden="true" />, show: canClinical && session.canWrite },
    { key: "prescribe", label: "Prescribe", icon: <FileText aria-hidden="true" />, show: session.canRx },
    { key: "history", label: "History", icon: <PanelRight aria-hidden="true" />, show: canClinical },
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
  const titles: Record<DrawerKey, string> = { voice: "Today's notes", prescribe: "Prescribe", history: "History", more: "More" };
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
      {canClinical ? (
        <>
          <div className="p360-grid2">
            <SaysBlock />
            {session.canWrite ? <WrapBlock /> : null}
          </div>
          <DoneTodayBlock />
          <ImagesBlock patientId={patient.id} />
        </>
      ) : (
        <FlagsBlock patientId={patient.id} />
      )}
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
          {drawer === "history" ? (
            <>
              <Bento title="Visits and timeline">
                <HistoryBlock />
              </Bento>
              <Bento title="Past prescriptions">
                <PastRxBlock />
              </Bento>
            </>
          ) : null}
          {drawer === "more" ? <MoreFolds patient={patient} canClinical={canClinical} pastRx={false} /> : null}
        </div>
      </Drawer>
    </>
  );
}

type TabKey = "visit" | "history" | "details" | "more";

/** Tabs with a ribbon: dictate and add a medicine set from any tab. */
export function TabsLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const session = useVisitSession();
  const picks = useQuickPicks();
  const [tab, setTab] = useState<TabKey>(showPastRx && canClinical ? "history" : canClinical ? "visit" : "details");
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
        { value: "history", label: "History" },
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
              <div className="p360-grid2">
                <div className="p360-stack">
                  {session.canWrite ? <VoiceBlock /> : null}
                  <SaysBlock />
                </div>
                <div className="p360-stack">
                  <RxBlock />
                  {session.canWrite ? <WrapBlock /> : null}
                </div>
              </div>
              <DoneTodayBlock />
              <ImagesBlock patientId={patient.id} />
            </div>
          ) : null,
          history: (
            <div className="p360-stack">
              <Bento title="Visit history">
                <HistoryBlock limit={20} />
              </Bento>
              <Bento title="Past prescriptions">
                <PastRxBlock />
              </Bento>
              <Bento title="X-rays and photos">
                <GalleryBlock patientId={patient.id} canUpload={session.canWrite} visitId={session.visit?.id} />
              </Bento>
            </div>
          ),
          details: (
            <div className="p360-stack">
              <DetailsBlock patient={patient} />
              <FlagsBlock patientId={patient.id} />
            </div>
          ),
          more: <MoreFolds patient={patient} canClinical={canClinical} pastRx={false} />,
        }}
      />
    </>
  );
}
