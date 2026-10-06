interface ImportMetaEnv {
  /** `fake` (default): in-memory synthetic data. `http`: the real API. */
  readonly VITE_API_MODE?: string;
  /** The console API origin; empty means this page's origin. */
  readonly VITE_API_BASE_URL?: string;
  /** Both set: sign in with an email code through Supabase. Otherwise: development sign-in. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** The public site's sign-in page; when set, signed-out visitors go there with `?next=console`. Unset in local development. */
  readonly VITE_CENTRAL_SIGNIN_URL?: string;
  /** The portal's port in invitation links; 5173 in development, none in production. */
  readonly VITE_PORTAL_PORT?: string;
  /** Portal host pattern with `{slug}`, matching the API; default `{slug}.aarogyam.example`. */
  readonly VITE_PORTAL_HOST_TEMPLATE?: string;
}
