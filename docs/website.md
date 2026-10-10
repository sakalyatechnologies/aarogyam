# Clinic websites

Status: built on `feat/clinic-website` (4 Oct 2026). Hosting is not wired yet.

## What a clinic gets

Settings, Website: pick one page or several (Home, About, Services, Gallery, Contact), a design, a palette and a font pairing; edit text by clicking it in a live desktop or phone preview; add pictures; publish. Online booking is in every design (the `/book` flow loads in the page when the visitor asks). Content fills from clinic data: name, doctors (with qualifications the owner adds), services and fees from the price list (medicines and products left out), opening hours merged from doctors' shifts, address, phone. Reviews are typed in by the clinic.

Designs: `aurora` (premium dark), `hearth` (warm family), `clinical` (minimal), `bold` (modern), `heritage` (classical serif), `smilebright` (playful, kids and family) and three bento designs of tiles, `bentopeach`, `bentopistachio` and `bentomidnight` (dark). Three or four palettes each, six font pairings (`classic` and `display` join the original four). The design id is stored as plain text (the column check is a pattern, not a list), so a new design needs no migration: add it to the domain catalogue, the site-kit catalogue and the api-client fake. All palette pairs are tested for WCAG AA contrast.

## Pieces

| Piece | Where |
|---|---|
| Tables `clinic_websites`, `website_photos` (migrations 0110, 0111) | `db/migrations` |
| Rules: designs, content limits, domain, picture types | `aarogyam-domain/src/website.rs` |
| Use cases and the public payload | `aarogyam-app/src/website.rs` |
| Owner API (`settings.manage`): `GET/PATCH /settings/website`, `/settings/website/photos[/{id}]` | `aarogyam-api/src/v1/website.rs` |
| Public API on the clinic host: `GET /public/site` (404 until published), `GET /public/site/photos/{id}` | same |
| Renderer, designs, SEO (title, meta, JSON-LD `Dentist`) | `web/packages/site-kit` |
| Live site app | `web/apps/site` (`pnpm dev:site`, sample clinic with `?template=bold&palette=coral&layout=multi`) |
| Editor | `web/apps/portal/src/pages/settings/website` |

The public payload holds only public facts: no patient data, registration numbers, domain token or published flag. A test checks the exact keys and that private values never appear.

## Serving it

Publishing queues the clinic's free site address (`<slug>-site.<domain>`, `org_domains` kind `site`); the outbox job makes it work, and taking the site down removes it. The `aarogyam-site` Worker (`deploy/cloudflare/site`) serves `web/apps/site` and proxies only `GET /api/v1/public/site` and its pictures to the API with the clinic's host, so the API resolves the clinic as it does for the portal. `VITE_BOOKING_URL_TEMPLATE` (the portal's `/book`, set by `scripts/deploy-workers.sh`) points the booking frame at the clinic's portal host. Settings shows the real address and its status (`domain.default_address`, `address_status`: none, pending, ready, failed). Steps and limits: `docs/deploy.md`, "Clinic websites". Custom domains: the owner adds a CNAME `www` to `website.sites_target` and a TXT `_aarogyam-verify` with the token; verification and `cloudflare_hostname_id` come with Cloudflare for SaaS. Config: `ARO_WEBSITE__SITES_TARGET`, `ARO_WEBSITE__ADDRESS_TEMPLATE`.

## Not done

Custom-domain verification and hosting (free addresses are live); sitemap and per-page server-side rendering for crawlers (the page sets its tags in the browser); AI copy.
