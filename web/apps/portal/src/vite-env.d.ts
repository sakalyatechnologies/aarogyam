interface ImportMetaEnv {
  /** `fake` (default): in-memory synthetic data. `http`: the real API. */
  readonly VITE_API_MODE?: string;
  /** The neutral API origin (sign-in, /me); empty means this page's origin. */
  readonly VITE_API_BASE_URL?: string;
  /** Both set: sign in with an email code through Supabase. Otherwise: development sign-in. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
