import { useState } from "react";

import { useDocumentTitle } from "@aarogyam/app-kit";

import { Empty, Kpi, MkCard } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";

/**
 * Messages is a Phase 2 screen (docs/ui-spec.md): no endpoint exists yet, so every number is an
 * empty value and every action is disabled. The layout is the mock-up's, ready for real data.
 */
export function MessagesPage() {
  const { session } = useClinic();
  useDocumentTitle("Messages", session.clinic.name);
  const [channel, setChannel] = useState<"whatsapp" | "sms">("whatsapp");
  return (
    <div className="mk-panel">
      <h1 className="mk-sr">Messages</h1>
      <p className="mk-hint" role="note" style={{ marginTop: 6 }}>
        Reminders, recalls and campaigns arrive in a later release. Nothing is sent from here yet.
      </p>
      <div className="mk-kpis">
        <Kpi label="Sent this month" value="—" pill="no data yet" />
        <Kpi label="WhatsApp" value="—" pill="no data yet" />
        <Kpi label="Cost this month" value="—" pill="no data yet" />
        <Kpi label="Opt-outs" value="—" pill="no data yet" />
      </div>
      <div className="mk-grid mk-g2">
        <MkCard title="Templates" hint="DLT-registered · Meta-approved ✓ once templates are set up">
          <Empty title="No templates yet">Appointment reminders, receipts and recall messages will be listed here.</Empty>
        </MkCard>
        <MkCard title="Recall campaign" hint="6-month cleaning · patients due appear here">
          <label className="mk-flabel" htmlFor="recall-audience">
            Audience
          </label>
          <input id="recall-audience" className="mk-tin" disabled readOnly placeholder="Patients with promotional consent and a recall due" />
          <div className="mk-flabel">Message preview</div>
          <div className="mk-bubble">
            Namaste 🙏 This is <b>{session.clinic.name}</b>. Your 6-month cleaning is due! Reply <b>YES</b> to book your preferred slot.
          </div>
          <div className="mk-flabel" id="recall-channel">
            Channel
          </div>
          <div role="group" aria-labelledby="recall-channel" style={{ display: "flex", gap: 8 }}>
            {(["whatsapp", "sms"] as const).map((c) => (
              <button
                key={c}
                type="button"
                className="mk-chipf"
                aria-pressed={channel === c}
                onClick={() => {
                  setChannel(c);
                }}
              >
                {c === "whatsapp" ? "WhatsApp" : "SMS"}
              </button>
            ))}
          </div>
          <button type="button" className="mk-btn mk-btn-primary" style={{ marginTop: 16, width: "100%" }} disabled>
            ▶ Send to 0 patients
          </button>
        </MkCard>
      </div>
    </div>
  );
}
