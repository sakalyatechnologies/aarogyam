//! Making clinics' portal and site addresses work at the edge, run by the outbox job before it
//! sends email (so an owner's invitation link works by the time it arrives).
//!
//! A clinic's website gets a second host, kind `site`, when it is published
//! (`db/migrations/0240_site_addresses.sql`); taking the site down marks it `removing`, and the
//! same job deletes its Worker and forgets the host. Site hosts are served by the `aarogyam-site`
//! Worker (public content only) exactly as portal hosts are served by `aarogyam-portal`.
//!
//! A new clinic's portal host is queued in the database as `pending` (whatever created it,
//! see `db/migrations/0160_portal_addresses.sql`). [`PortalAddresses::provision`] claims due
//! hosts across clinics, makes each work, and records `ready`, a retry with the outbox's
//! backoff, or `failed`. The console only reads the status, so swapping how hosts are made to
//! work changes nothing there:
//!
//! - [`PortalAddresses::WorkersDev`]: workers.dev has no wildcard subdomains, so each clinic
//!   gets a tiny Worker named after its slug that hands every request to the portal Worker
//!   through a service binding. The portal Worker then proxies `/api` with this clinic's host,
//!   exactly as for its own host (`deploy/cloudflare/shared/api-proxy.ts`), so the clinic Worker
//!   holds no secret and a portal release reaches every clinic at once.
//! - [`PortalAddresses::Wildcard`]: a wildcard route already serves every host (local
//!   `*.localtest.me`, or a wildcard custom domain later), so hosts are marked ready at once.
//! - [`PortalAddresses::Off`]: nothing is claimed; hosts stay pending.

use aarogyam_dal::edge::{self, ClaimedHost};
use aarogyam_domain::event::Event;
use aarogyam_domain::outbox::retry_at;
use sakalya_db::{Db, DbError};
use sakalya_types::Slug;
use time::OffsetDateTime;

use crate::cloudflare::{ServiceBinding, WorkerName, WorkersApi};
use crate::{Failure, NotifyError};

/// Most hosts one run provisions.
const BATCH: i32 = 20;
/// How long a claimed host is held before another run may retry it, in seconds.
const LEASE_SECONDS: i32 = 300;
/// The binding name a portal host's Worker calls the portal Worker by.
const PORTAL_BINDING: &str = "PORTAL";
/// The binding name a site host's Worker calls the site Worker by.
const SITE_BINDING: &str = "SITE";
/// The runtime version the clinic Worker targets; matches `deploy/cloudflare/portal/wrangler.toml`.
const COMPATIBILITY_DATE: &str = "2026-09-01";
/// A clinic's forwarding Worker: everything goes to the app Worker bound as `binding`, which
/// sees this clinic's host in the request URL and forwards it to the API with the edge secret.
fn forwarder(binding: &str) -> String {
    format!(
        "// A clinic's address, created by the Aarogyam outbox job \
(crates/aarogyam-notify/src/addresses.rs). Do not edit: it is replaced on the next run.\n\
export default {{ fetch(request, env) {{ return env.{binding}.fetch(request); }} }};\n"
    )
}
/// Workers that must never be replaced by a clinic's, whatever its slug.
const PROTECTED_WORKERS: [&str; 4] = [
    "aarogyam-portal",
    "aarogyam-console",
    "aarogyam-site",
    "aarogyam-website",
];

/// Which kind of host a Worker serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Portal,
    Site,
}

impl Kind {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "portal" => Some(Self::Portal),
            "site" => Some(Self::Site),
            _ => None,
        }
    }
}

/// What one run did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AddressReport {
    /// Hosts claimed (set up or removed).
    pub claimed: usize,
    /// Now served, or removed.
    pub ready: usize,
    /// Failed, to be tried again.
    pub retrying: usize,
    /// Failed for the last time.
    pub failed: usize,
}

/// How portal and site hosts are made to work.
#[derive(Debug)]
pub enum PortalAddresses {
    /// Not configured: hosts stay pending.
    Off,
    /// Every host is already served by a wildcard; hosts are marked ready.
    Wildcard,
    /// One Worker per clinic on workers.dev, through the Cloudflare API.
    WorkersDev(WorkersDev),
}

impl PortalAddresses {
    /// `off`, `wildcard` or `workers_dev`, for logs.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Wildcard => "wildcard",
            Self::WorkersDev(_) => "workers_dev",
        }
    }

    /// Claims due portal and site hosts, makes each work (or removes it), and records each outcome.
    ///
    /// # Errors
    /// [`DbError`] when the database fails; hosts already settled stay settled, and a claimed
    /// one whose outcome wasn't recorded is retried after its lease.
    pub async fn provision(&self, db: &Db, now: OffsetDateTime) -> Result<AddressReport, DbError> {
        if matches!(self, Self::Off) {
            return Ok(AddressReport::default());
        }
        let pool = db.pool();
        let claimed = edge::claim(pool, BATCH, LEASE_SECONDS).await?;
        let mut report = AddressReport {
            claimed: claimed.len(),
            ..AddressReport::default()
        };
        for host in &claimed {
            let outcome = match self {
                Self::Off | Self::Wildcard => Ok(()),
                Self::WorkersDev(workers) if host.removing => workers.remove(host).await,
                Self::WorkersDev(workers) => workers.provision(host).await,
            };
            match outcome {
                Ok(()) if host.removing => {
                    edge::mark_removed(pool, host.domain_id).await?;
                    report.ready += 1;
                    tracing::info!(
                        event = Event::AddressRemoved.as_str(),
                        org_id = %host.org_id,
                        domain_id = %host.domain_id,
                        provider = self.name(),
                        "site address removed"
                    );
                }
                Ok(()) => {
                    edge::mark_ready(pool, host.domain_id).await?;
                    report.ready += 1;
                    tracing::info!(
                        event = Event::AddressProvisioned.as_str(),
                        org_id = %host.org_id,
                        domain_id = %host.domain_id,
                        provider = self.name(),
                        "address ready"
                    );
                }
                Err(failure) => {
                    let attempts = u32::try_from(host.attempts).unwrap_or(u32::MAX);
                    let retry = if failure.retryable {
                        retry_at(attempts, now)
                    } else {
                        None
                    };
                    edge::mark_failed(pool, host.domain_id, &failure.reason, retry).await?;
                    if retry.is_some() {
                        report.retrying += 1;
                        tracing::warn!(
                            event = Event::AddressRetried.as_str(),
                            org_id = %host.org_id,
                            domain_id = %host.domain_id,
                            attempts,
                            reason = %failure.reason,
                            "address failed; will retry"
                        );
                    } else {
                        report.failed += 1;
                        tracing::error!(
                            event = Event::AddressFailed.as_str(),
                            org_id = %host.org_id,
                            domain_id = %host.domain_id,
                            attempts,
                            reason = %failure.reason,
                            "address failed"
                        );
                    }
                }
            }
        }
        Ok(report)
    }
}

/// One Worker per clinic on the account's workers.dev subdomain.
#[derive(Debug)]
pub struct WorkersDev {
    api: WorkersApi,
    subdomain: String,
    portal: Box<Target>,
    site: Option<Box<Target>>,
}

/// Where one kind of host's Workers come from and what they forward to.
#[derive(Debug)]
struct Target {
    name_template: String,
    /// The app Worker every clinic Worker of this kind hands requests to.
    app: WorkerName,
    binding: &'static str,
}

impl WorkersDev {
    /// Clinic Workers named `name_template` with `{slug}` replaced (such as `{slug}-aarogyam`),
    /// served at `<name>.<subdomain>.workers.dev`, each handing requests to `portal_worker`.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] for a template without exactly one `{slug}`, a
    /// subdomain that isn't a DNS label, or an invalid portal Worker name.
    pub fn new(
        api: WorkersApi,
        subdomain: &str,
        name_template: &str,
        portal_worker: &str,
    ) -> Result<Self, NotifyError> {
        if name_template.matches("{slug}").count() != 1 {
            return Err(NotifyError::Configuration(
                "the clinic Worker name template needs exactly one {slug}",
            ));
        }
        let subdomain = subdomain.trim().trim_end_matches(".workers.dev");
        WorkerName::parse(subdomain).map_err(|_| {
            NotifyError::Configuration("the workers.dev subdomain must be one DNS label")
        })?;
        let portal = WorkerName::parse(portal_worker.trim())
            .map_err(|_| NotifyError::Configuration("the portal Worker name is invalid"))?;
        Ok(Self {
            api,
            subdomain: subdomain.to_owned(),
            portal: Box::new(Target {
                name_template: name_template.to_owned(),
                app: portal,
                binding: PORTAL_BINDING,
            }),
            site: None,
        })
    }

    /// Also serves clinics' website hosts: Workers named `name_template` with `{slug}`
    /// replaced (such as `{slug}-site`), each handing requests to `site_worker`.
    ///
    /// # Errors
    /// [`NotifyError::Configuration`] for a template without exactly one `{slug}` or an
    /// invalid site Worker name.
    pub fn with_site(
        mut self,
        name_template: &str,
        site_worker: &str,
    ) -> Result<Self, NotifyError> {
        if name_template.matches("{slug}").count() != 1 {
            return Err(NotifyError::Configuration(
                "the site Worker name template needs exactly one {slug}",
            ));
        }
        let app = WorkerName::parse(site_worker.trim())
            .map_err(|_| NotifyError::Configuration("the site Worker name is invalid"))?;
        self.site = Some(Box::new(Target {
            name_template: name_template.to_owned(),
            app,
            binding: SITE_BINDING,
        }));
        Ok(self)
    }

    /// The clinic's Worker name, from its slug. Checked against the stored host, so a host
    /// from another template or domain is never given a Worker it wouldn't be served by.
    fn worker_for(&self, kind: Kind, slug: &Slug, hostname: &str) -> Result<WorkerName, Failure> {
        let target = self.target(kind)?;
        let name = WorkerName::parse(&target.name_template.replace("{slug}", slug.as_str()))
            .map_err(Failure::permanent)?;
        if name == target.app || PROTECTED_WORKERS.contains(&name.as_str()) {
            return Err(Failure::permanent("the slug names a platform Worker"));
        }
        let expected = format!("{}.{}.workers.dev", name.as_str(), self.subdomain);
        if hostname != expected {
            return Err(Failure::permanent(
                "the host is not this clinic's workers.dev address",
            ));
        }
        Ok(name)
    }

    fn target(&self, kind: Kind) -> Result<&Target, Failure> {
        match kind {
            Kind::Portal => Ok(&*self.portal),
            Kind::Site => self
                .site
                .as_deref()
                .ok_or_else(|| Failure::permanent("site addresses are not configured")),
        }
    }

    /// Uploads the clinic's Worker and turns on its workers.dev address. Both calls are
    /// idempotent, so running this again for a ready host changes nothing.
    async fn provision(&self, host: &ClaimedHost) -> Result<(), Failure> {
        let kind =
            Kind::parse(&host.kind).ok_or_else(|| Failure::permanent("unknown host kind"))?;
        let slug = Slug::parse(&host.slug).map_err(|_| Failure::permanent("invalid slug"))?;
        let name = self.worker_for(kind, &slug, &host.hostname)?;
        let target = self.target(kind)?;
        self.api
            .put_module(
                &name,
                &forwarder(target.binding),
                COMPATIBILITY_DATE,
                ServiceBinding {
                    name: target.binding,
                    service: &target.app,
                },
            )
            .await?;
        self.api.enable_workers_dev(&name).await
    }

    /// Deletes a taken-down site's Worker. Only site hosts are ever removed, and the name is
    /// checked against the stored host like a set-up, so no other Worker can be deleted.
    async fn remove(&self, host: &ClaimedHost) -> Result<(), Failure> {
        if Kind::parse(&host.kind) != Some(Kind::Site) {
            return Err(Failure::permanent("only site addresses are removed"));
        }
        let slug = Slug::parse(&host.slug).map_err(|_| Failure::permanent("invalid slug"))?;
        let name = self.worker_for(Kind::Site, &slug, &host.hostname)?;
        self.api.delete_script(&name).await
    }
}

#[cfg(test)]
mod tests {
    use secrecy::SecretString;

    use super::*;
    use crate::cloudflare::{API_BASE, AccountId};

    fn workers(template: &str) -> Result<WorkersDev, NotifyError> {
        let api = WorkersApi::new(
            API_BASE,
            AccountId::parse("0123456789abcdef0123456789abcdef").unwrap(),
            SecretString::from("test-token"),
        )
        .unwrap();
        WorkersDev::new(api, "spring-snow-130f", template, "aarogyam-portal")
    }

    #[test]
    fn the_worker_name_comes_from_the_slug_and_must_match_the_host() {
        let workers = workers("{slug}-aarogyam").unwrap();
        let slug = Slug::parse("sunrise").unwrap();
        let name = workers
            .worker_for(
                Kind::Portal,
                &slug,
                "sunrise-aarogyam.spring-snow-130f.workers.dev",
            )
            .unwrap();
        assert_eq!(name.as_str(), "sunrise-aarogyam");
        // Another clinic's host, another account's subdomain, or another domain: refused.
        for host in [
            "lotus-aarogyam.spring-snow-130f.workers.dev",
            "sunrise-aarogyam.other.workers.dev",
            "sunrise-aarogyam.sakalyatechnologies.com",
        ] {
            assert!(
                !workers
                    .worker_for(Kind::Portal, &slug, host)
                    .unwrap_err()
                    .retryable
            );
        }
    }

    #[test]
    fn a_slug_never_replaces_a_platform_worker() {
        let workers = workers("aarogyam-{slug}").unwrap();
        let slug = Slug::parse("portal").unwrap();
        let refused = workers
            .worker_for(
                Kind::Portal,
                &slug,
                "aarogyam-portal.spring-snow-130f.workers.dev",
            )
            .unwrap_err();
        assert_eq!(refused.reason, "the slug names a platform Worker");
    }

    #[test]
    fn a_name_too_long_for_a_dns_label_fails_for_good() {
        let workers = workers("{slug}-aarogyam").unwrap();
        let slug = Slug::parse(&"a".repeat(60)).unwrap();
        let host = format!("{}-aarogyam.spring-snow-130f.workers.dev", "a".repeat(60));
        assert!(
            !workers
                .worker_for(Kind::Portal, &slug, &host)
                .unwrap_err()
                .retryable
        );
    }

    #[test]
    fn site_workers_follow_their_own_template_and_never_replace_platform_workers() {
        let both = workers("{slug}-aarogyam")
            .unwrap()
            .with_site("{slug}-site", "aarogyam-site")
            .unwrap();
        let slug = Slug::parse("sunrise").unwrap();
        let name = both
            .worker_for(
                Kind::Site,
                &slug,
                "sunrise-site.spring-snow-130f.workers.dev",
            )
            .unwrap();
        assert_eq!(name.as_str(), "sunrise-site");
        // A portal host is never served by a site Worker, nor the other way round.
        for (kind, host) in [
            (Kind::Site, "sunrise-aarogyam.spring-snow-130f.workers.dev"),
            (Kind::Portal, "sunrise-site.spring-snow-130f.workers.dev"),
        ] {
            assert!(!both.worker_for(kind, &slug, host).unwrap_err().retryable);
        }
        // The site Worker's own name can't be a clinic's.
        let none = Slug::parse("aarogyam").unwrap();
        let refused = both
            .worker_for(
                Kind::Site,
                &none,
                "aarogyam-site.spring-snow-130f.workers.dev",
            )
            .unwrap_err();
        assert_eq!(refused.reason, "the slug names a platform Worker");
        assert!(forwarder("SITE").contains("env.SITE.fetch(request)"));
        assert!(
            workers("{slug}-aarogyam")
                .unwrap()
                .with_site("site", "x")
                .is_err()
        );
    }

    #[test]
    fn templates_need_one_slug() {
        assert!(workers("aarogyam").is_err());
        assert!(workers("{slug}-{slug}").is_err());
    }
}
