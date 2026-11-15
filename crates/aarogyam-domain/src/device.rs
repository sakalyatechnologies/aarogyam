//! The phones the staff app signs in from, as far as push notifications care: which platform,
//! which app, a language and a token that is not empty or absurdly long. Pure rules.

/// The phone's operating system, which decides the push provider: APNs or FCM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DevicePlatform {
    /// iPhone: Apple's push service, directly.
    Ios,
    /// Android: Firebase Cloud Messaging.
    Android,
}

impl DevicePlatform {
    /// The value stored and sent over the API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ios => "ios",
            Self::Android => "android",
        }
    }

    /// Parses the stored value; `None` for `web` or anything else (nothing is pushed to those).
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "ios" => Some(Self::Ios),
            "android" => Some(Self::Android),
            _ => None,
        }
    }
}

/// Which of our apps a device belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DeviceApp {
    /// The clinic staff app.
    Staff,
    /// The patient app: reserved, not accepted yet.
    Patient,
}

impl DeviceApp {
    /// The value stored and sent over the API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Staff => "staff",
            Self::Patient => "patient",
        }
    }

    /// Parses the API value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "staff" => Some(Self::Staff),
            "patient" => Some(Self::Patient),
            _ => None,
        }
    }

    /// Whether devices of this app can be registered today.
    #[must_use]
    pub const fn supported(self) -> bool {
        matches!(self, Self::Staff)
    }
}

/// Longest FCM registration token accepted, in characters. They run to about 200.
pub const FCM_TOKEN_MAX: usize = 4096;
/// Shortest FCM registration token accepted.
pub const FCM_TOKEN_MIN: usize = 64;
/// Shortest APNs device token accepted, in hex characters (32 bytes).
pub const APNS_TOKEN_MIN: usize = 64;
/// Longest APNs device token accepted, in hex characters: Apple says tokens have no fixed
/// length and to allow up to 100 bytes.
pub const APNS_TOKEN_MAX: usize = 200;
/// Longest app version accepted, in characters.
pub const APP_VERSION_MAX: usize = 40;

/// Whether `token` can be a push token for `platform`: an APNs token is hex of 64 to 200
/// characters; an FCM token is `[A-Za-z0-9_:-]` of 64 to 4096. Tokens go into a request path
/// and a header, so nothing else is accepted: `/`, `?`, `#` and whitespace never get in.
#[must_use]
pub fn valid_token(platform: DevicePlatform, token: &str) -> bool {
    match platform {
        DevicePlatform::Ios => {
            (APNS_TOKEN_MIN..=APNS_TOKEN_MAX).contains(&token.len())
                && token.bytes().all(|b| b.is_ascii_hexdigit())
        }
        DevicePlatform::Android => {
            (FCM_TOKEN_MIN..=FCM_TOKEN_MAX).contains(&token.len())
                && token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'-'))
        }
    }
}

/// Whether `text` looks like `en-IN`: two lowercase letters, a hyphen, two capitals.
#[must_use]
pub fn valid_locale(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 5
        && bytes[..2].iter().all(u8::is_ascii_lowercase)
        && bytes[2] == b'-'
        && bytes[3..].iter().all(u8::is_ascii_uppercase)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platforms_and_apps_round_trip() {
        assert_eq!(DevicePlatform::parse("ios"), Some(DevicePlatform::Ios));
        assert_eq!(
            DevicePlatform::parse("android"),
            Some(DevicePlatform::Android)
        );
        assert_eq!(DevicePlatform::parse("web"), None);
        assert!(DeviceApp::Staff.supported());
        assert!(!DeviceApp::Patient.supported());
    }

    #[test]
    fn tokens_and_locales_are_checked() {
        use DevicePlatform::{Android, Ios};
        let hex = "ab12".repeat(16);
        assert!(valid_token(Ios, &hex));
        assert!(valid_token(Ios, &"f".repeat(APNS_TOKEN_MAX)));
        assert!(!valid_token(Ios, &"f".repeat(APNS_TOKEN_MAX + 1)));
        assert!(!valid_token(Ios, &hex[..63]));
        assert!(!valid_token(Ios, &format!("{}g", &hex[..63])));
        assert!(!valid_token(Ios, &format!("x/../{}", &hex[..59])));
        let fcm = "aB_-:9".repeat(12);
        assert!(valid_token(Android, &fcm));
        assert!(valid_token(Android, &"a".repeat(FCM_TOKEN_MAX)));
        assert!(!valid_token(Android, &"a".repeat(FCM_TOKEN_MAX + 1)));
        assert!(!valid_token(Android, &fcm[..63]));
        for bad in ["/", "?", "#", " ", ".", "%2f", "\n"] {
            assert!(
                !valid_token(Android, &format!("{}{bad}", &fcm[..64])),
                "{bad}"
            );
        }
        assert!(valid_locale("en-IN"));
        assert!(valid_locale("hi-IN"));
        assert!(!valid_locale("en_IN"));
        assert!(!valid_locale("EN-in"));
        assert!(!valid_locale("english"));
        assert!(!valid_locale(""));
    }
}
