import { Building2, CalendarCheck, CalendarRange, ListOrdered, LogOut, MessageSquare, Package, Settings, Smile, UsersRound, Wallet } from "lucide-react";
import { useMemo } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";

import { hasPermission, readBranding, type ClinicAccess } from "@aarogyam/api-client";
import { ApiErrorNotice, renderRouterLink } from "@aarogyam/app-kit";
import { useAuth, useAuthState } from "@aarogyam/auth";
import { createTheme, parseHexColor, preset } from "@sakalya/tokens";
import { AppShell, Avatar, Button, Card, EmptyState, IconButton, Menu, Skeleton, ThemeScope, UserChip, type NavEntry } from "@sakalya/ui";

import { ClinicProvider, useClinic, useClinicChoice, useMe, useServices, useSession, type ClinicContextValue } from "../clinic.js";

const DEFAULT_BRAND = preset("mint").brand;

function Loading({ label }: { label: string }) {
  return (
    <div className="p-6" role="status" aria-label={label}>
      <Skeleton shape="block" />
    </div>
  );
}

/** Sends signed-out visitors to sign-in, remembering where they were going. */
export function RequireAuth() {
  const state = useAuthState();
  const location = useLocation();
  if (state.status === "loading") {
    return <Loading label="Checking your session" />;
  }
  if (state.status === "signed_out") {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/**
 * Loads who the user is, settles which clinic they are working in, loads that clinic's session
 * (role, permissions, branding) and applies its white-label theme.
 */
export function ClinicGate() {
  const services = useServices();
  const auth = useAuth();
  const me = useMe();
  const choice = useClinicChoice(me.data);
  const host = choice.current?.host ?? choice.current?.slug;
  const api = host === undefined ? undefined : services.clinic(host);
  const session = useSession(api, host);
  const branding = session.data === undefined ? {} : readBranding(session.data.clinic.branding);
  const theme = useMemo(
    () => createTheme({ brand: parseHexColor(branding.brand ?? "") ?? DEFAULT_BRAND, mode: branding.mode ?? "light" }),
    [branding.brand, branding.mode],
  );

  if (me.isPending) {
    return <Loading label="Loading your clinics" />;
  }
  if (me.isError) {
    return <ApiErrorNotice title="Couldn't load your clinics" error={me.error} onRetry={() => void me.refetch()} />;
  }
  if (choice.clinics.length === 0) {
    return (
      <EmptyState
        title="You're not part of a clinic yet"
        description="Open the invitation link your clinic sent you, or ask the owner to invite you."
        action={
          <Button variant="secondary" onClick={() => void auth.signOut()}>
            Sign out
          </Button>
        }
      />
    );
  }
  if (choice.current === undefined || api === undefined) {
    return <ChooseClinic clinics={choice.clinics} onChoose={choice.choose} />;
  }
  if (session.isPending) {
    return <Loading label="Opening the clinic" />;
  }
  if (session.isError) {
    return <ApiErrorNotice title="Couldn't open this clinic" error={session.error} onRetry={() => void session.refetch()} />;
  }
  const value: ClinicContextValue = {
    me: me.data,
    access: choice.current,
    session: session.data,
    api,
    can: (permission) => hasPermission(session.data.membership.permissions, permission),
    switchClinic: choice.choose,
  };
  return (
    <ClinicProvider value={value}>
      <ThemeScope theme={theme} className="min-h-full">
        <PortalShell />
      </ThemeScope>
    </ClinicProvider>
  );
}

function ChooseClinic({ clinics, onChoose }: { clinics: readonly ClinicAccess[]; onChoose: (clinic: ClinicAccess) => void }) {
  const { mode } = useServices();
  const strayHost = mode === "http" && window.location.hostname.split(".").length > 2 && !window.location.hostname.startsWith("app.");
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-text">Choose a clinic</h1>
        <p className="mb-5 text-sm text-muted">
          {strayHost
            ? `You aren't a member of the clinic at ${window.location.hostname}. Open one of yours:`
            : "You work at more than one clinic. You can switch later from the top bar."}
        </p>
        <ul className="flex flex-col gap-2">
          {clinics.map((clinic) => (
            <li key={clinic.org_id}>
              <button
                type="button"
                onClick={() => {
                  onChoose(clinic);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span aria-hidden="true">
                  <Avatar name={clinic.name} size="sm" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-text">{clinic.name}</span>
                  <span className="block text-xs text-muted">{clinic.role_name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}

function PortalShell() {
  const { me, access, session, can, switchClinic } = useClinic();
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Calendar, Billing and Settings show once their screens land; Stock and Messages are Phase 2
  // per docs/ui-spec.md and stay visible as "coming soon" so the design language is in place.
  const nav: NavEntry[] = [
    ...(can("appointments.read") ? [{ id: "today", label: "Today", icon: <CalendarCheck />, href: "/today" }] : []),
    ...(can("patients.read") ? [{ id: "patients", label: "Patients", icon: <UsersRound />, href: "/patients" }] : []),
    ...(can("appointments.read") ? [{ id: "calendar", label: "Calendar", icon: <CalendarRange />, href: "/calendar" }] : []),
    ...(can("appointments.read") ? [{ id: "queue", label: "Queue", icon: <ListOrdered />, href: "/queue" }] : []),
    ...(can("billing.read") ? [{ id: "billing", label: "Billing", icon: <Wallet />, href: "/billing" }] : []),
    { id: "stock", label: "Stock", icon: <Package />, href: "/stock" },
    { id: "messages", label: "Messages", icon: <MessageSquare />, href: "/messages" },
    // Everyone gets a Settings entry for their own sessions; the clinic profile and staff panels
    // inside show only with settings.manage and staff.manage.
    { id: "settings", label: "Settings", icon: <Settings />, href: "/settings" },
  ];
  const activeId = nav.find((entry) => location.pathname.startsWith(entry.href))?.id ?? "";
  const others = me.clinics.filter((clinic) => clinic.org_id !== access.org_id);
  return (
    <AppShell
      brand={
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-on-primary">
            <Smile aria-hidden="true" className="size-6" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight text-text">{session.clinic.name}</p>
            <p className="text-xs text-muted">Dental clinic · Aarogyam</p>
          </div>
        </div>
      }
      nav={nav}
      activeId={activeId}
      renderLink={renderRouterLink}
      topBarEnd={
        <>
          {others.length > 0 ? (
            <Menu
              label={access.name}
              icon={<Building2 aria-hidden="true" />}
              items={others.map((clinic) => ({ id: clinic.org_id, label: `Switch to ${clinic.name}` }))}
              onSelect={(id) => {
                const clinic = others.find((c) => c.org_id === id);
                if (clinic !== undefined) {
                  switchClinic(clinic);
                  void navigate("/");
                }
              }}
            />
          ) : null}
          <UserChip name={session.user.display_name} role={access.role_name} />
          <IconButton
            label="Sign out"
            onClick={() => {
              void auth.signOut();
            }}
          >
            <LogOut aria-hidden="true" className="size-5" />
          </IconButton>
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}
