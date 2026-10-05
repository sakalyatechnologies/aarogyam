/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `fake` shows a sample clinic without an API; `http` (default in production) reads /api/v1/public/site. */
  readonly VITE_API_MODE?: string;
  /** The API's origin; empty means this page's own origin. */
  readonly VITE_API_BASE_URL?: string;
  /** Where the booking page lives, with `{slug}` for the clinic: `https://{slug}.example.com/book`. */
  readonly VITE_BOOKING_URL_TEMPLATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
