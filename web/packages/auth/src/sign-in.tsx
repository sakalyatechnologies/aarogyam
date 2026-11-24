import { ArrowLeft, CheckCircle2, KeyRound, Mail, RotateCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from "react";

import { Avatar, Button, Field, TextInput, useFieldControl } from "@sakalya/ui";

import { AuthSteps } from "./auth-shell.js";
import { clearPasswordReset, markPasswordReset, MAX_PASSWORD_LENGTH } from "./password.js";
import { AUTH_MESSAGES, type AuthClient, type DevAuthClient, type EmailCodeAuthClient, type OAuthProvider } from "./auth-client.js";

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

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.45a5.51 5.51 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.8Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
      <path d="M16.37 12.63c-.03-2.83 2.31-4.19 2.41-4.26-1.31-1.92-3.35-2.18-4.08-2.21-1.74-.18-3.39 1.02-4.27 1.02-.88 0-2.24-1-3.68-.97-1.89.03-3.64 1.1-4.61 2.8-1.97 3.41-.5 8.46 1.41 11.23.94 1.35 2.05 2.88 3.51 2.82 1.41-.06 1.94-.91 3.65-.91 1.7 0 2.18.91 3.67.88 1.52-.03 2.48-1.38 3.41-2.74 1.07-1.57 1.51-3.09 1.54-3.17-.03-.01-2.95-1.13-2.98-4.49ZM13.57 4.3c.78-.94 1.3-2.25 1.16-3.55-1.12.05-2.47.75-3.27 1.69-.72.83-1.35 2.16-1.18 3.44 1.25.1 2.52-.64 3.29-1.58Z" />
    </svg>
  );
}

const SIGN_IN_STEPS = ["Your email", "Your code"] as const;
const PASSWORD_STEPS = ["Your email", "Your password"] as const;

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
 * Email, then a six-digit code (or, by choice, a password). Whatever happens, the form never reveals whether an email is
 * registered: an unknown address gets the same "if this email is registered" answer. The code
 * is submitted as soon as the sixth digit arrives, by typing or pasting.
 */
export function EmailCodeSignIn({ auth, cooldownSeconds = 60, emailLabel = "Work email", showSteps = true }: EmailCodeSignInProps) {
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [password, setPassword] = useState("");
  const cooldown = useCooldown();
  const [socialProviders, setSocialProviders] = useState<readonly OAuthProvider[]>([]);
  const { oauthProviders, signInWithOAuth } = auth;

  // Hidden until the auth service says a provider is on, so switching one on needs no redeploy.
  useEffect(() => {
    if (oauthProviders === undefined || signInWithOAuth === undefined) {
      return;
    }
    let live = true;
    void oauthProviders().then(
      (found) => {
        if (live) {
          setSocialProviders(found);
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [oauthProviders, signInWithOAuth]);

  const continueWith = async (provider: OAuthProvider) => {
    if (busy || signInWithOAuth === undefined) {
      return;
    }
    setProblem(undefined);
    setBusy(true);
    const outcome = await signInWithOAuth(provider);
    // On success the browser is already leaving for the provider; keep the buttons disabled until it does.
    if (!outcome.ok) {
      setBusy(false);
      setProblem(outcome.message);
    }
  };

  const sendCode = async (address: string, again: boolean, forgot = false) => {
    setBusy(true);
    setProblem(undefined);
    const outcome = await auth.requestCode(address);
    setBusy(false);
    if (forgot && outcome.ok) {
      // After this code signs them in, the app offers a new password.
      markPasswordReset();
    }
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

  const usePasswordInstead = () => {
    const address = email.trim();
    const invalid = checkEmail(address);
    if (invalid !== undefined) {
      setFieldError(invalid);
      return;
    }
    setFieldError(undefined);
    setProblem(undefined);
    setEmail(address);
    setStep("password");
  };

  const signInWithPassword = async () => {
    if (busy) {
      return;
    }
    if (password === "") {
      setFieldError("Enter your password.");
      return;
    }
    setFieldError(undefined);
    setProblem(undefined);
    setBusy(true);
    const outcome = await auth.signInWithPassword(email, password);
    setBusy(false);
    if (outcome.ok) {
      setPassword("");
      return;
    }
    // Wrong password and unknown email read the same: one message, shown the same way.
    setProblem(outcome.message);
  };

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
        {socialProviders.length === 0 ? null : (
          <div className="mb-4 flex flex-col gap-3">
            {socialProviders.map((provider) => (
              <Button
                key={provider}
                variant="secondary"
                disabled={busy}
                icon={provider === "google" ? <GoogleLogo /> : <AppleLogo />}
                onClick={() => {
                  void continueWith(provider);
                }}
              >
                {provider === "google" ? "Continue with Google" : "Continue with Apple"}
              </Button>
            ))}
            <div role="separator" className="flex items-center gap-3 text-xs font-medium text-muted">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}
        <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-4">
          <Field label={emailLabel} error={fieldError} hint="We'll email you a six-digit code, or you can use a password if you've set one." required>
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
            {busy ? "Sending…" : waiting ? `Try again in ${String(cooldown.secondsLeft)} s` : "Email me a code"}
          </Button>
          <Button variant="secondary" disabled={busy} icon={<KeyRound aria-hidden="true" className="size-4" />} onClick={usePasswordInstead}>
            Use a password
          </Button>
        </form>
      </div>
    );
  }

  if (step === "password") {
    const backToEmail = () => {
      setStep("email");
      setPassword("");
      setFieldError(undefined);
      setProblem(undefined);
    };
    return (
      <div>
        {showSteps ? <AuthSteps steps={PASSWORD_STEPS} current={1} label="Sign-in steps" /> : null}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void signInWithPassword();
          }}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted">
            Signing in as <b className="text-text">{email}</b>
          </p>
          <Field label="Password" error={fieldError} required>
            <TextInput
              type="password"
              name="password"
              autoComplete="current-password"
              maxLength={MAX_PASSWORD_LENGTH}
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
                setFieldError(undefined);
              }}
            />
          </Field>
          {problemBox}
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" icon={<ArrowLeft aria-hidden="true" className="size-4" />} onClick={backToEmail}>
              Use a different email
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPassword("");
                setFieldError(undefined);
                void sendCode(email, false, true);
              }}
            >
              Forgot password?
            </Button>
          </div>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setPassword("");
              setProblem(undefined);
              clearPasswordReset();
              void sendCode(email, false);
            }}
          >
            Email me a code instead
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
              clearPasswordReset();
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
