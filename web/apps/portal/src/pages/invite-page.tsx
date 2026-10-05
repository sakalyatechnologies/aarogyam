import { MailCheck } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { useLocation, useNavigate } from "react-router";

import { useDocumentTitle } from "@aarogyam/app-kit";
import { AuthHeading, AuthSteps, SignInPanel, useAuth, useAuthState, type DevAuthClient } from "@aarogyam/auth";
import { Button, EmptyState, Field, Skeleton, TextInput } from "@sakalya/ui";

import { CLINIC_STORAGE_KEY, clinicUrl, useServices } from "../clinic.js";
import { PortalAuthShell } from "./brand.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Accepting an invitation. The token arrives in the URL fragment (`/invite#<token>`), which the
 * browser never sends to a server, so it stays out of every request log.
 */
export function InvitePage() {
  useDocumentTitle("Invitation", "Aarogyam");
  const { hash } = useLocation();
  const token = hash.startsWith("#") ? hash.slice(1) : "";
  const auth = useAuth();
  const state = useAuthState();

  if (token === "") {
    return (
      <PortalAuthShell>
        <EmptyState title="This invitation link is incomplete" description="Open the full link from your invitation message." />
      </PortalAuthShell>
    );
  }
  return (
    <PortalAuthShell>
      <AuthSteps steps={["Sign in", "Join the clinic"]} current={state.status === "signed_in" ? 1 : 0} label="Invitation steps" />
      <AuthHeading
        title="Join your clinic on Aarogyam"
        subtitle={state.status === "signed_in" ? "You're signed in. One more step." : "Sign in with the email address the invitation was sent to."}
      />
      {state.status === "loading" ? (
        <Skeleton shape="block" />
      ) : state.status === "signed_out" ? (
        auth.kind === "dev" ? (
          <JoinAsNewPerson auth={auth} />
        ) : (
          <SignInPanel auth={auth} showSteps={false} />
        )
      ) : (
        <Accept token={token} defaultName={state.user.displayName ?? ""} />
      )}
    </PortalAuthShell>
  );
}

/** Development only: a person who isn't in the seed, with a fresh ID and the invited email. */
function JoinAsNewPerson({ auth }: { auth: DevAuthClient }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setError("Enter the email address the invitation was sent to.");
      return;
    }
    auth.signInAsNew({ displayName: name.trim() === "" ? email.trim() : name.trim(), email: email.trim() });
  };
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-xs text-muted">Development sign-in: you join as a new person with this email, and no password.</p>
      <Field label="Your name">
        <TextInput autoComplete="name" value={name} onChange={(event) => { setName(event.currentTarget.value); }} />
      </Field>
      <Field label="Email" error={error} required>
        <TextInput type="email" autoComplete="email" value={email} onChange={(event) => { setEmail(event.currentTarget.value); }} />
      </Field>
      <Button type="submit">Continue</Button>
    </form>
  );
}

function Accept({ token, defaultName }: { token: string; defaultName: string }) {
  const services = useServices();
  const auth = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; wrongEmail: boolean }>();

  const accept = async () => {
    setBusy(true);
    setProblem(undefined);
    const joined = await services.neutral.acceptInvitation({ token, ...(name.trim() === "" ? {} : { display_name: name.trim() }) });
    if (!joined.ok) {
      setBusy(false);
      const status = joined.error.status;
      setProblem({
        message:
          status === 404
            ? "This invitation has been used, has expired, or doesn't exist. Ask the clinic for a new one."
            : status === 409
              ? "This invitation is for a different email address. Sign out, then join with the invited email."
              : joined.error.message,
        wrongEmail: status === 409,
      });
      return;
    }
    const me = await services.neutral.getMe();
    const clinic = me.ok ? me.value.clinics.find((c) => c.org_id === joined.value.org_id) : undefined;
    if (services.mode === "http" && clinic?.host != null) {
      window.location.assign(clinicUrl(clinic.host, "/"));
      return;
    }
    if (clinic !== undefined) {
      try {
        sessionStorage.setItem(CLINIC_STORAGE_KEY, clinic.slug);
      } catch {
        // The clinic chooser covers it.
      }
    }
    void navigate("/", { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Join the clinic to open its portal.</p>
      <Field label="Name to show colleagues" hint="Used the first time you join.">
        <TextInput autoComplete="name" value={name} onChange={(event) => { setName(event.currentTarget.value); }} />
      </Field>
      {problem === undefined ? null : (
        <div role="alert" className="flex flex-col gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
          <p>{problem.message}</p>
          {problem.wrongEmail ? (
            <Button variant="secondary" onClick={() => void auth.signOut()}>
              Sign out
            </Button>
          ) : null}
        </div>
      )}
      <Button icon={<MailCheck aria-hidden="true" className="size-4" />} disabled={busy} onClick={() => void accept()}>
        {busy ? "Joining…" : "Join the clinic"}
      </Button>
    </div>
  );
}

