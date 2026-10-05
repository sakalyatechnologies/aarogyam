import { ArrowLeft, Mail, RotateCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import { Avatar, Button, Field, TextInput } from "@sakalya/ui";

import { AUTH_MESSAGES, type AuthClient, type DevAuthClient, type EmailCodeAuthClient } from "./auth-client.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

export interface SignInPanelProps {
  auth: AuthClient;
  /** What the email field is called; "Work email" for staff, "Your email" for patients. */
  emailLabel?: string;
}

/** The sign-in form for whichever `AuthClient` the app started with. */
export function SignInPanel({ auth, emailLabel }: SignInPanelProps) {
  return auth.kind === "dev" ? <DevSignIn auth={auth} /> : <EmailCodeSignIn auth={auth} {...(emailLabel === undefined ? {} : { emailLabel })} />;
}

export interface DevSignInProps {
  auth: DevAuthClient;
}

/** Development only: one button per seeded person. */
export function DevSignIn({ auth }: DevSignInProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Development sign-in: choose a seeded person. There is no network call and no password. Set{" "}
        <code className="text-text">VITE_SUPABASE_URL</code> and <code className="text-text">VITE_SUPABASE_ANON_KEY</code> to sign in
        with an email code instead.
      </p>
      <ul className="flex flex-col gap-2" aria-label="People to sign in as">
        {auth.people.map((person, index) => {
          const nameId = `${id}name${String(index)}`;
          const descriptionId = `${id}description${String(index)}`;
          return (
            <li key={person.id}>
              <button
                type="button"
                aria-labelledby={nameId}
                aria-describedby={person.description === undefined ? undefined : descriptionId}
                onClick={() => {
                  auth.signInAs(person.id);
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span aria-hidden="true">
                  <Avatar name={person.displayName} size="sm" />
                </span>
                <span className="min-w-0">
                  <span id={nameId} className="block text-sm font-bold text-text">
                    {person.displayName}
                  </span>
                  {person.description === undefined ? null : (
                    <span id={descriptionId} className="block text-xs text-muted">
                      {person.description}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A resend timer that stays right even if the tab sleeps: it counts towards a deadline. */
function useCooldown() {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const deadline = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Unmount only: a render-keyed effect would register the interval one render after `start`
  // runs, racing whatever triggered the cooldown. Owning the interval from `start` itself keeps
  // it synchronous with the deadline it is counting down to.
  useEffect(
    () => () => {
      clearInterval(timer.current);
    },
    [],
  );

  const start = useCallback((seconds: number) => {
    clearInterval(timer.current);
    deadline.current = Date.now() + seconds * 1000;
    setSecondsLeft(seconds);
    timer.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(timer.current);
      }
    }, 1000);
  }, []);
  return { secondsLeft, start };
}

export interface EmailCodeSignInProps {
  auth: EmailCodeAuthClient;
  /** Seconds before another code may be requested. */
  cooldownSeconds?: number;
  /** What the email field is called. Defaults to "Work email". */
  emailLabel?: string;
}

/**
 * Email, then a six-digit code. Whatever happens, the form never reveals whether an email is
 * registered: an unknown address gets the same "if this email is registered" answer.
 */
export function EmailCodeSignIn({ auth, cooldownSeconds = 60, emailLabel = "Work email" }: EmailCodeSignInProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();

  const sendCode = async (address: string, again: boolean) => {
    setBusy(true);
    setProblem(undefined);
    const outcome = await auth.requestCode(address);
    setBusy(false);
    if (outcome.ok) {
      cooldown.start(cooldownSeconds);
      setStep("code");
      setNotice(
        again
          ? `If ${address} is registered, we've sent a new code to it.`
          : `If ${address} is registered, we've sent a ${String(CODE_LENGTH)}-digit code to it.`,
      );
      return;
    }
    if (outcome.code === "rate_limited") {
      cooldown.start(cooldownSeconds);
    }
    if (outcome.code === "invalid_email") {
      setFieldError(outcome.message);
    } else {
      setProblem(outcome.message);
    }
  };

  const onEmailSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!EMAIL.test(address)) {
      setFieldError(AUTH_MESSAGES.invalidEmail);
      return;
    }
    setFieldError(undefined);
    setEmail(address);
    void sendCode(address, false);
  };

  const onCodeSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== CODE_LENGTH) {
      setFieldError(`Enter the ${String(CODE_LENGTH)}-digit code from the email.`);
      return;
    }
    setFieldError(undefined);
    setProblem(undefined);
    setBusy(true);
    const outcome = await auth.verifyCode(email, code);
    setBusy(false);
    if (outcome.ok) {
      return;
    }
    if (outcome.code === "invalid_code") {
      setFieldError(outcome.message);
    } else {
      setProblem(outcome.message);
    }
  };

  const problemBox =
    problem === undefined ? null : (
      <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
        {problem}
      </p>
    );

  if (step === "email") {
    return (
      <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-4">
        <Field label={emailLabel} error={fieldError} required>
          <TextInput
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
            }}
            startAddon={<Mail aria-hidden="true" />}
          />
        </Field>
        {problemBox}
        <Button type="submit" disabled={busy || cooldown.secondsLeft > 0}>
          {busy ? "Sending…" : cooldown.secondsLeft > 0 ? `Try again in ${String(cooldown.secondsLeft)} s` : "Send code"}
        </Button>
      </form>
    );
  }

  return (
    <form noValidate onSubmit={(event) => void onCodeSubmit(event)} className="flex flex-col gap-4">
      {notice === undefined ? null : (
        <p role="status" className="text-sm text-muted">
          {notice} It can take a minute to arrive; check spam too.
        </p>
      )}
      <Field label={`${String(CODE_LENGTH)}-digit code`} error={fieldError} required>
        <TextInput
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={CODE_LENGTH}
          value={code}
          onChange={(event) => {
            setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
          }}
          className="tracking-[0.3em]"
        />
      </Field>
      {problemBox}
      <Button type="submit" disabled={busy}>
        {busy ? "Checking…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          icon={<ArrowLeft aria-hidden="true" className="size-4" />}
          onClick={() => {
            setStep("email");
            setCode("");
            setFieldError(undefined);
            setProblem(undefined);
            setNotice(undefined);
          }}
        >
          Use a different email
        </Button>
        <Button
          variant="ghost"
          disabled={busy || cooldown.secondsLeft > 0}
          icon={<RotateCw aria-hidden="true" className="size-4" />}
          onClick={() => {
            setCode("");
            setFieldError(undefined);
            void sendCode(email, true);
          }}
        >
          {cooldown.secondsLeft > 0 ? `Resend code in ${String(cooldown.secondsLeft)} s` : "Resend code"}
        </Button>
      </div>
    </form>
  );
}
