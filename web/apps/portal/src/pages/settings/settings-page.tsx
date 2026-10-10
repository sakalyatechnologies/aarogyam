import { useSearchParams } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { PageHeader as DisplayHeader, Tabs, type TabItem } from "@sakalya/ui";

import { MkCard, PageHeader } from "../../components/mk/index.js";
import { useClinic } from "../../clinic.js";
import { useNewLook } from "../../lib/new-look.js";
import { StudioPanel } from "../today/v2/studio-panel.js";
import { BookingPanel } from "./booking-panel.js";
import { ChairsDoctorsPanel } from "./chairs-doctors-panel.js";
import { LetterheadPanel } from "./letterhead-panel.js";
import { PriceListPanel } from "./price-list-panel.js";
import { MyProfile, ProfileTab } from "./profile-panel.js";
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
  const [newLook] = useNewLook();
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
    ...(newLook ? [{ value: "studio", label: "Dashboard studio", content: <MkCard title="Dashboard studio" hint="Choose what Today shows, where, and how big. Changes follow you across devices."><StudioPanel /></MkCard> }] : []),
    { value: "sessions", label: "Sessions", content: <MkCard title="Sessions" hint="The devices you are signed in on"><SessionsPanel /></MkCard> },
  ];
  const choose = (next: string) => {
    // A new tab drops the old one's own parameters (such as the open role); back returns to it.
    setParams({ tab: next });
  };
  const raw = params.get("tab") ?? "";
  const requested = ALIASES[raw] ?? raw;
  if (newLook) return <SettingsNewLook items={items} owner={owner} requested={requested} onChoose={choose} />;
  const active = items.find((item) => item.value === requested)?.value ?? items[0]?.value ?? "profile";
  return (
    <div className="mk-panel">
      <PageHeader eyebrow={session.clinic.name} title="Settings" subtitle="Your clinic's profile and look, chairs and doctors, prices, team, booking, website and signed-in devices." />
      <Tabs
        className="st-tabs"
        label="Settings"
        items={items}
        value={active}
        onValueChange={choose}
      />
    </div>
  );
}

/** The new look's order and wording: My profile first, then the studio, as in the design. */
const NEW_LOOK_ORDER = ["me", "studio", "profile", "letterhead", "theme", "chairs-doctors", "price-list", "team", "booking", "website", "sessions"];
const NEW_LOOK_LABEL: Readonly<Record<string, string>> = { "chairs-doctors": "Chairs & doctors" };

/**
 * Settings (new look): a rounded panel of sections on the left, the open section on the right. Same tabs, same `?tab=`
 * links and the same permission gates as the old page; only the frame differs. Below 900px the list becomes a row of
 * pills that scrolls sideways.
 */
function SettingsNewLook({ items, owner, requested, onChoose }: { items: TabItem[]; owner: boolean; requested: string; onChoose: (value: string) => void }) {
  // The owner's "Clinic profile" tab keeps its URL; "My profile" is a section of its own beside it.
  const all: TabItem[] = owner ? [{ value: "me", label: "My profile", content: <MyProfile /> }, ...items] : items.map((item) => (item.value === "profile" ? { ...item, label: "My profile" } : item));
  const rank = (item: TabItem) => (!owner && item.value === "profile" ? -1 : NEW_LOOK_ORDER.indexOf(item.value));
  const sorted = [...all].sort((a, b) => rank(a) - rank(b)).map((item) => ({ ...item, label: NEW_LOOK_LABEL[item.value] ?? item.label }));
  const current = sorted.find((item) => item.value === requested) ?? sorted[0];
  return (
    <div className="mk-panel st-nl">
      <DisplayHeader variant="display" title="Settings" subtitle={owner ? "Clinic-wide setup · changes apply to everyone" : "Your profile and look"} />
      <div className="st-nl-grid">
        <nav className="st-nl-nav" aria-label="Settings sections">
          {sorted.map((item) => (
            <button key={item.value} type="button" className="st-nl-item" aria-current={item.value === current?.value ? "page" : undefined} onClick={() => { onChoose(item.value); }}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="st-nl-body" key={current?.value}>
          {current?.content}
        </div>
      </div>
    </div>
  );
}
