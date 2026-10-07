# Re-importing a Lovable export

The site's look comes from Lovable; everything that makes it work in this repo is ours and lives
in separate files, so a new export can be dropped in.

    scripts/import-website.sh ~/Downloads/new-export.zip
    pnpm --filter @aarogyam/website build     # regenerates src/routeTree.gen.ts
    pnpm --filter @aarogyam/website typecheck && pnpm vitest run --project @aarogyam/website
    scripts/deploy-website.sh

## What the script does

1. Replaces `src/` and `public/` from the export (rsync with delete), after removing what we never
   keep: `src/components/ui` and `src/hooks` (unused shadcn), `src/server.ts`, `src/start.ts` and
   `src/lib/{lovable-error-reporting,error-capture,error-page}.ts` (Lovable's SSR/telemetry),
   `src/routes/{login,track}.tsx` plus `LoginView`/`StatusView` (mock sign-in and tracker), and
   renames `src/netlify` to `src/landing`.
2. Keeps ours: `src/aarogyam/` (API client, sign-in page, routing, tests), `src/routes/sign-in.tsx`,
   `src/vite-env.d.ts`, `src/routeTree.gen.ts` (generated).
   Also ours: `src/aarogyam/{Showcase,Landing}.tsx`, `v4.css` (sign-in showcase, landing hero, request-access polish) and `src/aarogyam/product/` (portal screenshots, synthetic data).
3. Re-applies `lovable-edits.patch`: the only edits inside Lovable's files.

Never replaced by an import (ours): `package.json`, `vite.config.ts`, `tsconfig.json`,
`vitest.config.ts`. Compare the export's `package.json` dependencies by hand: if the new site
imports a package we lack, add it (use the repo's versions).

## Lovable files we edit (the patch)

| File | Edit |
|---|---|
| `src/routes/__root.tsx` | drop `reportLovableError` and the `console.error` in the error component |
| `src/routes/index.tsx` | renders our `src/aarogyam/Landing.tsx` (product hero and tour, then the Lovable sections) instead of `SiteView`; "Sign in" goes to `/sign-in` |
| `src/routes/register.tsx` | back and "sign in" go to `/` and `/sign-in`; no `onTrack` |
| `src/landing/Shell.jsx` | nav "Sign in" goes to `/sign-in` |
| `src/landing/views/RegisterView.jsx` | submit calls `submitRegistration` (real API), shows its error inline, drops the fake reference ID and tracker links |

If a hunk fails, the script stops and leaves `.rej` files: port the edit by hand, then refresh the
patch from the export the current edits were made against:
`scripts/import-website.sh --make-patch <that export.zip>` (or, once you have ported by hand
against the new export, use the new zip).

## Not in the site

Anything that phones home (Lovable analytics, tagger, badge). Google Fonts load from Google, and
`public/demos/mobile.html` fetches a QR image from api.qrserver.com; both are in Lovable's design.
Lint: the website has its own scope in `eslint.config.js` (recommended rules, not the apps' strict
set); the Lovable pages use plain JSX, default exports and effects the strict rules reject.
