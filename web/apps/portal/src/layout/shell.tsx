import {
  Bell,
  CalendarCheck,
  CalendarRange,
  ListOrdered,
  LogOut,
  MessageSquare,
  Mic,
  Package,
  Pill,
  Plus,
  Search,
  Settings,
  Menu as MenuIcon,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { useAuth } from "@aarogyam/auth";
import { useToast } from "@sakalya/ui";

import { MkAvatar, initials } from "../components/mk/index.js";
import { useClinic } from "../clinic.js";
import { usePatients, useToday } from "../queries.js";
import { PeekProvider, usePatientPeek } from "./peek.js";

interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  badge?: number | undefined;
}

/** Closes a popover on Escape or a click outside it. */
function useDismiss(open: boolean, close: () => void) {
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
                onClick={onNavigate}
              >
                <span className="mk-ico" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
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

function ClinicSwitch() {
  const { access, me, switchClinic } = useClinic();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => {
    setOpen(false);
  });
  const others = me.clinics.filter((clinic) => clinic.org_id !== access.org_id);
  const listId = useId();
  return (
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
  );
}

/** Top-bar search: finds a patient by name, number or phone (never put in a URL) and opens the quick look. */
function TopSearch() {
  const { can } = useClinic();
  const peek = usePatientPeek();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const ref = useDismiss(open, () => {
    setOpen(false);
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const search = usePatients(can("patients.read") ? query : "\u0000");
  if (!can("patients.read")) {
    return <div className="mk-cmdk" />;
  }
  const results =
    query.length < 2 ? [] : (search.data?.items ?? []).slice(0, 6);
  return (
    <div className="mk-cmdk" ref={ref}>
      <label>
        <Search aria-hidden="true" />
        <span className="mk-sr">Quick search</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && text.trim().length >= 2}
          aria-controls={listId}
          autoComplete="off"
          placeholder="Search patients, bills, treatments…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
        />
        <kbd aria-hidden="true">⌘K</kbd>
      </label>
      {open && text.trim().length >= 2 ? (
        <ul
          className="mk-results"
          id={listId}
          role="listbox"
          aria-label="Patients"
        >
          {search.isFetching || query !== text.trim() ? (
            <li className="mk-none" role="presentation">
              <span className="mk-none">Searching…</span>
            </li>
          ) : results.length === 0 ? (
            <li role="presentation">
              <span className="mk-none">No patients match.</span>
            </li>
          ) : (
            results.map((patient) => (
              <li key={patient.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setOpen(false);
                    setText("");
                    peek({
                      id: patient.id,
                      name: patient.full_name,
                      number: patient.number,
                    });
                  }}
                >
                  <MkAvatar name={patient.full_name} />
                  <span>
                    {patient.full_name}
                    <small>{patient.number}</small>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function Account() {
  const { session, access } = useClinic();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => {
    setOpen(false);
  });
  return (
    <div className="mk-account" ref={ref}>
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
          <button
            type="button"
            onClick={() => {
              void auth.signOut();
            }}
          >
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
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
  const { can } = useClinic();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();
  const [menuOpen, setMenuOpen] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const mainId = useId();
  const mainRef = useRef<HTMLElement>(null);
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
    ...(can("clinical.read")
      ? [
          {
            id: "prescriptions",
            label: "Prescriptions",
            icon: <Pill />,
            href: "/prescriptions",
          },
        ]
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
  const activeId =
    [...workspace, ...system].find((entry) =>
      location.pathname.startsWith(entry.href),
    )?.id ?? "";

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
    <div className="mk-app">
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
      <aside
        ref={sideRef}
        className={`mk-side ${menuOpen ? "open" : ""}`}
        aria-label="Sidebar"
      >
        <div className="mk-logo">
          <div className="mk-logo-mark" aria-hidden="true">
            आ
          </div>
          <div>
            <b>Aarogyam</b>
            <small>Clinic OS · v0.1</small>
          </div>
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
        <div className="mk-side-foot">
          <b>✦ AI Scribe</b>
          <br />
          Voice-to-note drafting is planned for a later release. Nothing is
          recorded yet.
          <button type="button" disabled>
            Review notes
          </button>
        </div>
      </aside>
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
          <TopSearch />
          <div className="mk-top-actions">
            <button
              type="button"
              className="mk-btn mk-btn-ghost mk-hide-sm"
              disabled
              title="Voice notes arrive in a later release"
            >
              <Mic aria-hidden="true" /> Voice note
            </button>
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
        <main id={mainId} ref={mainRef} tabIndex={-1} className="outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
