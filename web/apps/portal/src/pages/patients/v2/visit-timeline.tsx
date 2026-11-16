/**
 * The patient's clinical timeline with one entry per visit. The API lists a visit, its notes, recordings, images and
 * procedures as separate events; here everything that belongs to a visit is folded under that visit's single entry,
 * which opens the visit detail. Events that belong to no visit stay as their own entries.
 */
import type { TimelineEvent, Visit } from "@aarogyam/api-client";
import { formatDate } from "@aarogyam/app-kit";

import { Timeline } from "../../../components/mk/index.js";

export type TimelineEntry =
  | { kind: "visit"; id: string; at: string; visit: Visit | undefined; title: string; by: string | undefined; counts: Counts }
  | { kind: "event"; id: string; at: string; event: TimelineEvent };

interface Counts {
  notes: number;
  recordings: number;
  files: number;
  procedures: number;
}

const RECORDING_KINDS = new Set(["audio"]);

function plural(count: number, one: string, many = `${one}s`): string | undefined {
  return count === 0 ? undefined : count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

/** "note, 1 recording, 2 files": what the visit holds besides its own row. */
export function countsText(counts: Counts): string {
  return [counts.notes > 0 ? "note" : undefined, plural(counts.recordings, "recording"), plural(counts.files, "file"), plural(counts.procedures, "procedure")]
    .filter((part): part is string => part !== undefined)
    .join(", ");
}

/** Folds the events of each visit into one entry, newest first. A visit missing from `visits` (not loaded yet, or out of reach) still gets its entry, with a minimal header. */
export function groupTimeline(events: readonly TimelineEvent[], visits: readonly Visit[]): TimelineEntry[] {
  const byId = new Map<string, Visit>(visits.map((v) => [v.id, v]));
  const groups = new Map<string, Extract<TimelineEntry, { kind: "visit" }>>();
  const entries: TimelineEntry[] = [];
  for (const event of events) {
    const visitKey = event.kind === "visit" ? event.id : event.visit_id;
    if (visitKey == null) {
      entries.push({ kind: "event", id: event.id, at: event.at, event });
      continue;
    }
    const visit = byId.get(visitKey);
    let group = groups.get(visitKey);
    if (group === undefined) {
      group = {
        kind: "visit",
        id: visitKey,
        at: visit?.started_at ?? event.at,
        visit,
        title: visit?.number ?? (event.kind === "visit" ? event.title : "Visit"),
        by: visit?.clinician.name ?? event.by?.name,
        counts: { notes: 0, recordings: 0, files: 0, procedures: 0 },
      };
      groups.set(visitKey, group);
      entries.push(group);
    }
    if (event.kind === "visit") {
      if (visit === undefined) {
        group.at = event.at;
        group.title = event.title;
        group.by = event.by?.name ?? group.by;
      }
    } else {
      if (visit === undefined && Date.parse(event.at) > Date.parse(group.at)) group.at = event.at;
      if (event.kind === "note") group.counts.notes += 1;
      else if (event.kind === "procedure") group.counts.procedures += 1;
      else if (RECORDING_KINDS.has(event.title)) group.counts.recordings += 1;
      else group.counts.files += 1;
    }
  }
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function VisitTimeline({ events, visits, limit, onOpen }: { events: readonly TimelineEvent[]; visits: readonly Visit[]; limit: number; onOpen: (visit: Visit) => void }) {
  const entries = groupTimeline(events, visits).slice(0, limit);
  return (
    <Timeline
      label="Clinical history"
      items={entries.map((entry) => {
        if (entry.kind === "event") {
          return {
            id: entry.id,
            when: formatDate(entry.at),
            title: entry.event.title,
            detail: [entry.event.detail, entry.event.by?.name].filter((part) => part != null && part !== "").join(" · ") || undefined,
          };
        }
        const summary = countsText(entry.counts);
        const complaint = entry.visit?.chief_complaint ?? "";
        const visit = entry.visit;
        return {
          id: entry.id,
          when: formatDate(entry.at),
          title:
            visit === undefined ? (
              entry.title
            ) : (
              <button type="button" className="mk-link p360-visitlink" aria-label={`Show what was done in visit ${visit.number}`} onClick={() => { onOpen(visit); }}>
                {visit.number}
              </button>
            ),
          detail: [entry.by ?? "", summary, complaint].filter((part) => part !== "").join(" · "),
        };
      })}
    />
  );
}
