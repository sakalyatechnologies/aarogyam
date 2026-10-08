import { apiErrorOf } from "@aarogyam/api-client";
import { ApiErrorNotice, formatDate, formatDateTime } from "@aarogyam/app-kit";
import { Button, Pill, useToast } from "@sakalya/ui";

import { useMySessions, useRevokeSession } from "../../queries.js";
import { SkeletonRows } from "../../components/skeleton-rows.js";

/** Settings, "Sessions": the devices the signed-in person is signed in on, and ending the others. */
export function SessionsPanel() {
  const sessions = useMySessions();
  const revoke = useRevokeSession();
  const toast = useToast();
  if (sessions.isPending) {
    return <SkeletonRows count={3} label="Loading sessions" />;
  }
  if (sessions.isError) {
    return <ApiErrorNotice title="Couldn't load your sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />;
  }
  return (
    <ul className="divide-y divide-border">
      {sessions.data.items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-text">
              {item.current ? "This device" : "Another device"}
              {item.current ? <Pill tone="success">Current</Pill> : null}
            </p>
            <p className="text-xs text-muted">
              Last active {formatDateTime(item.last_active_at)} · Signed in {formatDate(item.created_at)}
            </p>
          </div>
          {item.current ? null : (
            <Button
              variant="secondary"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(item.id, {
                  onError: (thrown) => {
                    toast.show({ title: apiErrorOf(thrown)?.message ?? "Couldn't sign that device out.", tone: "danger" });
                  },
                });
              }}
            >
              End this session
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
