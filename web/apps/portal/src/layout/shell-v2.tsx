import { Bell, ChevronsLeft, ChevronsRight, Menu as MenuIcon, Plus, Search, X } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { LegalLinks } from "../components/legal-links.js";
import { useClinic } from "../clinic.js";
import { useNewLook } from "../lib/new-look.js";
import { useClinicSetup } from "../pages/setup/queries.js";
import { ClinicMark } from "./clinic-mark.js";
import { CommandPalette } from "./command-palette.js";
import { badgeLabel, NotificationsDrawer, useBadges } from "./notifications.js";
import { PageTransition } from "./page-transition.js";
import { PeekProvider } from "./peek.js";
import { ProgressBar } from "./progress-bar.js";
import { Account, ClinicSwitch, MockShell, useShellNav, type NavItem } from "./shell.js";
import { useStoredFlag } from "./use-stored-flag.js";

/** The same flag the old sidebar remembers its collapsed state in, so the choice carries over. */
const COLLAPSED_KEY = "aarogyam.portal.sidebar-collapsed";
const RAIL_OPEN = "232px";
const RAIL_SHUT = "72px";
const RAIL_SPRING = { type: "spring", stiffness: 300, damping: 26 } as const;

/** The portal's shell: the redesigned one with the New look switch on, the original one without. */
export function ShellChoice() {
  const [newLook] = useNewLook();
  return newLook ? <ShellV2 /> : <MockShell />;
}

/** "Finish setup n/m" for owners whose setup still has steps left; nothing once it is all done. */
function useSetupProgress(): { done: number; total: number } | undefined {
  const setup = useClinicSetup();
  const data = setup.data;
  if (data === undefined || data.standing === "complete") {
    return undefined;
  }
  const done = data.steps.filter((step) => step.status !== "todo").length;
  return done >= data.steps.length ? undefined : { done, total: data.steps.length };
}

function RailItem({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  return (
    <li>
      <Link to={item.href} className="mk2-item" aria-current={active ? "page" : undefined} onClick={onNavigate}>
        <span className="mk2-ico" aria-hidden="true">
          {item.icon}
        </span>
        <span className="mk2-lbl">{item.label}</span>
        {item.badge === undefined || item.badge <= 0 ? null : <span className="mk2-bdg">{item.badge}</span>}
        {/* The collapsed rail names its icons on hover and focus; the label above already names the link for readers. */}
        <span className="mk2-tip" aria-hidden="true">
          {item.label}
        </span>
      </Link>
    </li>
  );
}

/** The redesigned shell: a floating rail that expands, a top bar with search, setup chip, bell and account. */
export function ShellV2() {
  return (
    <PeekProvider>
      <FrameV2 />
    </PeekProvider>
  );
}

function FrameV2() {
  const { can, session } = useClinic();
  const navigate = useNavigate();
  const { workspace, system, activeId, palettePages } = useShellNav();
  const [collapsed, setCollapsed] = useStoredFlag(COLLAPSED_KEY, true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const mainId = useId();
  const mainRef = useRef<HTMLElement>(null);
  const badges = useBadges();
  const unread = badges.data?.notifications_unread ?? null;
  const bellBadge = badgeLabel(unread);
  const setup = useSetupProgress();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <m.div
      className={`mk-app mk-newlook mk2 ${collapsed ? "mk2-collapsed" : ""}`}
      initial={false}
      animate={{ "--rail2-w": collapsed ? RAIL_SHUT : RAIL_OPEN }}
      transition={reduceMotion === true ? { duration: 0 } : RAIL_SPRING}
    >
      <ProgressBar />
      <a
        href={`#${mainId}`}
        className="mk-sr"
        onFocus={(event) => {
          event.currentTarget.className = "mk-btn mk-btn-primary";
          Object.assign(event.currentTarget.style, { position: "fixed", top: "12px", left: "12px", zIndex: "300" });
        }}
        onBlur={(event) => {
          event.currentTarget.className = "mk-sr";
          event.currentTarget.removeAttribute("style");
        }}
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>
      {menuOpen ? <div className="mk-menu-scrim mk2-scrim" aria-hidden="true" onClick={closeMenu} /> : null}
      <aside className={`mk2-rail ${menuOpen ? "open" : ""}`} aria-label="Sidebar">
        <div className="mk2-head">
          <Link to="/today" className="mk2-mark" aria-label={`${session.clinic.name}: Today`} onClick={closeMenu}>
            <ClinicMark name={session.clinic.name} />
          </Link>
          <div className="mk2-brand">
            <b>Aarogyam</b>
            <small>Clinic OS</small>
          </div>
          <button type="button" className="mk-closemenu mk2-close" aria-label="Close menu" onClick={closeMenu}>
            <X aria-hidden="true" />
          </button>
        </div>
        <ClinicSwitch />
        <nav aria-label="Main" className="mk2-nav">
          <ul aria-label="Workspace">
            {workspace.map((item) => (
              <RailItem key={item.id} item={item} active={item.id === activeId} onNavigate={closeMenu} />
            ))}
          </ul>
          <ul aria-label="System">
            {system.map((item) => (
              <RailItem key={item.id} item={item} active={item.id === activeId} onNavigate={closeMenu} />
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="mk2-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          onClick={() => {
            setCollapsed(!collapsed);
          }}
        >
          <span className="mk2-ico" aria-hidden="true">
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </span>
          <span className="mk2-lbl">Collapse</span>
          <span className="mk2-tip" aria-hidden="true">
            Expand
          </span>
        </button>
      </aside>
      <div className="mk-main mk2-main">
        <div className="mk-topbar mk2-top">
          <button type="button" className="mk-iconbtn mk-menubtn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen((value) => !value); }}>
            <MenuIcon aria-hidden="true" />
          </button>
          <p className="mk2-clinic-name">
            <b>{session.clinic.name}</b>
          </p>
          <button
            type="button"
            className="mk2-search"
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            <Search aria-hidden="true" />
            <span className="mk2-search-t">Search patients, pages, bills</span>
            <kbd aria-hidden="true">Ctrl K</kbd>
          </button>
          <div className="mk-top-actions">
            {setup === undefined ? null : (
              <Link to="/setup" className="mk2-chip">
                Finish setup <b>{`${String(setup.done)}/${String(setup.total)}`}</b>
              </Link>
            )}
            {can("appointments.write") ? (
              <button
                type="button"
                className="mk-btn mk-btn-primary"
                aria-label="Schedule an appointment"
                onClick={() => {
                  void navigate("/calendar?book=1");
                }}
              >
                <Plus aria-hidden="true" />
                <span>
                  New<span className="mk-hide-sm"> appointment</span>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className="mk-iconbtn"
              aria-label={bellBadge === undefined ? "Notifications" : `Notifications, ${bellBadge} unread`}
              aria-haspopup="dialog"
              aria-expanded={bellOpen}
              onClick={() => {
                setBellOpen(true);
              }}
            >
              <Bell aria-hidden="true" />
              {bellBadge === undefined ? null : (
                <span className="mk-n mk2-n" aria-hidden="true">
                  {bellBadge}
                </span>
              )}
            </button>
            <Account />
          </div>
        </div>
        <CommandPalette
          open={paletteOpen}
          pages={palettePages}
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
        <NotificationsDrawer open={bellOpen} onOpenChange={setBellOpen} />
        <main id={mainId} ref={mainRef} tabIndex={-1} className="outline-none">
          <PageTransition />
        </main>
        <footer className="mk-foot">
          <LegalLinks />
        </footer>
      </div>
    </m.div>
  );
}
