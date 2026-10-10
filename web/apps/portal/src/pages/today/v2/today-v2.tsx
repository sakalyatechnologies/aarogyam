import { CalendarDays, LayoutTemplate, Undo2 } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Drawer, PageHeader, Skeleton } from "@sakalya/ui";

import { useClinic } from "../../../clinic.js";
import { FinishSetupCard } from "../../setup/finish-card.js";
import { longDate } from "../today-page.js";
import { Board } from "./board.js";
import { useDayToday, useMyLayout } from "./queries.js";
import { StudioEditor } from "./studio-editor.js";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A picked day as words, e.g. `Thursday · 1 October 2026`. */
function dayWords(date: string): string {
  return longDate(`${date}T12:00:00Z`, "UTC");
}

/**
 * Today (new look): the saved layout drawn by the Board, with a mini calendar that shows any day's queue and completed
 * visits in place. The chosen day is `?date=` so refresh and back keep it; "Back to today" drops it.
 */
export function TodayV2() {
  const { session } = useClinic();
  useDocumentTitle("Today", session.clinic.name);
  const [params, setParams] = useSearchParams();
  const asked = params.get("date");
  const date = asked !== null && ISO_DAY.test(asked) ? asked : undefined;
  const [studio, setStudio] = useState(false);
  const layout = useMyLayout();
  const now = useDayToday(undefined);

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
  const viewing = date !== undefined && date !== now.data?.date;

  return (
    <div className="mk-panel">
      <FinishSetupCard />
      <PageHeader
        variant="display"
        title="Today"
        subtitle={`${session.clinic.name} · ${now.data === undefined ? "" : longDate(now.data.as_of, session.clinic.timezone)}`}
        end={
          <button
            type="button"
            className="mk-btn mk-btn-ghost"
            onClick={() => {
              setStudio(true);
            }}
          >
            <LayoutTemplate aria-hidden="true" className="size-4" />
            Customise
          </button>
        }
      />
      {viewing ? (
        <div className="tv2-head" style={{ marginBottom: 16 }}>
          <span className="tv2-viewing" role="status">
            <CalendarDays className="size-4" aria-hidden="true" />
            Viewing {dayWords(date)}
          </span>
          <button
            type="button"
            className="tv2-chip"
            onClick={() => {
              pick(undefined);
            }}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            Back to today
          </button>
        </div>
      ) : null}
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
        <>
          <Board layout={layout.data.layout} catalogue={layout.data.catalogue} date={viewing ? date : undefined} onDateChange={pick} />
          <Drawer open={studio} onOpenChange={setStudio} title="Dashboard studio" description="Choose what Today shows and how. Changes show in the preview before you save." size="lg">
            <StudioEditor view={layout.data} layout="stacked" onSaved={() => { setStudio(false); }} />
          </Drawer>
        </>
      )}
    </div>
  );
}
