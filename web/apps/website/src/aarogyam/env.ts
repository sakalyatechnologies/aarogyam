// Aarogyam-owned (not part of the Lovable export). Build-time settings, baked in by
// scripts/deploy-website.sh. Empty API base means same origin: the Pages Function in
// deploy/cloudflare/website/functions forwards the three allowed API calls with the edge secret.
const env = import.meta.env;

export const API_BASE_URL: string = (env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
export const CONSOLE_URL: string = env.VITE_CONSOLE_URL ?? "";
export const SUPABASE_URL: string = env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = env.VITE_SUPABASE_ANON_KEY ?? "";
