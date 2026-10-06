import { FileText, Paperclip, Scissors, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { apiErrorOf, type PatientId, type TimelineEventKind } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime } from "@aarogyam/app-kit";
import { Button, useToast } from "@sakalya/ui";
import { MkCard, Tag, statusTone, Empty } from "../../components/mk/index.js";

import { useClinic } from "../../clinic.js";
import { useStartVisit, useTimeline, useVisits } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const EVENT_ICON: Readonly<Record<TimelineEventKind, ReactNode>> = {
  visit: <Stethoscope aria-hidden="true" className="size-4" />,
  note: <FileText aria-hidden="true" className="size-4" />,
  procedure: <Scissors aria-hidden="true" className="size-4" />,
  attachment: <Paperclip aria-hidden="true" className="size-4" />,
};

/** Every visit, note and procedure, newest first, with a way to start a new visit. */
export function VisitsPanel({ patientId }: { patientId: PatientId }) {
  const { can } = useClinic();
  const navigate = useNavigate();
  const toast = useToast();
  const timeline = useTimeline(patientId);
  const visits = useVisits(patientId);
  const startVisit = useStartVisit(patientId);
  const openVisit = visits.data?.items.find((v) => v.status === "open");

  const onStartVisit = () => {
    if (openVisit !== undefined) {
      void navigate(`/patients/${patientId}/visits/${openVisit.id}`);
      return;
    }
    startVisit.mutate(
      {},
      {
        onSuccess: (visit) => {
          void navigate(`/patients/${patientId}/visits/${visit.id}`);
        },
        onError: (thrown) => {
          toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't start a visit.", tone: "danger" });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {can("clinical.write") ? (
        <div className="flex justify-end">
          <Button disabled={startVisit.isPending} onClick={onStartVisit}>
            {openVisit !== undefined ? "Continue open visit" : startVisit.isPending ? "Starting…" : "Start visit"}
          </Button>
        </div>
      ) : null}
      {timeline.isPending ? (
        <SkeletonRows label="Loading visits" />
      ) : timeline.isError ? (
        <ApiErrorNotice title="Couldn't load the timeline" error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : timeline.data.items.length === 0 ? (
        <Empty title="No visits yet">Each visit, note and procedure will appear here in order.</Empty>
      ) : (
        <MkCard>
          <ol className="flex flex-col divide-y divide-border">
            {timeline.data.items.map((event) => (
              <li key={event.id} className="flex items-start gap-3 py-3">
                <span aria-hidden="true" className="mt-0.5 text-muted">
                  {EVENT_ICON[event.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block truncate text-left text-sm font-bold text-text hover:underline"
                    onClick={() => {
                      if (event.visit_id != null) void navigate(`/patients/${patientId}/visits/${event.visit_id}`);
                    }}
                    disabled={event.visit_id == null}
                  >
                    {event.title}
                  </button>
                  {event.detail == null ? null : <p className="truncate text-xs text-muted">{event.detail}</p>}
                  <p className="text-xs text-muted">
                    {formatDateTime(event.at)}
                    {event.by == null ? "" : ` · ${event.by.name}`}
                  </p>
                </div>
                {event.status == null ? null : <Tag tone={statusTone("neutral")}>{event.status}</Tag>}
              </li>
            ))}
          </ol>
        </MkCard>
      )}
    </div>
  );
}
