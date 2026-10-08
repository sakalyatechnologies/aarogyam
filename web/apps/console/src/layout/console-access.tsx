import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Outlet } from "react-router";

import { unwrap } from "@aarogyam/api-client";
import { ApiErrorNotice } from "@aarogyam/app-kit";
import { signOutToSite, useAuth } from "@aarogyam/auth";
import { Skeleton } from "@sakalya/ui";

import { useApi } from "../api.js";
import { centralSignInSetting } from "../env.js";
import { MfaGate } from "./mfa-gate.js";

export const NO_CONSOLE_ACCESS = "This account doesn't have Sakalya console access";

/** How long the message stays up before the person is sent to the website. */
const READ_MS = 3000;

/** Set once this page load turned someone away, so the message outlives the sign-out that follows it. */
let turnedAway = false;

export function wasTurnedAway(): boolean {
  return turnedAway;
}

/** Ends this session everywhere and, in deployed builds, returns to the website after a moment. */
export function useLeaveForNoAccess(active: boolean) {
  const auth = useAuth();
  useEffect(() => {
    if (active) {
      turnedAway = true;
      void signOutToSite(auth, centralSignInSetting(), READ_MS);
    }
  }, [active, auth]);
}

/** The message shown to someone without console access (they are signed out everywhere). */
export function NoConsoleAccessMessage() {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-10">
      <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
        {NO_CONSOLE_ACCESS}. You have been signed out.
      </p>
    </main>
  );
}

function NoConsoleAccess() {
  useLeaveForNoAccess(true);
  return <NoConsoleAccessMessage />;
}

/** Lets only Sakalya staff (`/me` says `console_access`) see the console; anyone else is signed out everywhere. */
export function ConsoleAccessGate() {
  const api = useApi();
  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => unwrap(api.getMe({ signal })) });
  if (me.isPending) {
    return (
      <div className="p-6" role="status" aria-label="Checking console access">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (me.isError) {
    return <ApiErrorNotice title="Couldn't check your access" error={me.error} onRetry={() => void me.refetch()} />;
  }
  if (!me.data.console_access) {
    return <NoConsoleAccess />;
  }
  return (
    <MfaGate>
      <Outlet />
    </MfaGate>
  );
}
