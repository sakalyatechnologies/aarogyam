//! A clinic's public website: the owner's design and content, and the public page data built
//! from them and from the clinic's own records (name, doctors, price list, hours, address).
//!
//! Only public facts reach [`PublicSite`]: no patient data, no registration numbers, no
//! verification tokens. The owner edits with `settings.manage`; anyone may read the published
//! site on the clinic's host.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use aarogyam_dal::website::{self as dal, NewPhoto, PhotoRow, SiteRow};
use aarogyam_dal::{billing, clinic, schedule, settings};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{AttachmentId, ClinicId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::website::{
    CustomDomain, DomainStatus, Layout, MAX_PHOTO_BYTES, MAX_PHOTOS, PhotoKind, Seo, SiteContent,
    SiteImage, Social, TEMPLATES, WebsiteError, check_design,
};
use aws_lc_rs::{digest, rand};
use sakalya_db::{Db, ScopedTx};
use serde_json::Value;
use time::{OffsetDateTime, Time};
use uuid::Uuid;

use crate::error::AppError;
use crate::files::{Files, StorageKey};
use crate::patients::parse_phone;
use crate::scope::{public_scope, staff_scope};
use crate::self_booking::read_settings;

/// Price list categories that are goods, not services; they stay off the website.
const GOODS: [&str; 4] = ["medicine", "medicines", "product", "products"];

/// Most services listed on a website.
const MAX_SERVICES: usize = 120;

fn invalid(error: &WebsiteError) -> AppError {
    AppError::Invalid {
        field: error.field,
        message: error.message.to_owned(),
    }
}

/// The owner's settings.
#[derive(Debug, Clone)]
pub struct SiteSettings {
    /// One page or several.
    pub layout: Layout,
    /// The design.
    pub template: String,
    /// The colour palette.
    pub palette: String,
    /// The font pairing.
    pub fonts: String,
    /// The owner's text and choices.
    pub content: SiteContent,
    /// Whether the site is live.
    pub published: bool,
    /// When it last went live.
    pub published_at: Option<OffsetDateTime>,
    /// The clinic's own domain, if any.
    pub custom_domain: Option<String>,
    /// Where verification stands.
    pub domain_status: DomainStatus,
    /// The TXT record's value while a domain is set.
    pub domain_token: Option<String>,
    /// When the domain was last checked.
    pub domain_checked_at: Option<OffsetDateTime>,
}

impl SiteSettings {
    fn defaults() -> Self {
        let first = &TEMPLATES[0];
        Self {
            layout: Layout::One,
            template: first.id.to_owned(),
            palette: first.palettes[0].to_owned(),
            fonts: "modern".to_owned(),
            content: SiteContent::default(),
            published: false,
            published_at: None,
            custom_domain: None,
            domain_status: DomainStatus::None,
            domain_token: None,
            domain_checked_at: None,
        }
    }

    fn from_row(row: &SiteRow) -> Result<Self, AppError> {
        Ok(Self {
            layout: Layout::parse(&row.layout).map_err(|_| AppError::Internal("stored layout"))?,
            template: row.template.clone(),
            palette: row.palette.clone(),
            fonts: row.fonts.clone(),
            // Content that no longer parses (a design change between releases) shows as empty
            // rather than taking the site down.
            content: serde_json::from_value(row.content.clone()).unwrap_or_default(),
            published: row.published,
            published_at: row.published_at,
            custom_domain: row.custom_domain.clone(),
            domain_status: DomainStatus::parse(&row.domain_status)
                .map_err(|_| AppError::Internal("stored domain status"))?,
            domain_token: row.domain_token.clone(),
            domain_checked_at: row.domain_checked_at,
        })
    }

    fn to_row(&self) -> Result<SiteRow, AppError> {
        Ok(SiteRow {
            layout: self.layout.as_str().to_owned(),
            template: self.template.clone(),
            palette: self.palette.clone(),
            fonts: self.fonts.clone(),
            content: serde_json::to_value(&self.content)
                .map_err(|_| AppError::Internal("site content"))?,
            published: self.published,
            published_at: self.published_at,
            custom_domain: self.custom_domain.clone(),
            domain_status: self.domain_status.as_str().to_owned(),
            domain_token: self.domain_token.clone(),
            domain_checked_at: self.domain_checked_at,
        })
    }
}

/// Changes to the settings; `None` leaves a value as it is.
#[derive(Debug, Clone, Default)]
pub struct SiteChanges {
    /// `one` or `multi`.
    pub layout: Option<String>,
    /// The design.
    pub template: Option<String>,
    /// The palette; when the design changes and none is given, the design's first palette.
    pub palette: Option<String>,
    /// The font pairing.
    pub fonts: Option<String>,
    /// All the content, replacing what is stored.
    pub content: Option<SiteContent>,
    /// Publish or take down.
    pub published: Option<bool>,
    /// The clinic's own domain; empty removes it.
    pub custom_domain: Option<String>,
}

/// A picture as the API shows it.
#[derive(Debug, Clone)]
pub struct PhotoView {
    /// Identifier.
    pub id: Uuid,
    /// What it is for.
    pub kind: PhotoKind,
    /// A path on the clinic's host that serves the picture.
    pub url: String,
    /// What it shows.
    pub alt: Option<String>,
}

fn photo_view(row: &PhotoRow) -> Option<PhotoView> {
    Some(PhotoView {
        id: row.id,
        kind: PhotoKind::parse(&row.kind).ok()?,
        url: format!("/api/v1/public/site/photos/{}", row.id),
        alt: row.alt.clone(),
    })
}

/// The clinic's address.
#[derive(Debug, Clone, Default)]
pub struct PublicAddress {
    /// House, building and street.
    pub line1: Option<String>,
    /// Area or landmark.
    pub line2: Option<String>,
    /// City or town.
    pub city: Option<String>,
    /// State.
    pub state: Option<String>,
    /// PIN code.
    pub pincode: Option<String>,
}

/// Who the clinic is and how to reach it.
#[derive(Debug, Clone)]
pub struct ClinicInfo {
    /// Display name.
    pub name: String,
    /// The clinic's own brand colour from Settings, if set.
    pub brand: Option<String>,
    /// Address.
    pub address: PublicAddress,
    /// Phone in `E.164`.
    pub phone: Option<String>,
    /// `WhatsApp` number in `E.164`.
    pub whatsapp: Option<String>,
    /// Public email.
    pub email: Option<String>,
    /// A map link.
    pub map_url: Option<String>,
}

/// Opening hours of one weekday.
#[derive(Debug, Clone)]
pub struct DayHours {
    /// 1 Monday to 7 Sunday.
    pub weekday: i16,
    /// Open spans as `HH:MM`, start and end.
    pub spans: Vec<(String, String)>,
}

/// A doctor on the website.
#[derive(Debug, Clone)]
pub struct PublicDoctor {
    /// The doctor.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Specialty.
    pub specialty: Option<String>,
    /// Degrees and training.
    pub qualifications: Option<String>,
    /// Introduction.
    pub bio: Option<String>,
    /// A portrait.
    pub photo: Option<PhotoView>,
}

/// A service on the website.
#[derive(Debug, Clone)]
pub struct PublicService {
    /// The price list entry.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Category key.
    pub category: Option<String>,
    /// Fee in paise; `None` when the clinic hides fees.
    pub fee_paise: Option<i64>,
    /// A sentence about it.
    pub description: Option<String>,
}

/// Pictures by use.
#[derive(Debug, Clone, Default)]
pub struct PublicPhotos {
    /// The logo.
    pub logo: Option<PhotoView>,
    /// The top picture.
    pub hero: Option<PhotoView>,
    /// The about picture.
    pub about: Option<PhotoView>,
    /// The gallery, in order.
    pub gallery: Vec<PhotoView>,
}

/// Everything a clinic website shows, and only that.
#[derive(Debug, Clone)]
pub struct PublicSite {
    /// One page or several.
    pub layout: Layout,
    /// The design.
    pub template: String,
    /// The palette.
    pub palette: String,
    /// The font pairing.
    pub fonts: String,
    /// The clinic.
    pub clinic: ClinicInfo,
    /// Opening hours, Monday first; days without hours are left out.
    pub hours: Vec<DayHours>,
    /// A note under the hours.
    pub hours_note: Option<String>,
    /// The top of the home page.
    pub hero: aarogyam_domain::website::Hero,
    /// About the clinic.
    pub about: aarogyam_domain::website::About,
    /// Doctors.
    pub doctors: Vec<PublicDoctor>,
    /// A line above the services.
    pub services_intro: Option<String>,
    /// Services.
    pub services: Vec<PublicService>,
    /// Reviews the clinic chose to show.
    pub reviews: Vec<aarogyam_domain::website::Review>,
    /// Pictures.
    pub photos: PublicPhotos,
    /// Profile links.
    pub social: Social,
    /// Search engine text; empty parts are filled by the page.
    pub seo: Seo,
    /// Whether patients may book online.
    pub booking_enabled: bool,
}

/// A doctor or service the owner may choose to show.
#[derive(Debug, Clone)]
pub struct Candidate {
    /// Identifier.
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Specialty or category.
    pub detail: Option<String>,
    /// Fee in paise (services).
    pub fee_paise: Option<i64>,
}

/// What the owner sees in the editor.
#[derive(Debug, Clone)]
pub struct WebsiteView {
    /// The clinic's slug, for its free address.
    pub slug: String,
    /// The settings.
    pub settings: SiteSettings,
    /// Every picture.
    pub photos: Vec<PhotoView>,
    /// The site as it would show now, published or not.
    pub preview: PublicSite,
    /// Doctors the owner may show or hide.
    pub doctors: Vec<Candidate>,
    /// Services the owner may show or hide.
    pub services: Vec<Candidate>,
}

fn clock(time: Time) -> String {
    format!("{:02}:{:02}", time.hour(), time.minute())
}

/// Merges every doctor's shifts into the clinic's open spans for each weekday.
fn opening_hours(shifts: &[schedule::ShiftRow], active: &[Uuid]) -> Vec<DayHours> {
    let mut days: BTreeMap<i16, Vec<(Time, Time)>> = BTreeMap::new();
    for shift in shifts
        .iter()
        .filter(|s| active.contains(&s.practitioner_id))
    {
        days.entry(shift.weekday)
            .or_default()
            .push((shift.starts, shift.ends));
    }
    days.into_iter()
        .map(|(weekday, mut spans)| {
            spans.sort();
            let mut merged: Vec<(Time, Time)> = Vec::new();
            for (start, end) in spans {
                match merged.last_mut() {
                    Some(last) if start <= last.1 => last.1 = last.1.max(end),
                    _ => merged.push((start, end)),
                }
            }
            DayHours {
                weekday,
                spans: merged
                    .into_iter()
                    .map(|(s, e)| (clock(s), clock(e)))
                    .collect(),
            }
        })
        .collect()
}

fn some(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_owned())
}

/// Doctors to show, doctors the owner may choose from, and the clinic's opening hours.
async fn doctors_and_hours(
    tx: &mut ScopedTx,
    content: &SiteContent,
    photo_views: &[PhotoView],
) -> Result<(Vec<PublicDoctor>, Vec<Candidate>, Vec<DayHours>), AppError> {
    let practitioners = schedule::practitioners(tx.conn()).await?;
    let shifts = schedule::shifts(tx.conn(), None, None).await?;
    let active: Vec<Uuid> = practitioners
        .iter()
        .filter(|p| p.active)
        .map(|p| p.id)
        .collect();
    let mut doctors = Vec::new();
    let mut doctor_candidates = Vec::new();
    for row in practitioners.iter().filter(|p| p.active) {
        let profile = content
            .doctors
            .iter()
            .find(|d| d.practitioner_id == row.id.to_string());
        doctor_candidates.push(Candidate {
            id: row.id,
            name: row.display_name.clone(),
            detail: row.specialty.clone(),
            fee_paise: None,
        });
        if profile.is_some_and(|p| p.hidden) {
            continue;
        }
        doctors.push(PublicDoctor {
            id: row.id,
            name: row.display_name.clone(),
            specialty: row.specialty.clone(),
            qualifications: profile.and_then(|p| some(&p.qualifications)),
            bio: profile.and_then(|p| some(&p.bio)),
            photo: profile
                .and_then(|p| p.photo_id.as_deref())
                .and_then(|id| photo_views.iter().find(|v| v.id.to_string() == id))
                .cloned(),
        });
    }

    Ok((doctors, doctor_candidates, opening_hours(&shifts, &active)))
}

/// Services to show, and every service the owner may choose from.
async fn services(
    tx: &mut ScopedTx,
    content: &SiteContent,
) -> Result<(Vec<PublicService>, Vec<Candidate>), AppError> {
    let show_fees = content.services.show_fees;
    let mut services = Vec::new();
    let mut service_candidates = Vec::new();
    for row in billing::price_items(tx.conn()).await? {
        let goods = row.category.as_deref().is_some_and(|c| GOODS.contains(&c));
        if !row.active || goods {
            continue;
        }
        service_candidates.push(Candidate {
            id: row.id,
            name: row.name.clone(),
            detail: row.category.clone(),
            fee_paise: Some(row.price_paise),
        });
        let id_text = row.id.to_string();
        if content.services.hidden.contains(&id_text) || services.len() >= MAX_SERVICES {
            continue;
        }
        services.push(PublicService {
            id: row.id,
            name: row.name,
            category: row.category,
            fee_paise: show_fees.then_some(row.price_paise),
            description: content
                .services
                .notes
                .iter()
                .find(|n| n.price_item_id == id_text)
                .and_then(|n| some(&n.description)),
        });
    }

    Ok((services, service_candidates))
}

async fn assemble(
    tx: &mut ScopedTx,
    settings: &SiteSettings,
) -> Result<(PublicSite, Vec<PhotoView>, Vec<Candidate>, Vec<Candidate>), AppError> {
    let profile = clinic::profile(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let stored = settings::get(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let booking = read_settings(&stored.booking);
    let rows = dal::photos(tx.conn()).await?;
    let photo_views: Vec<PhotoView> = rows.iter().filter_map(photo_view).collect();
    let content = &settings.content;

    let mut photos = PublicPhotos::default();
    for view in &photo_views {
        match view.kind {
            PhotoKind::Logo => photos.logo = Some(view.clone()),
            PhotoKind::Hero => photos.hero = Some(view.clone()),
            PhotoKind::About => photos.about = Some(view.clone()),
            PhotoKind::Gallery => photos.gallery.push(view.clone()),
            PhotoKind::Doctor => {}
        }
    }

    let (doctors, doctor_candidates, hours) = doctors_and_hours(tx, content, &photo_views).await?;
    let (services, service_candidates) = services(tx, content).await?;

    let address = stored.address.as_ref();
    let part = |key: &str| {
        address
            .and_then(|a| a.get(key))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(str::to_owned)
    };
    let brand = profile
        .branding
        .get("brand")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let whatsapp = parse_phone(&content.contact.whatsapp)
        .ok()
        .flatten()
        .map(|p| p.as_e164().to_owned());
    let site = PublicSite {
        layout: settings.layout,
        template: settings.template.clone(),
        palette: settings.palette.clone(),
        fonts: settings.fonts.clone(),
        clinic: ClinicInfo {
            name: profile.name,
            brand,
            address: PublicAddress {
                line1: part("line1"),
                line2: part("line2"),
                city: part("city"),
                state: part("state"),
                pincode: part("pincode"),
            },
            phone: stored.phone_e164,
            whatsapp,
            email: some(&content.contact.email),
            map_url: some(&content.contact.map_url),
        },
        hours,
        hours_note: some(&content.contact.hours_note),
        hero: content.hero.clone(),
        about: content.about.clone(),
        doctors,
        services_intro: some(&content.services.intro),
        services,
        reviews: content.reviews.clone(),
        photos,
        social: content.social.clone(),
        seo: content.seo.clone(),
        booking_enabled: booking.enabled,
    };
    Ok((site, photo_views, doctor_candidates, service_candidates))
}

async fn view_in(tx: &mut ScopedTx) -> Result<WebsiteView, AppError> {
    let settings = match dal::get(tx.conn()).await? {
        Some(row) => SiteSettings::from_row(&row)?,
        None => SiteSettings::defaults(),
    };
    let (preview, photos, doctors, services) = assemble(tx, &settings).await?;
    let slug = clinic::profile(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?
        .slug;
    Ok(WebsiteView {
        slug,
        settings,
        photos,
        preview,
        doctors,
        services,
    })
}

/// The owner's view of the website: settings, pictures and a preview of the page.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Db`] on database failures.
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<WebsiteView, AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        view_in(tx).await
    })
    .await
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            // Writing to a String can't fail.
            let _ = write!(out, "{byte:02x}");
            out
        })
}

fn verification_token() -> Result<String, AppError> {
    let mut bytes = [0_u8; 12];
    rand::fill(&mut bytes).map_err(|_| AppError::Internal("random number generator failed"))?;
    Ok(format!("aarogyam-verify-{}", hex(&bytes)))
}

/// Checks what the content points at (doctors, portraits) and puts the `WhatsApp` number in
/// `E.164`.
async fn check_references(tx: &mut ScopedTx, content: &mut SiteContent) -> Result<(), AppError> {
    content.contact.whatsapp = parse_phone(&content.contact.whatsapp)
        .map_err(|_| AppError::invalid("content.contact.whatsapp", "is not a valid phone number"))?
        .map_or_else(String::new, |p| p.as_e164().to_owned());
    if content.doctors.is_empty() {
        return Ok(());
    }
    let doctors: Vec<Uuid> = schedule::practitioners(tx.conn())
        .await?
        .into_iter()
        .map(|p| p.id)
        .collect();
    let photos = dal::photos(tx.conn()).await?;
    for profile in &content.doctors {
        if !doctors
            .iter()
            .any(|id| id.to_string() == profile.practitioner_id)
        {
            return Err(AppError::invalid(
                "content.doctors",
                "lists someone who is not a doctor of this clinic",
            ));
        }
        if let Some(photo) = &profile.photo_id
            && !photos
                .iter()
                .any(|p| p.kind == "doctor" && p.id.to_string() == *photo)
        {
            return Err(AppError::invalid(
                "content.doctors.photo_id",
                "is not a doctor picture of this clinic",
            ));
        }
    }
    Ok(())
}

fn apply_design(settings: &mut SiteSettings, changes: &SiteChanges) -> Result<(), AppError> {
    if let Some(layout) = &changes.layout {
        settings.layout = Layout::parse(layout)
            .map_err(|_| AppError::invalid("layout", "must be one or multi"))?;
    }
    if let Some(template) = &changes.template
        && *template != settings.template
    {
        template.clone_into(&mut settings.template);
        // The old palette belongs to the old design.
        if let Some(first) = TEMPLATES.iter().find(|t| t.id == template.as_str()) {
            first.palettes[0].clone_into(&mut settings.palette);
        }
    }
    if let Some(palette) = &changes.palette {
        palette.clone_into(&mut settings.palette);
    }
    if let Some(fonts) = &changes.fonts {
        fonts.clone_into(&mut settings.fonts);
    }
    check_design(&settings.template, &settings.palette, &settings.fonts).map_err(|e| invalid(&e))
}

fn apply_domain(settings: &mut SiteSettings, domain: &str) -> Result<(), AppError> {
    if domain.trim().is_empty() {
        settings.custom_domain = None;
        settings.domain_status = DomainStatus::None;
        settings.domain_token = None;
        settings.domain_checked_at = None;
        return Ok(());
    }
    let parsed = CustomDomain::parse(domain).map_err(|e| invalid(&e))?;
    if settings.custom_domain.as_deref() != Some(parsed.as_str()) {
        settings.custom_domain = Some(parsed.as_str().to_owned());
        settings.domain_status = DomainStatus::Pending;
        settings.domain_token = Some(verification_token()?);
        settings.domain_checked_at = None;
    }
    Ok(())
}

/// Changes the website's design, content, published state or domain.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] naming the first bad
/// field; [`AppError::Db`] on database failures.
pub async fn update(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    changes: SiteChanges,
) -> Result<WebsiteView, AppError> {
    actor.require(Permission::SettingsManage)?;
    let content = changes
        .content
        .clone()
        .map(|c| c.cleaned().map_err(|e| invalid(&e)))
        .transpose()?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        let mut settings = SiteSettings::from_row(&dal::get_for_update(tx.conn()).await?)?;
        apply_design(&mut settings, &changes)?;
        if let Some(mut content) = content.clone() {
            check_references(tx, &mut content).await?;
            settings.content = content;
        }
        if let Some(domain) = &changes.custom_domain {
            apply_domain(&mut settings, domain)?;
        }
        if let Some(published) = changes.published {
            if published && !settings.published {
                settings.published_at = Some(OffsetDateTime::now_utc());
            }
            settings.published = published;
        }
        dal::save(tx.conn(), &settings.to_row()?).await?;
        view_in(tx).await
    })
    .await
}

/// A picture as received.
#[derive(Debug, Clone, Default)]
pub struct PhotoUpload {
    /// The bytes.
    pub bytes: Vec<u8>,
    /// `logo`, `hero`, `about`, `doctor` or `gallery` (default).
    pub kind: Option<String>,
    /// What it shows.
    pub alt: Option<String>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(digest::digest(&digest::SHA256, bytes).as_ref())
}

fn alt_text(text: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(text) = text else { return Ok(None) };
    if text.chars().any(char::is_control) {
        return Err(AppError::invalid(
            "alt",
            "must not contain control characters",
        ));
    }
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() > 200 {
        return Err(AppError::invalid("alt", "must be at most 200 characters"));
    }
    Ok((!clean.is_empty()).then_some(clean))
}

/// Stores a website picture. A logo, hero or about picture replaces the one before it. The
/// type comes from the bytes: JPEG, PNG or WebP, up to 5 MB.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::Invalid`] for an empty, large or
/// unrecognised file or when the clinic has too many pictures.
pub async fn upload_photo(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: PhotoUpload,
) -> Result<PhotoView, AppError> {
    actor.require(Permission::SettingsManage)?;
    if input.bytes.is_empty() || input.bytes.len() > MAX_PHOTO_BYTES {
        return Err(AppError::invalid("file", "must be 1 byte to 5 MB"));
    }
    let image = SiteImage::sniff(&input.bytes)
        .ok_or_else(|| AppError::invalid("file", "must be a JPEG, PNG or WebP picture"))?;
    let kind = match input.kind.as_deref() {
        Some(text) => PhotoKind::parse(text).map_err(|e| AppError::invalid("kind", e))?,
        None => PhotoKind::Gallery,
    };
    let alt = alt_text(input.alt.as_deref())?;
    let size = i64::try_from(input.bytes.len()).map_err(|_| AppError::Internal("file size"))?;
    let id = Uuid::now_v7();
    let key = StorageKey::new(actor.clinic_id, AttachmentId::from_uuid(id));
    let mut replaced = Vec::new();
    let stored = db
        .scoped(&staff_scope(actor, request_id), async |tx| {
            if kind.is_single() {
                replaced = dal::delete_kind(tx.conn(), kind.as_str()).await?;
            }
            let held = usize::try_from(dal::count_photos(tx.conn()).await?).unwrap_or(usize::MAX);
            if held >= MAX_PHOTOS {
                return Err(AppError::invalid(
                    "file",
                    "the clinic has too many pictures",
                ));
            }
            files
                .storage()
                .put(key, &input.bytes)
                .await
                .map_err(|_| AppError::Internal("could not store the picture"))?;
            dal::insert_photo(
                tx.conn(),
                &NewPhoto {
                    id,
                    kind: kind.as_str(),
                    storage_key: &key.to_string(),
                    mime_type: image.mime_type(),
                    size_bytes: size,
                    sha256: &sha256_hex(&input.bytes),
                    alt: alt.as_deref(),
                },
            )
            .await?;
            let row = dal::photo(tx.conn(), id)
                .await?
                .ok_or(AppError::Internal("picture not saved"))?;
            photo_view(&row).ok_or(AppError::Internal("stored picture kind"))
        })
        .await;
    match &stored {
        Ok(_) => {
            for old in replaced {
                let _ = files
                    .storage()
                    .delete(StorageKey::new(
                        actor.clinic_id,
                        AttachmentId::from_uuid(old),
                    ))
                    .await;
            }
        }
        // Nothing points at the bytes; a failed clean-up only leaves an orphan file.
        Err(_) => {
            let _ = files.storage().delete(key).await;
        }
    }
    stored
}

/// Changes a picture's description.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::NotFound`] for another clinic's
/// or a missing picture.
pub async fn describe_photo(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
    alt: Option<&str>,
) -> Result<PhotoView, AppError> {
    actor.require(Permission::SettingsManage)?;
    let alt = alt_text(alt)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        if !dal::set_alt(tx.conn(), id, alt.as_deref()).await? {
            return Err(AppError::NotFound("picture"));
        }
        let row = dal::photo(tx.conn(), id)
            .await?
            .ok_or(AppError::NotFound("picture"))?;
        photo_view(&row).ok_or(AppError::Internal("stored picture kind"))
    })
    .await
}

/// Removes a picture. Doctor profiles that used it lose their portrait.
///
/// # Errors
/// [`AppError::Denied`] without `settings.manage`; [`AppError::NotFound`] for another clinic's
/// or a missing picture.
pub async fn delete_photo(
    db: &Db,
    files: &Files,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<(), AppError> {
    actor.require(Permission::SettingsManage)?;
    db.scoped(&staff_scope(actor, request_id), async |tx| {
        if !dal::delete_photo(tx.conn(), id).await? {
            return Err(AppError::NotFound("picture"));
        }
        let mut settings = SiteSettings::from_row(&dal::get_for_update(tx.conn()).await?)?;
        let text = id.to_string();
        let mut changed = false;
        for doctor in &mut settings.content.doctors {
            if doctor.photo_id.as_deref() == Some(text.as_str()) {
                doctor.photo_id = None;
                changed = true;
            }
        }
        if changed {
            dal::save(tx.conn(), &settings.to_row()?).await?;
        }
        Ok(())
    })
    .await?;
    let _ = files
        .storage()
        .delete(StorageKey::new(
            actor.clinic_id,
            AttachmentId::from_uuid(id),
        ))
        .await;
    Ok(())
}

/// The published site of a clinic, for anyone on its host; `None` while it is not published.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn public_site(
    db: &Db,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
) -> Result<Option<PublicSite>, AppError> {
    db.scoped(&public_scope(clinic_id, request_id), async |tx| {
        let Some(row) = dal::get(tx.conn()).await? else {
            return Ok(None);
        };
        if !row.published {
            return Ok(None);
        }
        let settings = SiteSettings::from_row(&row)?;
        Ok(Some(assemble(tx, &settings).await?.0))
    })
    .await
}

/// A picture's bytes and type.
#[derive(Debug, Clone)]
pub struct PhotoBytes {
    /// The type.
    pub image: SiteImage,
    /// The content.
    pub bytes: Vec<u8>,
}

/// A picture of the clinic, for anyone on its host. Pictures are public once uploaded: the
/// owner's preview shows them before the site is published.
///
/// # Errors
/// [`AppError::NotFound`] for a picture that is not this clinic's.
pub async fn public_photo(
    db: &Db,
    files: &Files,
    clinic_id: ClinicId,
    request_id: Option<Uuid>,
    id: Uuid,
) -> Result<PhotoBytes, AppError> {
    let row = db
        .scoped(&public_scope(clinic_id, request_id), async |tx| {
            dal::photo(tx.conn(), id)
                .await?
                .ok_or(AppError::NotFound("picture"))
        })
        .await?;
    let image =
        SiteImage::from_mime_type(&row.mime_type).ok_or(AppError::Internal("stored type"))?;
    let bytes = files
        .storage()
        .get(StorageKey::new(clinic_id, AttachmentId::from_uuid(id)))
        .await
        .map_err(|_| AppError::Internal("could not read the picture"))?;
    Ok(PhotoBytes { image, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shift(weekday: i16, doctor: Uuid, from: (u8, u8), to: (u8, u8)) -> schedule::ShiftRow {
        schedule::ShiftRow {
            practitioner_id: doctor,
            branch_id: Uuid::nil(),
            weekday,
            starts: Time::from_hms(from.0, from.1, 0).unwrap(),
            ends: Time::from_hms(to.0, to.1, 0).unwrap(),
        }
    }

    #[test]
    fn hours_merge_overlapping_shifts_and_skip_inactive_doctors() {
        let (a, b, gone) = (Uuid::from_u128(1), Uuid::from_u128(2), Uuid::from_u128(3));
        let shifts = vec![
            shift(1, a, (9, 0), (13, 0)),
            shift(1, b, (12, 0), (14, 0)),
            shift(1, a, (17, 0), (20, 0)),
            shift(2, gone, (8, 0), (9, 0)),
            shift(3, b, (10, 0), (11, 30)),
        ];
        let hours = opening_hours(&shifts, &[a, b]);
        assert_eq!(hours.len(), 2);
        assert_eq!(
            hours[0].spans,
            vec![
                ("09:00".to_owned(), "14:00".to_owned()),
                ("17:00".to_owned(), "20:00".to_owned())
            ]
        );
        assert_eq!(hours[1].weekday, 3);
        assert_eq!(
            hours[1].spans,
            vec![("10:00".to_owned(), "11:30".to_owned())]
        );
    }

    #[test]
    fn a_new_design_resets_the_palette_and_checks_the_pair() {
        let mut settings = SiteSettings::defaults();
        let changes = SiteChanges {
            template: Some("hearth".into()),
            ..SiteChanges::default()
        };
        apply_design(&mut settings, &changes).unwrap();
        assert_eq!(settings.palette, "terracotta");
        let bad = SiteChanges {
            palette: Some("gold".into()),
            ..SiteChanges::default()
        };
        assert!(apply_design(&mut settings, &bad).is_err());
    }

    #[test]
    fn a_new_domain_starts_pending_with_a_token_and_clearing_resets() {
        let mut settings = SiteSettings::defaults();
        apply_domain(&mut settings, "HTTPS://Smile.in/").unwrap();
        assert_eq!(settings.custom_domain.as_deref(), Some("smile.in"));
        assert_eq!(settings.domain_status, DomainStatus::Pending);
        let token = settings.domain_token.clone().unwrap();
        assert!(token.starts_with("aarogyam-verify-"));
        // The same domain again keeps the token.
        apply_domain(&mut settings, "smile.in").unwrap();
        assert_eq!(settings.domain_token.as_deref(), Some(token.as_str()));
        apply_domain(&mut settings, "").unwrap();
        assert_eq!(settings.domain_status, DomainStatus::None);
        assert!(settings.domain_token.is_none());
        assert!(apply_domain(&mut settings, "not a domain").is_err());
    }
}
