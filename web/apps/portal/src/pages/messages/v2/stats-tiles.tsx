import { AlertTriangle, CheckCheck, Send, UserMinus } from "lucide-react";

import { MkCard, StatTile } from "../../../components/mk/index.js";
import { useMessageStats, why } from "./queries.js";

/** This month's messages to patients: sent, delivered and its share, failed or skipped, and opt-outs. */
export function StatsTiles() {
  const stats = useMessageStats(true);
  if (stats.isPending) return <p className="mk-hint" role="status">Loading message numbers…</p>;
  if (stats.isError) {
    return (
      <p role="alert" className="ms-error">
        Couldn't load this month's message numbers. {why(stats.error)}{" "}
        <button type="button" className="ms-link" onClick={() => { void stats.refetch(); }}>
          Try again
        </button>
      </p>
    );
  }
  const s = stats.data;
  if (s.sent === 0 && s.skipped === 0 && s.failed === 0) {
    return (
      <MkCard title="This month">
        <p className="mk-hint">No messages sent to patients yet this month.</p>
      </MkCard>
    );
  }
  return (
    <div className="mk-stats" aria-label="Messages this month">
      <StatTile label="Sent" value={s.sent} icon={<Send size={16} />} />
      <StatTile label="Delivered" value={s.delivered_pct == null ? String(s.delivered) : `${String(s.delivered)} (${String(s.delivered_pct)}%)`} icon={<CheckCheck size={16} />} />
      <StatTile label="Failed or skipped" value={s.failed + s.skipped} {...(s.failed > 0 ? { tone: "warn" as const } : {})} icon={<AlertTriangle size={16} />} />
      <StatTile label="Opt-outs" value={s.opt_outs} icon={<UserMinus size={16} />} />
    </div>
  );
}
