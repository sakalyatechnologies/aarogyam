import { ExternalLink, ShieldCheck } from "lucide-react";

import type { StaffSupportGrant } from "@aarogyam/api-client";
import { ApiErrorNotice, useDocumentTitle } from "@aarogyam/app-kit";
import { Card, EmptyState, PageHeader, Skeleton } from "@sakalya/ui";

import { useSupportGrants } from "../../api.js";
import { StatusChip } from "../../ui/status-chip.js";
import { endsIn, localDateTime, pastLabel, splitGrants } from "./support-view.js";

const EMPTY = "No clinic has given you access. Ask the clinic's owner to grant it from Settings → Support access.";

function ActiveGrant({ grant, now }: { grant: StaffSupportGrant; now: Date }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-surface-muted p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold text-text">{grant.clinic_name}</span>
        <span className="text-sm">{grant.reason}</span>
        <span className="text-xs text-muted">
          Ends {endsIn(grant.ends_at, now)} ({localDateTime(grant.ends_at)}) · Granted by {grant.granted_by}
        </span>
      </div>
      {grant.portal_host == null ? (
        <span className="text-xs text-muted">No portal address yet</span>
      ) : (
        <a
          href={`https://${grant.portal_host}/`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded text-sm font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Open clinic (read-only)
          <span className="sr-only"> {grant.clinic_name} in a new tab</span>
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      )}
    </li>
  );
}

function PastGrants({ grants }: { grants: readonly StaffSupportGrant[] }) {
  if (grants.length === 0) {
    return null;
  }
  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Past grants ({grants.length})</summary>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0" aria-label="Past grants">
          {grants.map((grant) => (
            <li key={grant.id} className="flex flex-col gap-1 rounded-xl bg-surface-muted p-3 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text">{grant.clinic_name}</span>
                <StatusChip tone="neutral">{pastLabel(grant)}</StatusChip>
              </span>
              <span>{grant.reason}</span>
              <span className="text-xs text-muted">
                Ended {localDateTime(grant.ends_at)} · Granted by {grant.granted_by}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export function SupportPage() {
  useDocumentTitle("Support access", "Sakalya Console");
  const grants = useSupportGrants();
  const now = new Date(grants.dataUpdatedAt);
  const { active, past } = splitGrants(grants.data?.items ?? [], now);

  return (
    <>
      <PageHeader title="Support access" subtitle="Access is read-only and every page you open is logged for the clinic." />
      {grants.isError ? (
        <Card>
          <ApiErrorNotice title="Couldn't load your support access" error={grants.error} onRetry={() => void grants.refetch()} />
        </Card>
      ) : grants.isPending ? (
        <div role="status" aria-label="Loading support access">
          <Skeleton shape="block" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Card title={`Active grants (${String(active.length)})`}>
            {active.length === 0 ? (
              <EmptyState title="No access right now" description={EMPTY} icon={<ShieldCheck className="size-7" />} />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Active grants">
                {active.map((grant) => (
                  <ActiveGrant key={grant.id} grant={grant} now={now} />
                ))}
              </ul>
            )}
          </Card>
          <PastGrants grants={past} />
        </div>
      )}
    </>
  );
}
