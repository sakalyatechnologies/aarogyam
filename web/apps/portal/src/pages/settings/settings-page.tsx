import { useSearchParams } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { Tabs, type TabItem } from "@sakalya/ui";

import { MkCard, PageHeader } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { BookingPanel } from "./booking-panel.js";
import { ChairsDoctorsPanel } from "./chairs-doctors-panel.js";
import { LetterheadPanel } from "./letterhead-panel.js";
import { PriceListPanel } from "./price-list-panel.js";
import { ProfileTab } from "./profile-panel.js";
import { SessionsPanel } from "./sessions-panel.js";
import { TeamPanel } from "./team-panel.js";
import { ThemePanel } from "./theme-panel.js";
import { WebsitePanel } from "./website/website-panel.js";
import "./settings.css";

/** Older names for a tab: /staff and the roles editor link to `?tab=staff` or `?tab=roles`. */
const ALIASES: Readonly<Record<string, string>> = { staff: "team", roles: "team" };

/**
 * Settings: one tab per area, each showing only its own panel. The open tab is `?tab=` in the URL,
 * so refresh, back and links such as `/settings?tab=website` land on it. Each tab keeps its own gate.
 */
export function SettingsPage() {
  const { session, can } = useClinic();
  useDocumentTitle("Settings", session.clinic.name);
  const [params, setParams] = useSearchParams();
  const owner = can("settings.manage");
  const items: TabItem[] = [
    { value: "profile", label: owner ? "Clinic profile" : "Your account", content: <ProfileTab /> },
    ...(owner ? [{ value: "letterhead", label: "Letterhead", content: <LetterheadPanel /> }] : []),
    ...(owner ? [{ value: "theme", label: "Theme", content: <ThemePanel /> }] : []),
    ...(owner ? [{ value: "chairs-doctors", label: "Chairs and doctors", content: <MkCard hint="Chairs and rooms, doctors with their working hours, and leave"><ChairsDoctorsPanel /></MkCard> }] : []),
    ...(can("billing.read") ? [{ value: "price-list", label: "Price list", content: <MkCard title="Price list" hint="Services and their fees, used on bills and your website"><PriceListPanel /></MkCard> }] : []),
    ...(can("staff.manage") || can("roles.manage") ? [{ value: "team", label: "Team & roles", content: <MkCard title="Team & roles" hint="Who works here, and what each role can see and do"><TeamPanel /></MkCard> }] : []),
    { value: "booking", label: "Booking & notifications", content: <BookingPanel /> },
    ...(owner ? [{ value: "website", label: "Website", content: <MkCard><WebsitePanel /></MkCard> }] : []),
    { value: "sessions", label: "Sessions", content: <MkCard title="Sessions" hint="The devices you are signed in on"><SessionsPanel /></MkCard> },
  ];
  const raw = params.get("tab") ?? "";
  const requested = ALIASES[raw] ?? raw;
  const active = items.find((item) => item.value === requested)?.value ?? items[0]?.value ?? "profile";
  return (
    <div className="mk-panel">
      <PageHeader eyebrow={session.clinic.name} title="Settings" subtitle="Your clinic's profile and look, chairs and doctors, prices, team, booking, website and signed-in devices." />
      <Tabs
        className="st-tabs"
        label="Settings"
        items={items}
        value={active}
        onValueChange={(next) => {
          // A new tab drops the old one's own parameters (such as the open role); back returns to it.
          setParams({ tab: next });
        }}
      />
    </div>
  );
}
