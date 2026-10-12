import { useState } from "react";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { PageHeader as DisplayHeader, Pills } from "@sakalya/ui";

import { Empty } from "../../../components/mk/index.js";
import { useClinic } from "../../../clinic.js";
import { ChatTab } from "./chat-tab.js";
import { PatientsTab } from "./patients-tab.js";
import "./messages-v2.css";

type Area = "patients" | "chat";

/** Messages in the New look: messages and offers to patients, and chat with the team. Each tab shows only what the role may do. */
export function MessagesV2() {
  const { session, can } = useClinic();
  useDocumentTitle("Messages", session.clinic.name);
  const patients = can("messages.send") || can("campaigns.manage");
  const chat = can("chat.use");
  const areas = [...(patients ? [{ value: "patients" as const, label: "Patients" }] : []), ...(chat ? [{ value: "chat" as const, label: "Staff chat" }] : [])];
  const [chosen, setChosen] = useState<Area>("patients");
  const area = areas.some((a) => a.value === chosen) ? chosen : areas[0]?.value;

  return (
    <div className="mk-panel ms-page">
      <DisplayHeader variant="display" title="Messages" subtitle={area === "chat" ? "Channels and direct messages with your team" : "Email and offers to your patients"} />
      {area === undefined ? (
        <Empty title="Messages aren't available to your role">Ask the owner if you need to write to patients or chat with the team.</Empty>
      ) : (
        <>
          {areas.length > 1 ? <Pills label="Messages area" options={areas} value={area} onValueChange={setChosen} /> : null}
          {area === "patients" ? <PatientsTab /> : <ChatTab />}
        </>
      )}
    </div>
  );
}
