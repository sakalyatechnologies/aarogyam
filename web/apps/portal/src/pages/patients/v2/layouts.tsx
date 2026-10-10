/**
 * The three arrangements of the same blocks: Console (stage on the left, tools on a sticky rail), Stage with drawers
 * (a docked toolbar opens Voice, Prescribe, History and Consent), and Tabs with a ribbon (dictate and add a set from
 * anywhere). They differ only in where blocks sit; each block reads the same data.
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
import { ConsentPanel } from "../consent-panel.js";
import { FilesPanel } from "../files-panel.js";
import { NotesPanel } from "../notes-panel.js";
import { BillsPanel } from "../records-panels.js";
import { ClinicalFlagsPanel } from "../clinical-flags-panel.js";
import {
  BillingBlock,
  ConsentBlock,
  DetailsBlock,
  DoneTodayBlock,
  FilesBlock,
  FlagsBlock,
  HistoryBlock,
  NotesBlock,
  PastRxBlock,
  PlanBlock,
  RxBlock,
  SaysBlock,
  ToothBlock,
  VoiceBlock,
  WrapBlock,
} from "./blocks.js";
import { Bento, Fold, PillTabs } from "./kit.js";
import { useVisitSession } from "./visit-session.js";

export interface LayoutProps {
  patient: Patient;
  canClinical: boolean;
  /** Opened by `?tab=prescriptions` (old links and the command palette). */
  showPastRx: boolean;
}

/** Console: the chart and what the patient says on the left; voice, prescription, wrap up and folds on a sticky rail. */
export function ConsoleLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const { can } = useClinic();
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
            <PlanBlock />
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
          <>
            <Fold title={count === undefined ? "Visit history" : `Visit history · ${String(count)}`}>
              <HistoryBlock />
            </Fold>
            <Fold title="Past prescriptions" open={showPastRx}>
              <PastRxBlock />
            </Fold>
          </>
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
      </div>
    </div>
  );
}

type DrawerKey = "voice" | "prescribe" | "history" | "consent";

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
    { key: "consent", label: "Consent", icon: <PanelRight aria-hidden="true" />, show: true },
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
  const titles: Record<DrawerKey, string> = { voice: "Voice notes", prescribe: "Prescribe", history: "History", consent: "Consent forms" };
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
          <div className="p360-grid2">
            <PlanBlock />
            <FlagsBlock patientId={patient.id} />
          </div>
          <DetailsBlock patient={patient} />
        </>
      ) : (
        <FlagsBlock patientId={patient.id} />
      )}
      <BillingBlock patientId={patient.id} />
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
              <FilesBlock patientId={patient.id} />
              <NotesBlock patientId={patient.id} />
            </>
          ) : null}
          {drawer === "consent" ? <ConsentBlock patientId={patient.id} /> : null}
        </div>
      </Drawer>
    </>
  );
}

type TabKey = "visit" | "history" | "rx" | "consent" | "details";

/** Tabs with a ribbon: dictate and add a medicine set from any tab. */
export function TabsLayout({ patient, canClinical, showPastRx }: LayoutProps) {
  const session = useVisitSession();
  const picks = useQuickPicks();
  const [tab, setTab] = useState<TabKey>(showPastRx && canClinical ? "rx" : canClinical ? "visit" : "details");
  const sets = (picks.data?.medicine_sets ?? []).slice(0, 3);
  const note = session.note;
  const ribbon = canClinical && session.canWrite;
  const status = session.voiceOpen ? "Recorder open" : Object.values(note.values).some((v) => v.trim() !== "") ? "Note drafted" : "Tap to dictate";
  const options: { value: TabKey; label: string }[] = canClinical
    ? [
        { value: "visit", label: "Visit" },
        { value: "history", label: "History" },
        { value: "rx", label: "Rx" },
        { value: "consent", label: "Consent" },
      ]
    : [
        { value: "details", label: "Details" },
        { value: "consent", label: "Consent" },
      ];
  return (
    <>
      {ribbon ? (
        <div className="p360-ribbon" role="toolbar" aria-label="Dictate and prescribe">
          <button
            type="button"
            className="p360-mic"
            aria-label={session.voiceOpen ? "Close the voice recorder" : "Open the voice recorder"}
            aria-pressed={session.voiceOpen}
            disabled={session.visit === undefined}
            onClick={() => {
              setTab("visit");
              if (!note.hasDraft && !session.voiceOpen) note.start();
              session.setVoiceOpen(!session.voiceOpen);
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
              <PlanBlock />
            </div>
          ) : null,
          history: (
            <div className="p360-stack">
              <Bento title="Visit history">
                <HistoryBlock limit={20} />
              </Bento>
              <FilesBlock patientId={patient.id} />
              <NotesBlock patientId={patient.id} />
            </div>
          ),
          rx: (
            <Bento title="Past prescriptions">
              <PastRxBlock />
            </Bento>
          ),
          consent: (
            <div className="p360-stack">
              <ConsentBlock patientId={patient.id} />
              <FlagsBlock patientId={patient.id} />
            </div>
          ),
          details: (
            <div className="p360-stack">
              <DetailsBlock patient={patient} />
              <BillingBlock patientId={patient.id} />
            </div>
          ),
        }}
      />
    </>
  );
}
