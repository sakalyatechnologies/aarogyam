import { useState } from "react";
import { Link } from "react-router";

import { Pills } from "@sakalya/ui";

import { Empty, MkCard, Tag } from "../../../components/mk/index.js";
import { useInbox, why } from "./queries.js";

const WHEN = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Booking requests waiting for the clinic: reminders for everyone who handles the appointment, escalations for the owners. */
export function InboxTab() {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const inbox = useInbox(filter === "open", true);
  return (
    <MkCard title="Booking requests">
      <Pills
        label="Show"
        options={[
          { value: "open" as const, label: "Waiting" },
          { value: "all" as const, label: "All" },
        ]}
        value={filter}
        onValueChange={setFilter}
      />
      {inbox.isPending ? <p className="mk-hint" role="status">Loading the inbox…</p> : null}
      {inbox.isError ? (
        <p role="alert" className="ms-error">
          Couldn't load the inbox. {why(inbox.error)}{" "}
          <button type="button" className="ms-link" onClick={() => { void inbox.refetch(); }}>
            Try again
          </button>
        </p>
      ) : null}
      {inbox.isSuccess && inbox.data.items.length === 0 ? (
        <Empty title={filter === "open" ? "Nothing waiting" : "The inbox is empty"}>Booking requests that need an answer show up here.</Empty>
      ) : null}
      {inbox.isSuccess && inbox.data.items.length > 0 ? (
        <ul className="ms-picker" aria-label="Inbox">
          {inbox.data.items.map((m) => (
            <li key={m.id} className="ms-pick">
              <span className="ms-pick-name">
                {m.kind === "booking_escalation" ? "Still unanswered: " : "Booking request: "}
                {WHEN.format(new Date(m.starts_at))} with {m.practitioner_name}
              </span>
              <Tag tone={m.open ? "wait" : "done"}>{m.open ? "Waiting" : "Handled"}</Tag>
              {m.open ? (
                <Link className="ms-link" to="/calendar">
                  Open calendar
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </MkCard>
  );
}
