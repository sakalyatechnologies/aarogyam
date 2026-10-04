import { Activity, LogOut } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";

import { renderRouterLink } from "@aarogyam/app-kit";
import { useAuth, useAuthState } from "@aarogyam/auth";
import { AppShell, IconButton, Skeleton, UserChip, type NavEntry } from "@sakalya/ui";

import { ConsoleBrand } from "../brand.js";

const NAV: readonly NavEntry[] = [{ id: "health", label: "Service health", icon: <Activity />, href: "/health" }];

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
    return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function ConsoleLayout() {
  const auth = useAuth();
  const state = useAuthState();
  const location = useLocation();
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
