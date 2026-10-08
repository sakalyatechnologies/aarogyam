import { ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { CodeInput, AuthHeading, signOutToSite, useAuth, type EmailCodeAuthClient, type MfaEnrolment, type MfaStatus } from "@aarogyam/auth";
import { Button, Field, Skeleton } from "@sakalya/ui";

import { centralSignInSetting } from "../env.js";
import { ConsoleAuthShell } from "../pages/sign-in-page.js";

type Phase = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; status: MfaStatus };

/**
 * Sakalya staff need a second step before the console: a code from an authenticator app. Someone
 * with no authenticator yet enrols one here; otherwise they enter the current code. The API also
 * refuses console calls from a session that has not passed it (`aal2`). Development sign-in has
 * no second step, so it passes straight through.
 */
export function MfaGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.kind !== "email_code") {
    return <>{children}</>;
  }
  return <SecondStep auth={auth}>{children}</SecondStep>;
}

function SecondStep({ auth, children }: { auth: EmailCodeAuthClient; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    void auth.mfa.status().then((result) => {
      if (live) {
        setPhase(result.ok ? { kind: "ready", status: result.status } : { kind: "error", message: result.message });
      }
    });
    return () => {
      live = false;
    };
  }, [auth, round]);

  if (phase.kind === "loading") {
    return (
      <div className="p-6" role="status" aria-label="Checking your second step">
        <Skeleton shape="block" />
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <ConsoleAuthShell>
        <AuthHeading title="Second step" subtitle={phase.message} />
        <Button
          onClick={() => {
            setPhase({ kind: "loading" });
            setRound(round + 1);
          }}
        >
          Try again
        </Button>
      </ConsoleAuthShell>
    );
  }
  if (phase.status.step === "done") {
    return <>{children}</>;
  }
  return (
    <ConsoleAuthShell>
      {phase.status.step === "enrol" ? (
        <Enrol auth={auth} onDone={() => { setRound(round + 1); }} />
      ) : (
        <Verify auth={auth} factorId={phase.status.factorId} onDone={() => { setRound(round + 1); }} />
      )}
      <p className="mt-6 text-sm text-muted">
        <button type="button" className="font-semibold text-primary-text underline-offset-2 hover:underline" onClick={() => void signOutToSite(auth, centralSignInSetting())}>
          Sign out
        </button>
      </p>
    </ConsoleAuthShell>
  );
}

function useCodeStep(auth: EmailCodeAuthClient, factorId: string | undefined, onDone: () => void) {
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (factorId === undefined) {
      return;
    }
    setBusy(true);
    setProblem(undefined);
    const outcome = await auth.mfa.verify(factorId, code);
    setBusy(false);
    if (outcome.ok) {
      onDone();
    } else {
      setCode("");
      setProblem(outcome.message);
    }
  };
  return { code, setCode, problem, busy, submit };
}

function CodeForm({ step, label }: { step: ReturnType<typeof useCodeStep>; label: string }) {
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void step.submit();
      }}
    >
      <Field label={label}>
        <CodeInput value={step.code} onValueChange={step.setCode} disabled={step.busy} />
      </Field>
      {step.problem === undefined ? null : (
        <p role="alert" className="text-sm font-medium text-danger-text">
          {step.problem}
        </p>
      )}
      <Button type="submit" disabled={step.busy || step.code.length !== 6}>
        {step.busy ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}

function Verify({ auth, factorId, onDone }: { auth: EmailCodeAuthClient; factorId: string; onDone: () => void }) {
  const step = useCodeStep(auth, factorId, onDone);
  return (
    <>
      <AuthHeading title="Enter your authenticator code" subtitle="Sakalya console access needs a second step. Open your authenticator app and enter the 6-digit code for Aarogyam." />
      <CodeForm step={step} label="6-digit code" />
    </>
  );
}

function Enrol({ auth, onDone }: { auth: EmailCodeAuthClient; onDone: () => void }) {
  const [enrolment, setEnrolment] = useState<MfaEnrolment | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void auth.mfa.enrol().then((result) => {
      if (!live) {
        return;
      }
      if (result.ok) {
        setEnrolment(result.enrolment);
      } else {
        setError(result.message);
      }
    });
    return () => {
      live = false;
    };
  }, [auth]);
  const step = useCodeStep(auth, enrolment?.factorId, onDone);
  return (
    <>
      <AuthHeading title="Set up your authenticator" subtitle="Sakalya console access needs a second step. Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy), then enter the 6-digit code it shows." />
      {error === undefined ? null : (
        <p role="alert" className="mt-4 text-sm font-medium text-danger-text">
          {error}
        </p>
      )}
      {enrolment === undefined ? (
        error === undefined ? <div className="h-44" role="status" aria-label="Preparing your authenticator"><Skeleton shape="block" /></div> : null
      ) : (
        <>
          <div className="mt-4 flex items-center gap-4">
            <img src={enrolment.qrCode} alt="QR code for your authenticator app" width={168} height={168} className="rounded-xl border border-border bg-white p-2" />
            <div className="text-sm text-muted">
              <p className="flex items-center gap-1 font-semibold text-text"><ShieldCheck aria-hidden="true" className="size-4" /> Can't scan?</p>
              <p>Enter this key by hand:</p>
              <code className="break-all font-mono text-text">{enrolment.secret}</code>
            </div>
          </div>
          <CodeForm step={step} label="6-digit code from the app" />
        </>
      )}
    </>
  );
}
