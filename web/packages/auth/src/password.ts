/** Password rules and the small helpers around them. No password is ever stored or logged here. */

export const MIN_PASSWORD_LENGTH = 12;
/** Supabase hashes with bcrypt, which ignores everything past 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordStrength = { score: 0 | 1 | 2 | 3 | 4; label: string; acceptable: boolean };

/** A rough, local strength hint: length first, then variety; repeats and runs count against it. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { score: 0, label: `Too short: use at least ${String(MIN_PASSWORD_LENGTH)} characters`, acceptable: false };
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const distinct = new Set(password.toLowerCase()).size;
  let points = 0;
  points += password.length >= 16 ? 2 : 1;
  points += classes >= 3 ? 1 : 0;
  points += distinct >= 8 ? 1 : 0;
  if (/(.)\1{3,}/.test(password) || /^(?:0123|1234|abcd|qwer|pass)/i.test(password) || distinct < 5) {
    points = Math.min(points, 1);
  }
  if (points <= 1) {
    return { score: 1, label: "Weak: add more words or characters", acceptable: true };
  }
  if (points === 2) {
    return { score: 2, label: "Okay", acceptable: true };
  }
  return points === 3 ? { score: 3, label: "Good", acceptable: true } : { score: 4, label: "Strong", acceptable: true };
}

const RESET_KEY = "aarogyam.auth.set-password";

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** "Forgot password?" sends the email code and leaves this note so the app offers a new password after sign-in. */
export function markPasswordReset(): void {
  try {
    storage()?.setItem(RESET_KEY, "1");
  } catch {
    // Without storage the person can still set a password from the account menu.
  }
}

export function clearPasswordReset(): void {
  try {
    storage()?.removeItem(RESET_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function hasPasswordReset(): boolean {
  try {
    return storage()?.getItem(RESET_KEY) === "1";
  } catch {
    return false;
  }
}
