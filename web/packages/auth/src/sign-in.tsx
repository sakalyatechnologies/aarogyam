import { ArrowLeft, CheckCircle2, Mail, RotateCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import { Avatar, Button, Field, TextInput, useFieldControl } from "@sakalya/ui";

import { AuthSteps } from "./auth-shell.js";
import { AUTH_MESSAGES, type AuthClient, type DevAuthClient, type EmailCodeAuthClient } from "./auth-client.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

export interface SignInPanelProps {
  auth: AuthClient;
  /** What the email field is called; "Work email" for staff, "Your email" for patients. */
  emailLabel?: string;
  /** Shows the "Your email, Your code" progress bar. Defaults to true; turn it off inside a flow with its own steps. */
  showSteps?: boolean;
}

/** The sign-in form for whichever `AuthClient` the app started with. */
export function SignInPanel({ auth, emailLabel, showSteps }: SignInPanelProps) {
  return auth.kind === "dev" ? (
    <DevSignIn auth={auth} />
  ) : (
    <EmailCodeSignIn auth={auth} {...(emailLabel === undefined ? {} : { emailLabel })} {...(showSteps === undefined ? {} : { showSteps })} />
  );
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

export interface CodeInputProps {
  value: string;
  onValueChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
}

/** Keeps only digits, at most `length` of them: what paste, autofill and typing all go through. */
export function digitsOnly(text: string, length: number): string {
  return text.replace(/\D/g, "").slice(0, length);
}

/**
 * Six boxes driven by one real input, so typing, pasting, backspace and the phone's "code from
 * SMS or email" suggestion all work as in any text field, and screen readers meet one labelled
 * field. The boxes are decoration; the active one follows the caret.
 */
export function CodeInput({ value, onValueChange, length = CODE_LENGTH, disabled }: CodeInputProps) {
  const control = useFieldControl({ disabled });
  const [focused, setFocused] = useState(false);
  const invalid = control.invalid;
  return (
    <div className="relative">
      <div aria-hidden="true" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${String(length)}, minmax(0, 1fr))` }}>
        {Array.from({ length }, (_, index) => {
          const active = focused && index === Math.min(value.length, length - 1);
          return (
            <span
              key={index}
              data-filled={index < value.length ? "" : undefined}
              className={`flex h-14 items-center justify-center rounded-xl border bg-surface text-2xl font-extrabold text-text transition-colors ${
                invalid ? "border-danger" : active ? "border-primary ring-2 ring-primary/40" : "border-border-strong"
              } ${disabled === true ? "opacity-60" : ""}`}
            >
              {value[index] ?? (active ? <span className="h-6 w-px animate-pulse bg-primary" /> : null)}
            </span>
          );
        })}
      </div>
      <input
        {...control.props}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        autoFocus
        maxLength={length * 2}
        value={value}
        onChange={(event) => {
          onValueChange(digitsOnly(event.currentTarget.value, length));
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        className="absolute inset-0 size-full cursor-text opacity-0"
      />
    </div>
  );
}

const SIGN_IN_STEPS = ["Your email", "Your code"] as const;

export interface EmailCodeSignInProps {
  auth: EmailCodeAuthClient;
  /** Seconds before another code may be requested. */
  cooldownSeconds?: number;
  /** What the email field is called. Defaults to "Work email". */
  emailLabel?: string;
  /** Shows the progress bar above the form. Defaults to true. */
  showSteps?: boolean;
}

/**
 * Email, then a six-digit code. Whatever happens, the form never reveals whether an email is
 * registered: an unknown address gets the same "if this email is registered" answer. The code
 * is submitted as soon as the sixth digit arrives, by typing or pasting.
 */
export function EmailCodeSignIn({ auth, cooldownSeconds = 60, emailLabel = "Work email", showSteps = true }: EmailCodeSignInProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const cooldown = useCooldown();

  const sendCode = async (address: string, again: boolean) => {
    setBusy(true);
    setProblem(undefined);
    const outcome = await auth.requestCode(address);
    setBusy(false);
    if (outcome.ok) {
      cooldown.start(cooldownSeconds);
      setSentTo(address);
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
      setSentTo(address);
    }
    if (outcome.code === "invalid_email") {
      setFieldError(outcome.message);
    } else {
      setProblem(outcome.message);
    }
  };

  const checkEmail = (text: string): string | undefined => (EMAIL.test(text.trim()) ? undefined : AUTH_MESSAGES.invalidEmail);

  const onEmailSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    const invalid = checkEmail(address);
    if (invalid !== undefined) {
      setFieldError(invalid);
      return;
    }
    setFieldError(undefined);
    setEmail(address);
    void sendCode(address, false);
  };

  const verify = async (digits: string) => {
    if (busy) {
      return;
    }
    if (digits.length !== CODE_LENGTH) {
      setFieldError(`Enter the ${String(CODE_LENGTH)}-digit code from the email.`);
      return;
    }
    setFieldError(undefined);
    setProblem(undefined);
    setBusy(true);
    const outcome = await auth.verifyCode(email, digits);
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

  const onCodeChange = (digits: string) => {
    setCode(digits);
    setFieldError(undefined);
    if (digits.length === CODE_LENGTH && digits !== code) {
      void verify(digits);
    }
  };

  const problemBox =
    problem === undefined ? null : (
      <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
        {problem}
      </p>
    );

  if (step === "email") {
    const valid = email.trim() !== "" && checkEmail(email) === undefined;
    // The wait is per address: someone who mistyped can correct it and send at once.
    const waiting = cooldown.secondsLeft > 0 && email.trim() === sentTo;
    return (
      <div>
        {showSteps ? <AuthSteps steps={SIGN_IN_STEPS} current={0} label="Sign-in steps" /> : null}
        <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-4">
          <Field label={emailLabel} error={fieldError} hint="We'll email you a six-digit code. No password needed." required>
            <TextInput
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              value={email}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
                if (fieldError !== undefined) {
                  setFieldError(checkEmail(event.currentTarget.value));
                }
              }}
              onBlur={() => {
                if (email.trim() !== "") {
                  setFieldError(checkEmail(email));
                }
              }}
              startAddon={<Mail aria-hidden="true" />}
              endAddon={valid ? <CheckCircle2 aria-hidden="true" className="text-success" /> : undefined}
            />
          </Field>
          {problemBox}
          <Button type="submit" disabled={busy || waiting}>
            {busy ? "Sending…" : waiting ? `Try again in ${String(cooldown.secondsLeft)} s` : "Send code"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      {showSteps ? <AuthSteps steps={SIGN_IN_STEPS} current={1} label="Sign-in steps" /> : null}
      <form noValidate onSubmit={(event) => { event.preventDefault(); void verify(code); }} className="flex flex-col gap-4">
        {notice === undefined ? null : (
          <p role="status" className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-muted">
            {notice} It can take a minute to arrive; check spam too.
          </p>
        )}
        <Field label={`${String(CODE_LENGTH)}-digit code`} error={fieldError} required>
          <CodeInput value={code} onValueChange={onCodeChange} disabled={busy} />
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
    </div>
  );
}
