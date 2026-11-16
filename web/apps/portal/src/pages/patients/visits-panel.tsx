import { FileText, Paperclip, Scissors, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { type PatientId, type TimelineEventKind } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDateTime } from "@aarogyam/app-kit";
import { MkCard, Tag, statusTone, Empty } from "../../components/mk/index.js";

import { useTimeline } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

const EVENT_ICON: Readonly<Record<TimelineEventKind, ReactNode>> = {
  visit: <Stethoscope aria-hidden="true" className="size-4" />,
  note: <FileText aria-hidden="true" className="size-4" />,
  procedure: <Scissors aria-hidden="true" className="size-4" />,
  attachment: <Paperclip aria-hidden="true" className="size-4" />,
};

/** Every visit, note and procedure, newest first. */
export function VisitsPanel({ patientId }: { patientId: PatientId }) {
  const navigate = useNavigate();
  const timeline = useTimeline(patientId);

  return (
    <div className="flex flex-col gap-4">
      {/* Starting and continuing a visit is the header's one next step (PatientNextStep), so the visit links to its appointment. */}
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
