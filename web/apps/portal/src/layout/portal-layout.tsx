import { LazyMotion, MotionConfig } from "motion/react";
import { useMemo } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";

import { hasPermission, readBranding, type ClinicAccess } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { CentralSignInRedirect, signOutToSite, useAuth, useAuthState } from "@aarogyam/auth";
import { parseHexColor } from "@sakalya/tokens";
import { Avatar, Button, Card, EmptyState, Skeleton, ThemeScope } from "@sakalya/ui";

import { centralSignInSetting } from "../env.js";
import { ClinicProvider, useClinicChoice, useMe, useServices, useSession, type ClinicContextValue } from "../clinic.js";
import { MOCKUP_BRAND, mockupTheme, mockupVars } from "./mockup-theme.js";
import { loadMotionFeatures } from "./motion-features.js";
import { SetupGate } from "../pages/setup/setup-gate.js";
import { MockShell } from "./shell.js";

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
    const central = centralSignInSetting();
    if (central !== "") {
      return <CentralSignInRedirect signInUrl={central} next={window.location.host} />;
    }
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
  const navigate = useNavigate();
  const me = useMe();
  const choice = useClinicChoice(me.data);
  const host = choice.current?.host ?? choice.current?.slug;
  const api = host === undefined ? undefined : services.clinic(host);
  const session = useSession(api, host);
  const branding = session.data === undefined ? {} : readBranding(session.data.clinic.branding);
  const theme = useMemo(() => mockupTheme(parseHexColor(branding.brand ?? "") ?? MOCKUP_BRAND, branding.mode ?? "light"), [branding.brand, branding.mode]);

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
        description="Open the invitation link your clinic sent you, or ask the owner to invite you. Setting up a new clinic instead?"
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                void navigate("/register");
              }}
            >
              Register your clinic
            </Button>
            <Button variant="ghost" onClick={() => void signOutToSite(auth, centralSignInSetting())}>
              Sign out
            </Button>
          </div>
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
      <div style={{ display: "contents", ...mockupVars(theme) }}>
        <ThemeScope theme={theme} className="min-h-full">
          {/* Motion's features load after first paint; `strict` keeps the heavy `motion.*` out. */}
          <LazyMotion features={loadMotionFeatures} strict>
            <MotionConfig reducedMotion="user">
              <SetupGate>
                <MockShell />
              </SetupGate>
            </MotionConfig>
          </LazyMotion>
        </ThemeScope>
      </div>
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
