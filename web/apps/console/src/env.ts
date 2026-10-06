export type ApiMode = "fake" | "http";

export interface ConsoleEnv {
  apiMode: ApiMode;
  apiBaseUrl: string;
  supabase: { url: string; anonKey: string } | null;
}

/** Reads and checks the build's `VITE_*` settings once, at start-up. */
export function readEnv(): ConsoleEnv {
  const mode = import.meta.env.VITE_API_MODE ?? "fake";
  if (mode !== "fake" && mode !== "http") {
    throw new Error("VITE_API_MODE must be fake or http.");
  }
  const url = import.meta.env.VITE_SUPABASE_URL ?? "";
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  return {
    apiMode: mode,
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
    supabase: url !== "" && anonKey !== "" ? { url, anonKey } : null,
  };
}

/** The public site's sign-in page when this build sends everyone there (deployed builds), else "" (local development keeps the in-app sign-in). */
export function centralSignInSetting(): string {
  return (import.meta.env.VITE_CENTRAL_SIGNIN_URL ?? "").trim();
}
