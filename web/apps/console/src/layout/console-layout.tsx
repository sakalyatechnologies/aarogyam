import { Activity, Building2, CheckCircle2, Inbox, KeyRound, LogOut } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";

import { renderRouterLink } from "@aarogyam/app-kit";
import { CentralSignInRedirect, CONSOLE_NEXT, PasswordDialog, signOutToSite, supportsPassword, useAuth, useAuthState, usePasswordDialog } from "@aarogyam/auth";
import { AppShell, IconButton, Skeleton, UserChip, type NavEntry } from "@sakalya/ui";

import { ConsoleBrand } from "../brand.js";
import { centralSignInSetting } from "../env.js";
import { ConsoleAccessGate, NoConsoleAccessMessage, wasTurnedAway } from "./console-access.js";

const NAV: readonly NavEntry[] = [
  { id: "health", label: "Service health", icon: <Activity />, href: "/health" },
  { id: "quality", label: "Quality", icon: <CheckCircle2 />, href: "/quality" },
  { id: "applications", label: "Applications", icon: <Inbox />, href: "/applications" },
  { id: "clinics", label: "Clinics", icon: <Building2 />, href: "/clinics" },
];

/** Sends signed-out visitors to sign-in, remembering where they were going. */
export function RequireAuth() {
  const state = useAuthState();
  const location = useLocation();
  if (state.status === "loading") {
    return (
      <div className="p-6" role="status" aria-label="Checking your session">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (state.status === "signed_out") {
    if (wasTurnedAway()) {
      return <NoConsoleAccessMessage />;
    }
    const central = centralSignInSetting();
    if (central !== "") {
      return <CentralSignInRedirect signInUrl={central} next={CONSOLE_NEXT} />;
    }
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <ConsoleAccessGate />;
}

export function ConsoleLayout() {
  const auth = useAuth();
  const state = useAuthState();
  const location = useLocation();
  const password = usePasswordDialog();
  const user = state.status === "signed_in" ? state.user : undefined;
  const activeId = NAV.find((entry) => location.pathname.startsWith(entry.href))?.id ?? "";
  return (
    <AppShell
      brand={<ConsoleBrand />}
      nav={NAV}
      activeId={activeId}
      renderLink={renderRouterLink}
      topBarEnd={
        <>
          <UserChip name={user?.displayName ?? user?.email ?? "Signed in"} role="Sakalya team" />
          {supportsPassword(auth) ? (
            <>
              <IconButton
                label="Password"
                onClick={() => {
                  password.setOpen(true);
                }}
              >
                <KeyRound aria-hidden="true" className="size-5" />
              </IconButton>
              <PasswordDialog auth={auth} open={password.open} onOpenChange={password.setOpen} />
            </>
          ) : null}
          <IconButton
            label="Sign out"
            onClick={() => {
              void signOutToSite(auth, centralSignInSetting());
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
