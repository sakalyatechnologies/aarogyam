//! A clinic's public website: which design it uses, the text its owner wrote, the pictures it
//! accepts, and the domain it may be served on. Pure rules; the use cases in `aarogyam-app`
//! store and read it.
//!
//! The clinic's name, doctors, price list, hours and address are not content: they are read
//! from their own tables when a page is shown. Content holds only what the owner adds on top.

use serde::{Deserialize, Serialize};

text_value! {
    /// One page with every section, or several pages.
    Layout ("layout") {
        /// A single scrolling page.
        One => "one",
        /// Home, about and doctors, services, gallery, contact and booking.
        Multi => "multi",
    }
}

text_value! {
    /// What a picture is for.
    PhotoKind ("kind") {
        /// The clinic's logo (one).
        Logo => "logo",
        /// The picture at the top of the home page (one).
        Hero => "hero",
        /// The picture beside the about text (one).
        About => "about",
        /// A doctor's portrait, chosen in the doctor's profile.
        Doctor => "doctor",
        /// A picture in the gallery.
        Gallery => "gallery",
    }
}

impl PhotoKind {
    /// Whether a clinic has only one of this kind, so a new upload replaces the old one.
    #[must_use]
    pub const fn is_single(self) -> bool {
        matches!(self, Self::Logo | Self::Hero | Self::About)
    }
}

text_value! {
    /// Where verification of the clinic's own domain stands.
    DomainStatus ("domain_status") {
        /// No custom domain.
        None => "none",
        /// The records have been shown; they have not been seen yet.
        Pending => "pending",
        /// The records were found.
        Verified => "verified",
        /// The last check did not find them.
        Failed => "failed",
    }
}

/// A design, with the colour palettes it offers.
#[derive(Debug, Clone, Copy)]
pub struct Template {
    /// The identifier stored and sent over the API.
    pub id: &'static str,
    /// The palettes this design offers; the first is the default.
    pub palettes: &'static [&'static str],
}

/// Every design. The portal and the site app draw the same ones; adding a design means adding
/// it here, in the renderer and in the catalogue test.
pub const TEMPLATES: &[Template] = &[
    Template {
        id: "aurora",
        palettes: &["gold", "emerald", "sapphire", "amethyst"],
    },
    Template {
        id: "hearth",
        palettes: &["terracotta", "sage", "honey", "berry"],
    },
    Template {
        id: "clinical",
        palettes: &["sky", "mint", "slate", "indigo"],
    },
    Template {
        id: "bold",
        palettes: &["electric", "coral", "lime", "violet"],
    },
];

/// Font pairings (heading and body).
pub const FONTS: &[&str] = &["modern", "elegant", "friendly", "editorial"];

/// Why website settings were rejected. The message names the field, never the value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{field}: {message}")]
pub struct WebsiteError {
    /// The field, as the API names it.
    pub field: &'static str,
    /// What is wrong.
    pub message: &'static str,
}

const fn bad(field: &'static str, message: &'static str) -> WebsiteError {
    WebsiteError { field, message }
}

/// Checks that the palette belongs to the template and the fonts exist.
///
/// # Errors
/// [`WebsiteError`] naming `template`, `palette` or `fonts`.
pub fn check_design(template: &str, palette: &str, fonts: &str) -> Result<(), WebsiteError> {
    let found = TEMPLATES
        .iter()
        .find(|t| t.id == template)
        .ok_or(bad("template", "is not one of the available designs"))?;
    if !found.palettes.contains(&palette) {
        return Err(bad("palette", "is not one of this design's palettes"));
    }
    if !FONTS.contains(&fonts) {
        return Err(bad("fonts", "is not one of the font pairings"));
    }
    Ok(())
}

/// A picture type the website accepts, decided from the bytes, not the file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SiteImage {
    /// JPEG.
    Jpeg,
    /// PNG.
    Png,
    /// WebP.
    Webp,
}

/// Largest picture accepted: 5 MB.
pub const MAX_PHOTO_BYTES: usize = 5 * 1024 * 1024;

/// Most pictures a clinic may keep (the gallery plus doctors, logo, hero and about).
pub const MAX_PHOTOS: usize = 60;

impl SiteImage {
    /// Recognises a picture from its first bytes.
    #[must_use]
    pub fn sniff(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(Self::Jpeg)
        } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some(Self::Png)
        } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(Self::Webp)
        } else {
            None
        }
    }

    /// The media type stored and served.
    #[must_use]
    pub const fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }

    /// Parses a stored media type.
    #[must_use]
    pub fn from_mime_type(text: &str) -> Option<Self> {
        [Self::Jpeg, Self::Png, Self::Webp]
            .into_iter()
            .find(|kind| kind.mime_type() == text)
    }
}

/// A domain name the clinic owns, such as `smilecatchers.in` or `www.example.co.in`: lower case,
/// two or more labels, letters, digits and hyphens only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomDomain(String);

impl CustomDomain {
    /// Cleans and checks a domain the owner typed. A pasted `https://` and a trailing slash or
    /// dot are removed; anything else that is not a bare domain name is refused.
    ///
    /// # Errors
    /// [`WebsiteError`] naming `custom_domain`.
    pub fn parse(text: &str) -> Result<Self, WebsiteError> {
        let invalid = bad(
            "custom_domain",
            "must be a domain name such as clinic.example.in",
        );
        let lower = text.trim().to_ascii_lowercase();
        let host = lower
            .strip_prefix("https://")
            .or_else(|| lower.strip_prefix("http://"))
            .unwrap_or(&lower)
            .trim_end_matches('/')
            .trim_end_matches('.');
        if host.is_empty() || host.len() > 253 {
            return Err(invalid);
        }
        let labels: Vec<&str> = host.split('.').collect();
        let label_ok = |label: &&str| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        };
        // A last label of digits only would be an IP address; top-level names are letters.
        let tld_ok = labels
            .last()
            .is_some_and(|tld| tld.len() >= 2 && tld.bytes().any(|b| b.is_ascii_lowercase()));
        if labels.len() < 2 || !labels.iter().all(label_ok) || !tld_ok {
            return Err(invalid);
        }
        Ok(Self(host.to_owned()))
    }

    /// The domain, lower case.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// ---------------------------------------------------------------------------------- content

/// The text above the first section.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Hero {
    /// The main line.
    pub headline: String,
    /// A line under it.
    pub subheadline: String,
    /// The booking button's label.
    pub cta_label: String,
}

/// About the clinic.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct About {
    /// Section title.
    pub title: String,
    /// A few paragraphs.
    pub body: String,
    /// Short points, such as `Painless root canals`.
    pub highlights: Vec<String>,
}

/// What the owner adds to a doctor the clinic already has.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DoctorProfile {
    /// The doctor (a practitioner of this clinic).
    pub practitioner_id: String,
    /// Degrees and training, such as `BDS, MDS (Orthodontics)`.
    pub qualifications: String,
    /// A short introduction.
    pub bio: String,
    /// A doctor portrait uploaded to the website.
    pub photo_id: Option<String>,
    /// Leave the doctor off the website.
    pub hidden: bool,
}

/// Services and fees.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Services {
    /// A line above the list.
    pub intro: String,
    /// Whether fees from the price list are shown.
    pub show_fees: bool,
    /// Price list entries left off the website.
    pub hidden: Vec<String>,
    /// A sentence about a service, shown under its name.
    pub notes: Vec<ServiceNote>,
}

impl Default for Services {
    fn default() -> Self {
        Self {
            intro: String::new(),
            show_fees: true,
            hidden: Vec::new(),
            notes: Vec::new(),
        }
    }
}

/// A sentence about one price list entry.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ServiceNote {
    /// The price list entry.
    pub price_item_id: String,
    /// What the patient should know.
    pub description: String,
}

/// A review the clinic chose to show; the clinic types these in.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Review {
    /// Who wrote it, as they wish to be shown (a first name and initial is enough).
    pub name: String,
    /// 1 to 5.
    pub rating: u8,
    /// What they said.
    pub text: String,
}

/// Contact details beyond the branch's phone and address.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Contact {
    /// The `WhatsApp` number; +91 is assumed without a country code.
    pub whatsapp: String,
    /// Public email address.
    pub email: String,
    /// A `https://` link to the clinic on a map.
    pub map_url: String,
    /// A note under the opening hours, such as `Closed on public holidays`.
    pub hours_note: String,
}

/// Links to the clinic's profiles.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Social {
    /// An `https://` link.
    pub instagram: String,
    /// An `https://` link.
    pub facebook: String,
    /// An `https://` link.
    pub youtube: String,
}

/// What search engines show.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Seo {
    /// Page title, up to 70 characters.
    pub title: String,
    /// Description, up to 170 characters.
    pub description: String,
}

/// Everything the owner writes. Every part is optional: the site shows sensible wording for
/// what is left empty.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SiteContent {
    /// The top of the home page.
    pub hero: Hero,
    /// About the clinic.
    pub about: About,
    /// Doctor introductions.
    pub doctors: Vec<DoctorProfile>,
    /// Services and fees.
    pub services: Services,
    /// Reviews.
    pub reviews: Vec<Review>,
    /// Contact details.
    pub contact: Contact,
    /// Social links.
    pub social: Social,
    /// Search engine text.
    pub seo: Seo,
}

fn single_line(field: &'static str, text: &str, max: usize) -> Result<String, WebsiteError> {
    if text.chars().any(char::is_control) {
        return Err(bad(field, "must not contain control characters"));
    }
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() > max {
        return Err(bad(field, "is too long"));
    }
    Ok(clean)
}

/// Paragraphs: line breaks are kept, runs of blank lines collapse, and other control
/// characters are refused.
fn paragraphs(field: &'static str, text: &str, max: usize) -> Result<String, WebsiteError> {
    if text
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r')
    {
        return Err(bad(field, "must not contain control characters"));
    }
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let mut out = String::new();
    let mut blank = 0;
    for line in lines {
        if line.is_empty() {
            blank += 1;
            continue;
        }
        if !out.is_empty() {
            out.push_str(if blank > 0 { "\n\n" } else { "\n" });
        }
        blank = 0;
        out.push_str(line);
    }
    if out.chars().count() > max {
        return Err(bad(field, "is too long"));
    }
    Ok(out)
}

/// An `https://` link without spaces or characters that could break out of an attribute.
fn link(field: &'static str, text: &str) -> Result<String, WebsiteError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let ok = text.len() <= 500
        && text.starts_with("https://")
        && text.len() > "https://".len()
        && !text.chars().any(|c| {
            c.is_control() || c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '\\')
        });
    if ok {
        Ok(text.to_owned())
    } else {
        Err(bad(field, "must be a link starting with https://"))
    }
}

fn email(field: &'static str, text: &str) -> Result<String, WebsiteError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(String::new());
    }
    let ok = text.len() <= 120
        && text.matches('@').count() == 1
        && !text.starts_with('@')
        && !text.ends_with('@')
        && text.split('@').nth(1).is_some_and(|d| d.contains('.'))
        && !text.chars().any(|c| {
            c.is_control() || c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | ',')
        });
    if ok {
        Ok(text.to_owned())
    } else {
        Err(bad(field, "is not a valid email address"))
    }
}

fn uuid_text(field: &'static str, text: &str) -> Result<String, WebsiteError> {
    let text = text.trim().to_ascii_lowercase();
    let shape = text.len() == 36
        && text.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        });
    if shape {
        Ok(text)
    } else {
        Err(bad(field, "is not a valid identifier"))
    }
}

fn at_most<T>(field: &'static str, list: &[T], max: usize) -> Result<(), WebsiteError> {
    if list.len() > max {
        Err(bad(field, "has too many entries"))
    } else {
        Ok(())
    }
}

fn clean_doctors(doctors: Vec<DoctorProfile>) -> Result<Vec<DoctorProfile>, WebsiteError> {
    at_most("content.doctors", &doctors, 50)?;
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for d in doctors {
        let id = uuid_text("content.doctors.practitioner_id", &d.practitioner_id)?;
        if seen.contains(&id) {
            return Err(bad("content.doctors", "lists a doctor twice"));
        }
        seen.push(id.clone());
        out.push(DoctorProfile {
            practitioner_id: id,
            qualifications: single_line("content.doctors.qualifications", &d.qualifications, 160)?,
            bio: paragraphs("content.doctors.bio", &d.bio, 800)?,
            photo_id: d
                .photo_id
                .filter(|p| !p.trim().is_empty())
                .map(|p| uuid_text("content.doctors.photo_id", &p))
                .transpose()?,
            hidden: d.hidden,
        });
    }
    Ok(out)
}

fn clean_services(services: &Services) -> Result<Services, WebsiteError> {
    at_most("content.services.hidden", &services.hidden, 300)?;
    at_most("content.services.notes", &services.notes, 100)?;
    Ok(Services {
        intro: single_line("content.services.intro", &services.intro, 400)?,
        show_fees: services.show_fees,
        hidden: services
            .hidden
            .iter()
            .map(|id| uuid_text("content.services.hidden", id))
            .collect::<Result<_, _>>()?,
        notes: services
            .notes
            .iter()
            .map(|n| {
                Ok(ServiceNote {
                    price_item_id: uuid_text("content.services.notes", &n.price_item_id)?,
                    description: single_line("content.services.notes", &n.description, 200)?,
                })
            })
            .collect::<Result<_, _>>()?,
    })
}

fn clean_reviews(reviews: &[Review]) -> Result<Vec<Review>, WebsiteError> {
    at_most("content.reviews", reviews, 12)?;
    reviews
        .iter()
        .map(|r| {
            if !(1..=5).contains(&r.rating) {
                return Err(bad("content.reviews.rating", "must be 1 to 5"));
            }
            let name = single_line("content.reviews.name", &r.name, 80)?;
            let text = paragraphs("content.reviews.text", &r.text, 500)?;
            if name.is_empty() || text.is_empty() {
                return Err(bad("content.reviews", "need a name and the review text"));
            }
            Ok(Review {
                name,
                rating: r.rating,
                text,
            })
        })
        .collect()
}

impl SiteContent {
    /// Trims and checks every part, returning the content as it will be stored. The number
    /// in `contact.whatsapp` is left as typed; the use case normalises it.
    ///
    /// # Errors
    /// [`WebsiteError`] naming the first field that is too long, malformed or has too many
    /// entries.
    pub fn cleaned(self) -> Result<Self, WebsiteError> {
        at_most("content.about.highlights", &self.about.highlights, 6)?;
        let Self {
            hero,
            about,
            doctors,
            services,
            reviews,
            contact,
            social,
            seo,
        } = self;
        Ok(Self {
            hero: Hero {
                headline: single_line("content.hero.headline", &hero.headline, 120)?,
                subheadline: single_line("content.hero.subheadline", &hero.subheadline, 240)?,
                cta_label: single_line("content.hero.cta_label", &hero.cta_label, 30)?,
            },
            about: About {
                title: single_line("content.about.title", &about.title, 120)?,
                body: paragraphs("content.about.body", &about.body, 2000)?,
                highlights: about
                    .highlights
                    .iter()
                    .map(|h| single_line("content.about.highlights", h, 80))
                    .filter(|h| h.as_ref().map_or(true, |h| !h.is_empty()))
                    .collect::<Result<_, _>>()?,
            },
            doctors: clean_doctors(doctors)?,
            services: clean_services(&services)?,
            reviews: clean_reviews(&reviews)?,
            contact: Contact {
                whatsapp: single_line("content.contact.whatsapp", &contact.whatsapp, 20)?,
                email: email("content.contact.email", &contact.email)?,
                map_url: link("content.contact.map_url", &contact.map_url)?,
                hours_note: single_line("content.contact.hours_note", &contact.hours_note, 200)?,
            },
            social: Social {
                instagram: link("content.social.instagram", &social.instagram)?,
                facebook: link("content.social.facebook", &social.facebook)?,
                youtube: link("content.social.youtube", &social.youtube)?,
            },
            seo: Seo {
                title: single_line("content.seo.title", &seo.title, 70)?,
                description: single_line("content.seo.description", &seo.description, 170)?,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_template_has_three_or_more_palettes_and_a_default() {
        assert!(TEMPLATES.len() >= 4);
        for template in TEMPLATES {
            assert!(template.palettes.len() >= 3, "{}", template.id);
        }
    }

    #[test]
    fn design_choices_are_checked_together() {
        assert!(check_design("aurora", "gold", "modern").is_ok());
        assert_eq!(
            check_design("nope", "gold", "modern").unwrap_err().field,
            "template"
        );
        // A palette of another design is refused.
        assert_eq!(
            check_design("aurora", "sky", "modern").unwrap_err().field,
            "palette"
        );
        assert_eq!(
            check_design("aurora", "gold", "comic").unwrap_err().field,
            "fonts"
        );
    }

    #[test]
    fn domains_are_cleaned_and_checked() {
        let ok = |text: &str| CustomDomain::parse(text).map(|d| d.as_str().to_owned());
        assert_eq!(ok(" HTTPS://WWW.Smile.in/ ").unwrap(), "www.smile.in");
        assert_eq!(ok("clinic.co.in.").unwrap(), "clinic.co.in");
        for bad in [
            "",
            "localhost",
            "a_b.in",
            "-a.in",
            "a-.in",
            "a..in",
            "1.2.3.4",
            "a.b c.in",
            "smile.in/path",
            "smile.in:8080",
            "user@smile.in",
            "https://",
        ] {
            assert!(CustomDomain::parse(bad).is_err(), "{bad}");
        }
        assert!(CustomDomain::parse(&format!("{}.in", "a".repeat(64))).is_err());
    }

    #[test]
    fn pictures_are_recognised_by_content() {
        assert_eq!(
            SiteImage::sniff(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some(SiteImage::Jpeg)
        );
        assert_eq!(
            SiteImage::sniff(b"\x89PNG\r\n\x1a\n...."),
            Some(SiteImage::Png)
        );
        assert_eq!(
            SiteImage::sniff(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(SiteImage::Webp)
        );
        assert_eq!(
            SiteImage::sniff(b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
            None
        );
        assert_eq!(SiteImage::sniff(b"%PDF-1.7 and more"), None);
    }

    #[test]
    fn content_is_cleaned() {
        let mut content = SiteContent::default();
        content.hero.headline = "  Gentle   care ".into();
        content.about.body = "One\r\n\r\n\r\n\r\nTwo\nThree".into();
        content.about.highlights = vec!["  ".into(), "Painless".into()];
        let cleaned = content.cleaned().unwrap();
        assert_eq!(cleaned.hero.headline, "Gentle care");
        assert_eq!(cleaned.about.body, "One\n\nTwo\nThree");
        assert_eq!(cleaned.about.highlights, vec!["Painless".to_owned()]);
    }

    #[test]
    fn content_refuses_bad_links_reviews_and_lengths() {
        let with = |f: fn(&mut SiteContent)| {
            let mut c = SiteContent::default();
            f(&mut c);
            c.cleaned().unwrap_err().field
        };
        assert_eq!(
            with(|c| c.contact.map_url = "javascript:alert(1)".into()),
            "content.contact.map_url"
        );
        assert_eq!(
            with(|c| c.contact.map_url = "http://maps.example".into()),
            "content.contact.map_url"
        );
        assert_eq!(
            with(|c| c.social.instagram = "https://x.in/\"onload=1".into()),
            "content.social.instagram"
        );
        assert_eq!(
            with(|c| c.contact.email = "a@b".into()),
            "content.contact.email"
        );
        assert_eq!(
            with(|c| c.hero.headline = "x".repeat(121)),
            "content.hero.headline"
        );
        assert_eq!(
            with(|c| c.hero.headline = "a\u{0}b".into()),
            "content.hero.headline"
        );
        assert_eq!(
            with(|c| c.reviews = vec![Review {
                name: "A".into(),
                rating: 6,
                text: "Good".into()
            }]),
            "content.reviews.rating"
        );
        assert_eq!(
            with(|c| c.reviews = vec![Review {
                name: String::new(),
                rating: 5,
                text: "Good".into()
            }]),
            "content.reviews"
        );
        assert_eq!(
            with(|c| c.reviews = (0..13)
                .map(|_| Review {
                    name: "A".into(),
                    rating: 5,
                    text: "Ok".into()
                })
                .collect()),
            "content.reviews"
        );
        assert_eq!(
            with(|c| c.doctors = vec![DoctorProfile {
                practitioner_id: "nope".into(),
                ..DoctorProfile::default()
            }]),
            "content.doctors.practitioner_id"
        );
        assert_eq!(
            with(|c| c.doctors = vec![
                DoctorProfile {
                    practitioner_id: "0190a1b2-0000-7000-8000-000000000001".into(),
                    ..DoctorProfile::default()
                },
                DoctorProfile {
                    practitioner_id: "0190A1B2-0000-7000-8000-000000000001".into(),
                    ..DoctorProfile::default()
                },
            ]),
            "content.doctors"
        );
    }
}
