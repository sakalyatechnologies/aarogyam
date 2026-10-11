import {
  Bell,
  ChartNoAxesCombined,
  ReceiptIndianRupee,
  CalendarCheck,
  CalendarRange,
  ListOrdered,
  LogOut,
  MessageSquare,
  Package,
  Plus,
  Search,
  Settings,
  ChevronsLeft,
  Menu as MenuIcon,
  UserCog,
  UsersRound,
  X,
  Wallet,
  KeyRound,
  Sparkles,
} from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { PasswordDialog, signOutToSite, supportsPassword, useAuth, usePasswordDialog } from "@aarogyam/auth";
import { useToast } from "@sakalya/ui";

import { initials } from "../components/mk/index.js";
import { useClinic } from "../clinic.js";
import { centralSignInSetting } from "../env.js";
import { useToday } from "../queries.js";
import { ClinicMark } from "./clinic-mark.js";
import { CommandPalette } from "./command-palette.js";
import { useNewLook } from "../lib/new-look.js";
import { useStoredFlag } from "./use-stored-flag.js";
import { LegalLinks } from "../components/legal-links.js";
import { PeekProvider } from "./peek.js";
import { PageTransition } from "./page-transition.js";
import { ProgressBar } from "./progress-bar.js";

/** The rail's widths on wide screens (the drawer under 1120px keeps its own width in CSS). */
const RAIL_OPEN = "248px";
const RAIL_SHUT = "72px";
const RAIL_SPRING = { type: "spring", stiffness: 300, damping: 26 } as const;

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  badge?: number | undefined;
}

/** Closes a popover on Escape or a click outside it. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (
        ref.current !== null &&
        event.target instanceof Node &&
        !ref.current.contains(event.target)
      ) {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);
  return ref;
}

function NavGroup({
  label,
  items,
  activeId,
  onNavigate,
}: {
  label: string;
  items: readonly NavItem[];
  activeId: string;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="mk-navlbl" id={`nav-${label}`}>
        {label}
      </div>
      <div className="mk-nav">
        <ul aria-labelledby={`nav-${label}`}>
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.href}
                aria-current={item.id === activeId ? "page" : undefined}
                title={item.label}
                onClick={onNavigate}
              >
                {item.id === activeId ? <m.div layoutId="railbar" className="mk-railbar" aria-hidden="true" /> : null}
                <span className="mk-ico" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="mk-nav-t">{item.label}</span>
                {item.badge === undefined || item.badge <= 0 ? null : (
                  <span className="mk-bdg">{item.badge}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export function ClinicSwitch() {
  const { access, me, switchClinic } = useClinic();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => {
    setOpen(false);
  });
  const others = me.clinics.filter((clinic) => clinic.org_id !== access.org_id);
  const listId = useId();
  return (
    <div className="mk-clinic-wrap">
      <div className="mk-clinic" ref={ref}>
        <button
          type="button"
          disabled={others.length === 0}
          aria-expanded={others.length === 0 ? undefined : open}
          aria-controls={others.length === 0 ? undefined : listId}
          aria-label={`Clinic: ${access.name}${others.length === 0 ? "" : ". Switch clinic"}`}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <b>{access.name}</b>
          <span>
            {access.role_name}
            {others.length === 0 ? "" : " ▾"}
          </span>
        </button>
        {open ? (
          <ul id={listId}>
            {others.map((clinic) => (
              <li key={clinic.org_id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    switchClinic(clinic);
                    void navigate("/");
                  }}
                >
                  Switch to {clinic.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** Phones have no keyboard shortcut: an icon-only search button, shown under 640px, opens the same palette. */
function PhoneSearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="mk-iconbtn mk-phone-search" aria-label="Search" onClick={onOpen}>
      <Search aria-hidden="true" />
    </button>
  );
}

export function Account() {
  const { session, access } = useClinic();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const password = usePasswordDialog();
  const [newLook, setNewLook] = useNewLook();
  const ref = useDismiss(open, () => {
    setOpen(false);
  });
  return (
    <div className="mk-account" ref={ref}>
      {supportsPassword(auth) ? <PasswordDialog auth={auth} open={password.open} onOpenChange={password.setOpen} /> : null}
      <button
        type="button"
        className="mk-avatar"
        aria-label={`Account: ${session.user.display_name}`}
        aria-expanded={open}
        title={session.user.display_name}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {initials(session.user.display_name)}
      </button>
      {open ? (
        <div className="mk-pop">
          <p>
            <b>{session.user.display_name}</b>
            {access.role_name} · {access.name}
          </p>
          {/* Interim switch for the redesigned screens; the shell work replaces it with a real preference. */}
          <button
            type="button"
            role="switch"
            aria-checked={newLook}
            onClick={() => {
              setNewLook(!newLook);
            }}
          >
            <Sparkles aria-hidden="true" /> New look: {newLook ? "On" : "Off"}
          </button>
          {supportsPassword(auth) ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                password.setOpen(true);
              }}
            >
              <KeyRound aria-hidden="true" /> Password
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void signOutToSite(auth, centralSignInSetting());
            }}
          >
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The rail's items, filtered by what the role may open, the one for the current address, and the pages the
 * command palette jumps to. Shared by both shells, so the routes and `can()` filtering are the same in each.
 */
export function useShellNav() {
  const { can } = useClinic();
  const location = useLocation();
  const today = useToday();
  const appointmentsToday = today.data?.counts.total;

  const workspace: NavItem[] = [
    ...(can("appointments.read")
      ? [
          {
            id: "today",
            label: "Today",
            icon: <CalendarCheck />,
            href: "/today",
            badge: appointmentsToday,
          },
        ]
      : []),
    ...(can("patients.read")
      ? [
          {
            id: "patients",
            label: "Patients",
            icon: <UsersRound />,
            href: "/patients",
          },
        ]
      : []),
    ...(can("appointments.read")
      ? [
          {
            id: "calendar",
            label: "Calendar",
            icon: <CalendarRange />,
            href: "/calendar",
          },
        ]
      : []),
    ...(can("appointments.read")
      ? [{ id: "queue", label: "Queue", icon: <ListOrdered />, href: "/queue" }]
      : []),
    ...(can("billing.read")
      ? [
          {
            id: "billing",
            label: "Billing",
            icon: <Wallet />,
            href: "/billing",
          },
        ]
      : []),
    { id: "stock", label: "Stock", icon: <Package />, href: "/stock" },
    ...(can("analytics.view")
      ? [{ id: "analytics", label: "Analytics", icon: <ChartNoAxesCombined />, href: "/analytics" }]
      : []),
    {
      id: "messages",
      label: "Messages",
      icon: <MessageSquare />,
      href: "/messages",
    },
  ];
  const system: NavItem[] = [
    {
      id: "settings",
      label: "Settings",
      icon: <Settings />,
      href: "/settings",
    },
  ];
  const activeId = [...workspace, ...system].find((entry) => location.pathname.startsWith(entry.href))?.id ?? "";
  const palettePages = [
    ...workspace,
    ...system,
    ...(can("finance.view") ? [{ id: "expenses", label: "Expenses", href: "/billing?tab=expenses", icon: <ReceiptIndianRupee /> }] : []),
    ...(can("staff.manage") || can("roles.manage") ? [{ id: "team", label: "Team & roles", href: "/settings?tab=team", icon: <UserCog /> }] : []),
  ].map((item) => ({ id: item.id, label: item.label, href: item.href, icon: item.icon }));
  return { workspace, system, activeId, palettePages };
}

/** The mock-up's shell: dark sidebar, sticky top bar (search, actions, profile), page area. */
export function MockShell() {
  return (
    <PeekProvider>
      <ShellFrame />
    </PeekProvider>
  );
}

function ShellFrame() {
  const [newLook] = useNewLook();
  const { can, session } = useClinic();
  const navigate = useNavigate();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useStoredFlag("aarogyam.portal.sidebar-collapsed");
  const sideRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const mainId = useId();
  const mainRef = useRef<HTMLElement>(null);

  const { workspace, system, activeId, palettePages } = useShellNav();

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

  return (
    <div className={`mk-app ${collapsed ? "mk-collapsed" : ""} ${newLook ? "mk-newlook" : ""}`}>
      <ProgressBar />
      <a
        href={`#${mainId}`}
        className="mk-sr"
        onFocus={(event) => {
          event.currentTarget.className = "mk-btn mk-btn-primary";
          Object.assign(event.currentTarget.style, {
            position: "fixed",
            top: "12px",
            left: "12px",
            zIndex: "300",
          });
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
      {menuOpen ? (
        <div
          className="mk-menu-scrim"
          aria-hidden="true"
          onClick={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
      <m.aside
        ref={sideRef}
        className={`mk-side ${menuOpen ? "open" : ""}`}
        aria-label="Sidebar"
        initial={false}
        animate={{ "--rail-w": collapsed ? RAIL_SHUT : RAIL_OPEN }}
        transition={reduceMotion === true ? { duration: 0 } : RAIL_SPRING}
      >
        <div className="mk-logo">
          <ClinicMark name={session.clinic.name} />
          <div className="mk-logo-t">
            <b>Aarogyam</b>
            <small>Clinic OS</small>
          </div>
          <button
            type="button"
            className="mk-collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => {
              setCollapsed(!collapsed);
            }}
          >
            <m.span className="mk-collapse-ico" initial={false} animate={{ rotate: collapsed ? 180 : 0 }} transition={RAIL_SPRING}>
              <ChevronsLeft aria-hidden="true" />
            </m.span>
          </button>
          <button
            type="button"
            className="mk-closemenu"
            aria-label="Close menu"
            onClick={() => {
              setMenuOpen(false);
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <ClinicSwitch />
        <nav aria-label="Main" className="flex flex-col gap-1.5">
          <NavGroup
            label="Workspace"
            items={workspace}
            activeId={activeId}
            onNavigate={() => {
              setMenuOpen(false);
            }}
          />
          <NavGroup
            label="System"
            items={system}
            activeId={activeId}
            onNavigate={() => {
              setMenuOpen(false);
            }}
          />
        </nav>
      </m.aside>
      <div className="mk-main">
        <div className="mk-topbar">
          <button
            type="button"
            className="mk-iconbtn mk-menubtn"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((value) => !value);
            }}
          >
            <MenuIcon aria-hidden="true" />
          </button>
          <div className="mk-top-actions">
            <PhoneSearchButton
              onOpen={() => {
                setPaletteOpen(true);
              }}
            />
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
              aria-label="Notifications"
              onClick={() => {
                toast.show({ title: "You're all caught up", tone: "neutral" });
              }}
            >
              <Bell aria-hidden="true" />
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
        <main id={mainId} ref={mainRef} tabIndex={-1} className="outline-none">
          <PageTransition />
        </main>
        <footer className="mk-foot">
          <LegalLinks />
        </footer>
      </div>
    </div>
  );
}
