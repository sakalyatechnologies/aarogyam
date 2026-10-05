//! A clinic's letterhead: the header and footer printed on prescriptions, invoices and receipts.
//! Either an image the clinic uploaded, or one of a few generated designs filled from the
//! clinic's details. No patient data lives here.

use serde_json::{Map, Value, json};
use uuid::Uuid;

use crate::clinic::BrandColor;
use crate::files::FileType;

/// Largest letterhead or logo image: 2 MB.
pub const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
/// Most doctors printed on a letterhead.
pub const MAX_DOCTORS: usize = 4;

/// Why a letterhead setting was rejected. Messages name the field, never the value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LetterheadError {
    /// Not `upload` or `template`.
    #[error("mode must be upload or template")]
    Mode,
    /// Not one of the known designs.
    #[error("template must be one of the listed designs")]
    Template,
    /// Not `#RRGGBB`.
    #[error("accent must be a colour like #0F766E")]
    Accent,
    /// Clinic name in another language over 120 characters or with control characters.
    #[error("local_name must be at most 120 characters")]
    LocalName,
    /// Footer over 200 characters or with control characters.
    #[error("footer must be at most 200 characters")]
    Footer,
    /// Email that is not an address.
    #[error("email must be a valid email address")]
    Email,
    /// Timings over 200 characters or with control characters.
    #[error("timings must be at most 200 characters")]
    Timings,
    /// More than four doctors, or the same doctor twice.
    #[error("doctor_ids must list at most 4 different doctors")]
    Doctors,
    /// Upload mode with no uploaded image.
    #[error("upload a letterhead image before choosing upload mode")]
    MissingImage,
    /// An image that is too large, empty or not PNG or JPEG.
    #[error("image must be a PNG or JPEG of at most 2 MB")]
    Image,
}

impl LetterheadError {
    /// The request field the error concerns.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::Mode | Self::MissingImage => "letterhead.mode",
            Self::Template => "letterhead.template",
            Self::Accent => "letterhead.accent",
            Self::LocalName => "letterhead.local_name",
            Self::Footer => "letterhead.footer",
            Self::Email => "letterhead.email",
            Self::Timings => "letterhead.timings",
            Self::Doctors => "letterhead.doctor_ids",
            Self::Image => "image",
        }
    }
}

/// Where the header comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LetterheadMode {
    /// The clinic's own image.
    Upload,
    /// A generated design.
    Template,
}

impl LetterheadMode {
    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Template => "template",
        }
    }

    /// Parses `upload` or `template`.
    ///
    /// # Errors
    /// [`LetterheadError::Mode`] for anything else.
    pub fn parse(text: &str) -> Result<Self, LetterheadError> {
        match text.trim() {
            "upload" => Ok(Self::Upload),
            "template" => Ok(Self::Template),
            _ => Err(LetterheadError::Mode),
        }
    }
}

/// The generated designs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateId {
    /// Logo on the left, doctor block on the right.
    LogoLeft,
    /// Centred, serif, double rule.
    Classic,
    /// A coloured band across the top.
    ModernBand,
    /// A single thin line.
    MinimalLine,
    /// Two doctors side by side under the clinic name.
    TwoDoctor,
    /// Clinic name in two scripts, ready for a regional language.
    Bilingual,
}

impl TemplateId {
    /// Every design, in the order pickers show them.
    pub const ALL: [Self; 6] = [
        Self::LogoLeft,
        Self::Classic,
        Self::ModernBand,
        Self::MinimalLine,
        Self::TwoDoctor,
        Self::Bilingual,
    ];

    /// The stored value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LogoLeft => "logo_left",
            Self::Classic => "classic",
            Self::ModernBand => "modern_band",
            Self::MinimalLine => "minimal_line",
            Self::TwoDoctor => "two_doctor",
            Self::Bilingual => "bilingual",
        }
    }

    /// Parses a stored value.
    ///
    /// # Errors
    /// [`LetterheadError::Template`] for an unknown design.
    pub fn parse(text: &str) -> Result<Self, LetterheadError> {
        Self::ALL
            .into_iter()
            .find(|id| id.as_str() == text.trim())
            .ok_or(LetterheadError::Template)
    }
}

/// Which clinic details a generated design prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "one switch per printed detail"
)]
pub struct Shown {
    /// The logo image.
    pub logo: bool,
    /// The doctors, with qualifications.
    pub doctors: bool,
    /// Their registration numbers.
    pub registration: bool,
    /// The address.
    pub address: bool,
    /// The phone number.
    pub phone: bool,
    /// The email address.
    pub email: bool,
    /// The opening hours.
    pub timings: bool,
    /// The GSTIN.
    pub gstin: bool,
}

impl Default for Shown {
    fn default() -> Self {
        Self {
            logo: true,
            doctors: true,
            registration: true,
            address: true,
            phone: true,
            email: true,
            timings: true,
            gstin: false,
        }
    }
}

/// A stored image: the bytes live in file storage under the clinic's folder and this id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageRef {
    /// The storage id.
    pub id: Uuid,
    /// PNG or JPEG.
    pub file_type: FileType,
    /// Size in bytes.
    pub size_bytes: usize,
}

/// Checks an uploaded image from its bytes: 1 byte to 2 MB, PNG or JPEG by content.
///
/// # Errors
/// [`LetterheadError::Image`] otherwise.
pub fn check_image(bytes: &[u8]) -> Result<FileType, LetterheadError> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(LetterheadError::Image);
    }
    match FileType::sniff(bytes) {
        Some(kind @ (FileType::Jpeg | FileType::Png)) => Ok(kind),
        _ => Err(LetterheadError::Image),
    }
}

/// The letterhead settings of a clinic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Letterhead {
    /// Uploaded image or generated design.
    pub mode: LetterheadMode,
    /// The design used in template mode.
    pub template: TemplateId,
    /// Accent colour of the design; the portal's brand colour when none.
    pub accent: Option<BrandColor>,
    /// Which details a design prints.
    pub shown: Shown,
    /// The clinic's name in another script, such as Hindi, shown by the bilingual design.
    pub local_name: Option<String>,
    /// One line printed at the foot, such as `Timings: Mon to Sat 9 to 6`.
    pub footer: Option<String>,
    /// Clinic email.
    pub email: Option<String>,
    /// Opening hours.
    pub timings: Option<String>,
    /// The doctors printed, in order; empty means the first active doctors by name.
    pub doctor_ids: Vec<Uuid>,
    /// The uploaded letterhead image.
    pub image: Option<ImageRef>,
    /// The logo used by designs.
    pub logo: Option<ImageRef>,
}

impl Default for Letterhead {
    fn default() -> Self {
        Self {
            mode: LetterheadMode::Template,
            template: TemplateId::Classic,
            accent: None,
            shown: Shown::default(),
            local_name: None,
            footer: None,
            email: None,
            timings: None,
            doctor_ids: Vec::new(),
            image: None,
            logo: None,
        }
    }
}

/// Changes to the letterhead; `None` leaves a value as it is and an empty string clears an
/// optional text.
#[derive(Debug, Clone, Default)]
pub struct LetterheadChanges {
    /// `upload` or `template`.
    pub mode: Option<String>,
    /// A design id.
    pub template: Option<String>,
    /// `#RRGGBB`.
    pub accent: Option<String>,
    /// Details shown; each given flag replaces the stored one.
    pub shown: ShownChanges,
    /// The clinic's name in another script.
    pub local_name: Option<String>,
    /// Footer line.
    pub footer: Option<String>,
    /// Clinic email.
    pub email: Option<String>,
    /// Opening hours.
    pub timings: Option<String>,
    /// The doctors printed.
    pub doctor_ids: Option<Vec<Uuid>>,
}

/// Changes to [`Shown`].
#[derive(Debug, Clone, Copy, Default)]
pub struct ShownChanges {
    /// The logo image.
    pub logo: Option<bool>,
    /// The doctors.
    pub doctors: Option<bool>,
    /// Registration numbers.
    pub registration: Option<bool>,
    /// The address.
    pub address: Option<bool>,
    /// The phone number.
    pub phone: Option<bool>,
    /// The email address.
    pub email: Option<bool>,
    /// The opening hours.
    pub timings: Option<bool>,
    /// The GSTIN.
    pub gstin: Option<bool>,
}

fn one_line(
    text: &str,
    max: usize,
    error: LetterheadError,
) -> Result<Option<String>, LetterheadError> {
    if text.chars().any(char::is_control) {
        return Err(error);
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Ok(None);
    }
    if text.chars().count() > max {
        return Err(error);
    }
    Ok(Some(text))
}

fn email(text: &str) -> Result<Option<String>, LetterheadError> {
    let Some(text) = one_line(text, 254, LetterheadError::Email)? else {
        return Ok(None);
    };
    let valid = text.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty()
            && !text.contains(' ')
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !domain.contains('@')
    });
    if valid {
        Ok(Some(text.to_ascii_lowercase()))
    } else {
        Err(LetterheadError::Email)
    }
}

impl Letterhead {
    /// Applies `changes`, validating each given value.
    ///
    /// # Errors
    /// The first [`LetterheadError`] found; upload mode needs an uploaded image.
    pub fn apply(&mut self, changes: &LetterheadChanges) -> Result<(), LetterheadError> {
        if let Some(mode) = &changes.mode {
            self.mode = LetterheadMode::parse(mode)?;
        }
        if let Some(template) = &changes.template {
            self.template = TemplateId::parse(template)?;
        }
        if let Some(accent) = &changes.accent {
            self.accent = if accent.trim().is_empty() {
                None
            } else {
                Some(BrandColor::parse(accent).map_err(|_| LetterheadError::Accent)?)
            };
        }
        let shown = &changes.shown;
        let flags = [
            (&mut self.shown.logo, shown.logo),
            (&mut self.shown.doctors, shown.doctors),
            (&mut self.shown.registration, shown.registration),
            (&mut self.shown.address, shown.address),
            (&mut self.shown.phone, shown.phone),
            (&mut self.shown.email, shown.email),
            (&mut self.shown.timings, shown.timings),
            (&mut self.shown.gstin, shown.gstin),
        ];
        for (flag, given) in flags {
            if let Some(given) = given {
                *flag = given;
            }
        }
        if let Some(name) = &changes.local_name {
            self.local_name = one_line(name, 120, LetterheadError::LocalName)?;
        }
        if let Some(footer) = &changes.footer {
            self.footer = one_line(footer, 200, LetterheadError::Footer)?;
        }
        if let Some(text) = &changes.email {
            self.email = email(text)?;
        }
        if let Some(timings) = &changes.timings {
            self.timings = one_line(timings, 200, LetterheadError::Timings)?;
        }
        if let Some(ids) = &changes.doctor_ids {
            let mut seen = ids.clone();
            seen.sort();
            seen.dedup();
            if ids.len() > MAX_DOCTORS || seen.len() != ids.len() {
                return Err(LetterheadError::Doctors);
            }
            self.doctor_ids.clone_from(ids);
        }
        if self.mode == LetterheadMode::Upload && self.image.is_none() {
            return Err(LetterheadError::MissingImage);
        }
        Ok(())
    }

    /// Reads stored settings; anything missing or malformed falls back to the default, so an
    /// old or hand-edited row never breaks a page.
    #[must_use]
    pub fn from_value(value: &Value) -> Self {
        let mut out = Self::default();
        let text = |key: &str| value.get(key).and_then(Value::as_str);
        if let Some(mode) = text("mode").and_then(|t| LetterheadMode::parse(t).ok()) {
            out.mode = mode;
        }
        if let Some(template) = text("template").and_then(|t| TemplateId::parse(t).ok()) {
            out.template = template;
        }
        out.accent = text("accent").and_then(|t| BrandColor::parse(t).ok());
        out.local_name = text("local_name")
            .filter(|t| !t.is_empty())
            .map(str::to_owned);
        out.footer = text("footer").filter(|t| !t.is_empty()).map(str::to_owned);
        out.email = text("email").filter(|t| !t.is_empty()).map(str::to_owned);
        out.timings = text("timings").filter(|t| !t.is_empty()).map(str::to_owned);
        if let Some(shown) = value.get("shown") {
            let flag = |key: &str, default: bool| {
                shown.get(key).and_then(Value::as_bool).unwrap_or(default)
            };
            let d = Shown::default();
            out.shown = Shown {
                logo: flag("logo", d.logo),
                doctors: flag("doctors", d.doctors),
                registration: flag("registration", d.registration),
                address: flag("address", d.address),
                phone: flag("phone", d.phone),
                email: flag("email", d.email),
                timings: flag("timings", d.timings),
                gstin: flag("gstin", d.gstin),
            };
        }
        if let Some(ids) = value.get("doctor_ids").and_then(Value::as_array) {
            out.doctor_ids = ids
                .iter()
                .filter_map(|id| id.as_str().and_then(|t| Uuid::try_parse(t).ok()))
                .take(MAX_DOCTORS)
                .collect();
        }
        out.image = value.get("image").and_then(image_from_value);
        out.logo = value.get("logo").and_then(image_from_value);
        if out.mode == LetterheadMode::Upload && out.image.is_none() {
            out.mode = LetterheadMode::Template;
        }
        out
    }

    /// The stored form.
    #[must_use]
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        map.insert("mode".into(), json!(self.mode.as_str()));
        map.insert("template".into(), json!(self.template.as_str()));
        if let Some(accent) = &self.accent {
            map.insert("accent".into(), json!(accent.as_str()));
        }
        let s = &self.shown;
        map.insert(
            "shown".into(),
            json!({
                "logo": s.logo, "doctors": s.doctors, "registration": s.registration,
                "address": s.address, "phone": s.phone, "email": s.email,
                "timings": s.timings, "gstin": s.gstin,
            }),
        );
        for (key, text) in [
            ("local_name", &self.local_name),
            ("footer", &self.footer),
            ("email", &self.email),
            ("timings", &self.timings),
        ] {
            if let Some(text) = text {
                map.insert(key.into(), json!(text));
            }
        }
        map.insert(
            "doctor_ids".into(),
            json!(
                self.doctor_ids
                    .iter()
                    .map(Uuid::to_string)
                    .collect::<Vec<_>>()
            ),
        );
        for (key, image) in [("image", &self.image), ("logo", &self.logo)] {
            if let Some(image) = image {
                map.insert(
                    key.into(),
                    json!({
                        "id": image.id.to_string(),
                        "mime": image.file_type.mime_type(),
                        "size": image.size_bytes,
                    }),
                );
            }
        }
        Value::Object(map)
    }
}

fn image_from_value(value: &Value) -> Option<ImageRef> {
    let id = Uuid::try_parse(value.get("id")?.as_str()?).ok()?;
    let file_type = FileType::from_mime_type(value.get("mime")?.as_str()?)
        .filter(|kind| matches!(kind, FileType::Jpeg | FileType::Png))?;
    let size_bytes = usize::try_from(value.get("size")?.as_u64()?).ok()?;
    Some(ImageRef {
        id,
        file_type,
        size_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&[0; 32]);
        bytes
    }

    #[test]
    fn images_are_checked_by_content_and_size() {
        assert_eq!(check_image(&png()), Ok(FileType::Png));
        assert_eq!(check_image(&[0xFF, 0xD8, 0xFF, 0xE0]), Ok(FileType::Jpeg));
        assert_eq!(check_image(b"%PDF-1.7"), Err(LetterheadError::Image));
        assert_eq!(check_image(&[]), Err(LetterheadError::Image));
        let mut big = png();
        big.resize(MAX_IMAGE_BYTES + 1, 0);
        assert_eq!(check_image(&big), Err(LetterheadError::Image));
        big.truncate(MAX_IMAGE_BYTES);
        assert_eq!(check_image(&big), Ok(FileType::Png));
    }

    #[test]
    fn changes_merge_and_round_trip() {
        let mut letterhead = Letterhead::default();
        let doctor = Uuid::from_u128(7);
        letterhead
            .apply(&LetterheadChanges {
                template: Some("modern_band".into()),
                accent: Some("#0f766e".into()),
                shown: ShownChanges {
                    gstin: Some(true),
                    phone: Some(false),
                    ..ShownChanges::default()
                },
                footer: Some("  Open   Mon to Sat ".into()),
                email: Some(" Care@Alpha.IN ".into()),
                doctor_ids: Some(vec![doctor]),
                ..LetterheadChanges::default()
            })
            .unwrap();
        assert_eq!(letterhead.template, TemplateId::ModernBand);
        assert_eq!(letterhead.accent.as_ref().unwrap().as_str(), "#0F766E");
        assert!(letterhead.shown.gstin && !letterhead.shown.phone && letterhead.shown.email);
        assert_eq!(letterhead.footer.as_deref(), Some("Open Mon to Sat"));
        assert_eq!(letterhead.email.as_deref(), Some("care@alpha.in"));
        assert_eq!(Letterhead::from_value(&letterhead.to_value()), letterhead);
        letterhead
            .apply(&LetterheadChanges {
                footer: Some(String::new()),
                accent: Some(String::new()),
                ..LetterheadChanges::default()
            })
            .unwrap();
        assert_eq!((letterhead.footer, letterhead.accent), (None, None));
    }

    #[test]
    fn bad_values_are_refused_with_their_field() {
        let cases = [
            (
                LetterheadChanges {
                    mode: Some("paper".into()),
                    ..Default::default()
                },
                LetterheadError::Mode,
            ),
            (
                LetterheadChanges {
                    template: Some("fancy".into()),
                    ..Default::default()
                },
                LetterheadError::Template,
            ),
            (
                LetterheadChanges {
                    accent: Some("teal".into()),
                    ..Default::default()
                },
                LetterheadError::Accent,
            ),
            (
                LetterheadChanges {
                    local_name: Some("x".repeat(121)),
                    ..Default::default()
                },
                LetterheadError::LocalName,
            ),
            (
                LetterheadChanges {
                    footer: Some("x".repeat(201)),
                    ..Default::default()
                },
                LetterheadError::Footer,
            ),
            (
                LetterheadChanges {
                    footer: Some("a\u{7}b".into()),
                    ..Default::default()
                },
                LetterheadError::Footer,
            ),
            (
                LetterheadChanges {
                    email: Some("nobody".into()),
                    ..Default::default()
                },
                LetterheadError::Email,
            ),
            (
                LetterheadChanges {
                    email: Some("a@b".into()),
                    ..Default::default()
                },
                LetterheadError::Email,
            ),
            (
                LetterheadChanges {
                    timings: Some("x".repeat(201)),
                    ..Default::default()
                },
                LetterheadError::Timings,
            ),
            (
                LetterheadChanges {
                    doctor_ids: Some((1..=5).map(Uuid::from_u128).collect()),
                    ..Default::default()
                },
                LetterheadError::Doctors,
            ),
            (
                LetterheadChanges {
                    doctor_ids: Some(vec![Uuid::from_u128(1); 2]),
                    ..Default::default()
                },
                LetterheadError::Doctors,
            ),
            (
                LetterheadChanges {
                    mode: Some("upload".into()),
                    ..Default::default()
                },
                LetterheadError::MissingImage,
            ),
        ];
        for (changes, error) in cases {
            assert_eq!(Letterhead::default().apply(&changes), Err(error), "{error}");
        }
        assert_eq!(LetterheadError::Image.field(), "image");
    }

    #[test]
    fn stored_junk_falls_back_to_defaults() {
        let value =
            json!({ "mode": "upload", "template": "zzz", "accent": 5, "shown": { "logo": "x" } });
        let letterhead = Letterhead::from_value(&value);
        assert_eq!(letterhead.mode, LetterheadMode::Template); // upload without an image
        assert_eq!(letterhead.template, TemplateId::Classic);
        assert_eq!(letterhead, Letterhead::default());
        assert_eq!(Letterhead::from_value(&Value::Null), Letterhead::default());
    }
}
