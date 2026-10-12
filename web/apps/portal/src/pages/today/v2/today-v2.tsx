import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Skeleton } from "@sakalya/ui";

import { AppointmentActionButton } from "../../../components/appointment-action.js";
import { useClinic } from "../../../clinic.js";
import { useClinicSettings, usePractitioners } from "../../../queries.js";
import { WalkInDialog } from "../../queue/walk-in-dialog.js";
import { FinishSetupCard } from "../../setup/finish-card.js";
import { greeting } from "../today-page.js";
import { Board } from "./board.js";
import { useDayToday, useMyLayout } from "./queries.js";
import { seeingOrder } from "./seeing.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `Thursday, 9 October`, in the clinic's own time. */
export function headerDate(asOf: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone }).formatToParts(new Date(asOf));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")}`;
}

/** What the greeting calls the person: `Dr. Asha Kulkarni` for a doctor, the plain name for anyone else. */
export function salutation(displayName: string, doctor: boolean): string {
  const plain = displayName.replace(/^dr\.?\s+/i, "").trim();
  return doctor ? `Dr. ${plain}` : displayName.trim();
}

function HeaderAction({ doctor }: { doctor: boolean }) {
  const { can } = useClinic();
  const day = useDayToday(undefined);
  const practitioners = usePractitioners();
  const [walkIn, setWalkIn] = useState(false);
  if (!can("appointments.write")) return null;
  if (doctor) {
    const target = day.data === undefined ? undefined : seeingOrder(day.data).find((a) => a.status !== "in_chair");
    return target === undefined ? null : <AppointmentActionButton appointment={target} className="tv2-cta" label={(step) => (target.status === "arrived" ? "Start next visit" : step)} />;
  }
  return (
    <>
      <button
        type="button"
        className="tv2-cta"
        onClick={() => {
          setWalkIn(true);
        }}
      >
        <UserPlus className="size-4" aria-hidden="true" />
        Register walk-in
      </button>
      <WalkInDialog open={walkIn} onOpenChange={setWalkIn} practitioners={practitioners.data?.items ?? []} />
    </>
  );
}

/**
 * Today (new look): a greeting, then the saved layout drawn by the Board. The calendar in the side column picks the day
 * shown in that column alone (`?date=` keeps it across a refresh); the rest of the page stays on today.
 */
export function TodayV2() {
  const { session, can } = useClinic();
  useDocumentTitle("Today", session.clinic.name);
  const [params, setParams] = useSearchParams();
  const asked = params.get("date");
  const date = asked !== null && ISO_DAY.test(asked) ? asked : undefined;
  const layout = useMyLayout();
  const now = useDayToday(undefined);
  const settings = useClinicSettings(can("settings.manage"));
  const doctor = can("clinical.write");

  const pick = (next: string | undefined) => {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === undefined) copy.delete("date");
        else copy.set("date", next);
        return copy;
      },
      { replace: false },
    );
  };
  const viewing = date !== undefined && date !== now.data?.date ? date : undefined;
  const timeZone = session.clinic.timezone;
  const area = settings.data?.address.line2 ?? settings.data?.address.city;
  const where = [session.clinic.name, area].filter((part) => part != null && part !== "").join(", ");

  return (
    <div className="mk-panel tv2-page">
      <FinishSetupCard />
      <header className="tv2-greet">
        <div className="tv2-greet-text">
          <h1>{now.data === undefined ? "Today" : `${greeting(now.data.as_of, timeZone)}, ${salutation(session.user.display_name, doctor)}`}</h1>
          <p>{now.data === undefined ? where : `${headerDate(now.data.as_of, timeZone)} · ${where}`}</p>
        </div>
        <HeaderAction doctor={doctor} />
      </header>
      {layout.isPending ? (
        <div role="status" aria-label="Loading your layout" style={{ display: "grid", gap: 16 }}>
          <Skeleton shape="block" />
          <Skeleton shape="block" className="h-64" />
        </div>
      ) : layout.isError ? (
        <ApiErrorNotice
          title="Couldn't load your Today layout"
          error={layout.error}
          onRetry={() => {
            void layout.refetch();
          }}
        />
      ) : (
        <Board layout={layout.data.layout} catalogue={layout.data.catalogue} date={viewing} onDateChange={pick} />
      )}
    </div>
  );
}
