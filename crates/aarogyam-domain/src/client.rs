//! Which versions of the phone apps the API still serves.
//!
//! Apps send `x-client: <app>/<version>` with every request. The server compares the version
//! with the minimum it is set to serve and answers `426` below it, and publishes the minimum
//! and latest versions so an app can ask people to update before that happens.

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

/// Why a version, app name or policy entry was not understood.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ClientError {
    /// Not `major.minor.patch`.
    #[error("a version looks like 1.2.3")]
    Version,
    /// Not lower-case letters, digits and hyphens.
    #[error("an app name is 1 to 40 lower-case letters, digits and hyphens")]
    App,
    /// Not `app=version`.
    #[error("an entry looks like aarogyam-staff=0.1.0")]
    Entry,
    /// An app appears twice in one list.
    #[error("an app is listed twice")]
    Duplicate,
}

/// An app version: `major.minor.patch`, compared number by number. A pre-release or build
/// suffix (`0.1.0-beta.2+45`) is ignored, so a beta counts as the release it leads up to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AppVersion {
    major: u64,
    minor: u64,
    patch: u64,
}

impl AppVersion {
    /// Version `0.0.0`, older than any release.
    pub const ZERO: Self = Self {
        major: 0,
        minor: 0,
        patch: 0,
    };
}

impl FromStr for AppVersion {
    type Err = ClientError;

    fn from_str(text: &str) -> Result<Self, ClientError> {
        let numbers = text
            .split(['-', '+'])
            .next()
            .unwrap_or_default()
            .split('.')
            .map(|part| {
                if !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()) {
                    part.parse::<u64>().map_err(|_| ClientError::Version)
                } else {
                    Err(ClientError::Version)
                }
            })
            .collect::<Result<Vec<_>, _>>()?;
        match numbers[..] {
            [major, minor, patch] => Ok(Self {
                major,
                minor,
                patch,
            }),
            _ => Err(ClientError::Version),
        }
    }
}

impl fmt::Display for AppVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

fn valid_app(app: &str) -> bool {
    (1..=40).contains(&app.len())
        && app
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Reads an `x-client` header, `<app>/<version>` such as `aarogyam-staff/0.1.0`. `None` when it
/// isn't that shape, which a server treats like no header.
#[must_use]
pub fn parse_client(header: &str) -> Option<(&str, AppVersion)> {
    let (app, version) = header.trim().split_once('/')?;
    valid_app(app).then_some(())?;
    Some((app, version.parse().ok()?))
}

/// The versions of one app the server serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientRule {
    /// The oldest version still served.
    pub min: AppVersion,
    /// The newest released version, never older than `min`.
    pub latest: AppVersion,
}

/// The versions of each app the server serves.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClientPolicy {
    rules: BTreeMap<String, ClientRule>,
}

fn entries(list: &str) -> Result<BTreeMap<String, AppVersion>, ClientError> {
    let mut found = BTreeMap::new();
    for entry in list.split(',').map(str::trim).filter(|e| !e.is_empty()) {
        let (app, version) = entry.split_once('=').ok_or(ClientError::Entry)?;
        let app = app.trim();
        valid_app(app).then_some(()).ok_or(ClientError::App)?;
        let version = version.trim().parse()?;
        if found.insert(app.to_owned(), version).is_some() {
            return Err(ClientError::Duplicate);
        }
    }
    Ok(found)
}

impl ClientPolicy {
    /// Reads the settings: comma-separated `app=version` pairs, such as
    /// `aarogyam-staff=0.1.0,aarogyam-patient=0.2.0`. An app listed only under `latest` has no
    /// minimum; one listed only under `min_versions` has itself as its latest.
    ///
    /// # Errors
    /// [`ClientError`] for an entry that isn't `app=version`, a bad name or version, or an app
    /// listed twice in one list.
    pub fn parse(min_versions: &str, latest_versions: &str) -> Result<Self, ClientError> {
        let min = entries(min_versions)?;
        let latest = entries(latest_versions)?;
        let mut rules = BTreeMap::new();
        for app in min.keys().chain(latest.keys()) {
            let floor = min.get(app).copied().unwrap_or(AppVersion::ZERO);
            let newest = latest.get(app).copied().unwrap_or(floor).max(floor);
            rules.insert(
                app.clone(),
                ClientRule {
                    min: floor,
                    latest: newest,
                },
            );
        }
        Ok(Self { rules })
    }

    /// Whether the `x-client` header names a listed app at a version below its minimum. A
    /// missing or unreadable header, and apps that aren't listed, are never below.
    #[must_use]
    pub fn is_below_minimum(&self, header: &str) -> bool {
        parse_client(header).is_some_and(|(app, version)| {
            self.rules.get(app).is_some_and(|rule| version < rule.min)
        })
    }

    /// Each listed app and its versions, by name.
    pub fn rules(&self) -> impl Iterator<Item = (&str, ClientRule)> {
        self.rules.iter().map(|(app, rule)| (app.as_str(), *rule))
    }

    /// Whether no app is listed, so nothing is ever refused.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(text: &str) -> AppVersion {
        text.parse().unwrap()
    }

    #[test]
    fn versions_compare_number_by_number() {
        assert!(version("0.10.0") > version("0.9.9"));
        assert!(version("1.0.0") > version("0.99.99"));
        assert_eq!(version("0.1.0-beta.2+45"), version("0.1.0"));
        assert_eq!(version("12.3.4").to_string(), "12.3.4");
        for bad in [
            "", "1", "1.2", "1.2.3.4", "1.x.3", "+1.2.3", "1..3", "-1.2.3", "v1.2.3",
        ] {
            assert_eq!(
                bad.parse::<AppVersion>(),
                Err(ClientError::Version),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn the_header_names_an_app_and_a_version() {
        assert_eq!(
            parse_client("aarogyam-staff/0.1.0"),
            Some(("aarogyam-staff", version("0.1.0")))
        );
        for bad in [
            "",
            "aarogyam-staff",
            "aarogyam-staff/",
            "/0.1.0",
            "Staff/0.1.0",
            "a b/0.1.0",
            "x/1.2",
        ] {
            assert_eq!(parse_client(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_policy_refuses_only_listed_apps_below_their_minimum() {
        let policy = ClientPolicy::parse(
            "aarogyam-staff = 0.2.0, aarogyam-patient=1.0.0",
            "aarogyam-staff=0.3.1",
        )
        .unwrap();
        assert!(policy.is_below_minimum("aarogyam-staff/0.1.9"));
        assert!(policy.is_below_minimum("aarogyam-staff/0.1.0-beta"));
        assert!(!policy.is_below_minimum("aarogyam-staff/0.2.0"));
        assert!(!policy.is_below_minimum("aarogyam-staff/0.10.0"));
        assert!(policy.is_below_minimum("aarogyam-patient/0.9.9"));
        assert!(!policy.is_below_minimum("another-app/0.0.1"));
        assert!(!policy.is_below_minimum("garbage"));
        assert!(!ClientPolicy::default().is_below_minimum("aarogyam-staff/0.0.1"));
        let rules: Vec<_> = policy
            .rules()
            .map(|(app, rule)| (app, rule.min.to_string(), rule.latest.to_string()))
            .collect();
        assert_eq!(
            rules,
            [
                ("aarogyam-patient", "1.0.0".to_owned(), "1.0.0".to_owned()),
                ("aarogyam-staff", "0.2.0".to_owned(), "0.3.1".to_owned()),
            ]
        );
    }

    #[test]
    fn latest_is_never_older_than_the_minimum() {
        let policy = ClientPolicy::parse("app=2.0.0", "app=1.0.0,other=0.5.0").unwrap();
        let rules: Vec<_> = policy
            .rules()
            .map(|(app, rule)| (app, rule.min.to_string(), rule.latest.to_string()))
            .collect();
        assert_eq!(
            rules,
            [
                ("app", "2.0.0".to_owned(), "2.0.0".to_owned()),
                ("other", "0.0.0".to_owned(), "0.5.0".to_owned()),
            ]
        );
        assert!(ClientPolicy::parse("", " , ").unwrap().is_empty());
    }

    #[test]
    fn bad_settings_are_reported() {
        assert_eq!(
            ClientPolicy::parse("aarogyam-staff", ""),
            Err(ClientError::Entry)
        );
        assert_eq!(
            ClientPolicy::parse("Staff=1.0.0", ""),
            Err(ClientError::App)
        );
        assert_eq!(ClientPolicy::parse("a=1.0", ""), Err(ClientError::Version));
        assert_eq!(
            ClientPolicy::parse("a=1.0.0,a=2.0.0", ""),
            Err(ClientError::Duplicate)
        );
        assert_eq!(ClientPolicy::parse("", "a=x"), Err(ClientError::Version));
    }
}
