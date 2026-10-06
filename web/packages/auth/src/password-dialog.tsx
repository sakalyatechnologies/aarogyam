import { useId, useState, type SubmitEvent } from "react";

import { Button, Dialog, Field, Meter, TextInput } from "@sakalya/ui";

import { type AuthClient, type EmailCodeAuthClient } from "./auth-client.js";
import { clearPasswordReset, hasPasswordReset, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordStrength } from "./password.js";

/** Development sign-in has no passwords; only the email-code client can set one. */
export function supportsPassword(auth: AuthClient): auth is EmailCodeAuthClient {
  return auth.kind === "email_code";
}

/**
 * State for the account menu's "Password" dialog. It opens by itself once after "Forgot
 * password?" sign-in, then forgets why.
 */
export function usePasswordDialog() {
  const [open, setOpenState] = useState(hasPasswordReset);
  const setOpen = (next: boolean) => {
    if (!next) {
      clearPasswordReset();
    }
    setOpenState(next);
  };
  return { open, setOpen };
}

export interface PasswordDialogProps {
  auth: EmailCodeAuthClient;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Set or change your password (Supabase `updateUser`), with a strength hint. */
export function PasswordDialog({ auth, open, onOpenChange }: PasswordDialogProps) {
  const formId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const strength = passwordStrength(password);

  const close = (next: boolean) => {
    if (!next) {
      setPassword("");
      setConfirm("");
      setError(undefined);
      setProblem(undefined);
      setSaved(false);
    }
    onOpenChange(next);
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setProblem(undefined);
    if (!strength.acceptable) {
      setError(`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setError(undefined);
    setBusy(true);
    const outcome = await auth.setPassword(password);
    setBusy(false);
    if (outcome.ok) {
      setPassword("");
      setConfirm("");
      setSaved(true);
      clearPasswordReset();
    } else if (outcome.code === "weak_password") {
      setError(outcome.message);
    } else {
      setProblem(outcome.message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Password"
      description="Optional. You can always sign in with an email code instead."
      size="sm"
      dismissOnOutsidePress={false}
      footer={
        saved ? (
          <Button
            onClick={() => {
              close(false);
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                close(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <p role="status" className="text-sm text-text">
          Password saved. You can now sign in with your email and password.
        </p>
      ) : (
        <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Field label="New password" error={error} hint={`At least ${String(MIN_PASSWORD_LENGTH)} characters. A few unrelated words work well.`} required>
            <TextInput
              type="password"
              name="new-password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              autoFocus
              value={password}
              onChange={(event) => {
                setPassword(event.currentTarget.value);
                setError(undefined);
              }}
            />
          </Field>
          {password === "" ? null : <Meter label="Password strength" value={strength.score} max={4} lowAt={1} valueLabel={strength.label} />}
          <Field label="Confirm new password" required>
            <TextInput
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.currentTarget.value);
                setError(undefined);
              }}
            />
          </Field>
          {problem === undefined ? null : (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-text">
              {problem}
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}
