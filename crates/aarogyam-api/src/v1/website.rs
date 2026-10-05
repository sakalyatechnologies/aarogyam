//! The clinic's website: the owner edits it in Settings (`settings.manage`); the published site
//! and its pictures are public on the clinic's host and hold no patient data.

use aarogyam_app::website::{
    self as app, Candidate, PhotoUpload, PhotoView, PublicSite, SiteChanges, WebsiteView,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::SettingsManage;
use aarogyam_domain::website::{FONTS, MAX_PHOTO_BYTES, SiteContent, TEMPLATES};
use axum::Json;
use axum::extract::State;
use axum::extract::multipart::{Multipart, MultipartError, MultipartRejection};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::{ApiError, ApiJson, ApiPath, ErrorKind};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::rfc3339;
use crate::AppState;
use crate::extract::{ClinicHost, Require};
use crate::failure::{ApiFailure, not_found};

/// The top of the home page.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteHero {
    /// The main line.
    pub headline: String,
    /// A line under it.
    pub subheadline: String,
    /// The booking button's label.
    pub cta_label: String,
}

/// About the clinic.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteAbout {
    /// Section title.
    pub title: String,
    /// A few paragraphs, separated by blank lines.
    pub body: String,
    /// Up to six short points.
    pub highlights: Vec<String>,
}

/// What the owner adds to a doctor the clinic already has.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteDoctorProfile {
    /// The doctor.
    pub practitioner_id: String,
    /// Degrees and training.
    pub qualifications: String,
    /// A short introduction.
    pub bio: String,
    /// A doctor portrait uploaded to the website.
    pub photo_id: Option<String>,
    /// Leave the doctor off the website.
    pub hidden: bool,
}

/// A sentence about one service.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteServiceNote {
    /// The price list entry.
    pub price_item_id: String,
    /// What the patient should know.
    pub description: String,
}

/// Services and fees.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteServices {
    /// A line above the list.
    pub intro: String,
    /// Whether fees are shown.
    pub show_fees: bool,
    /// Price list entries left off the website.
    pub hidden: Vec<String>,
    /// Sentences about services.
    pub notes: Vec<SiteServiceNote>,
}

impl Default for SiteServices {
    fn default() -> Self {
        Self {
            intro: String::new(),
            show_fees: true,
            hidden: Vec::new(),
            notes: Vec::new(),
        }
    }
}

/// A review the clinic chose to show.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteReview {
    /// Who wrote it.
    pub name: String,
    /// 1 to 5.
    pub rating: u8,
    /// What they said.
    pub text: String,
}

/// Contact details beyond the branch's phone and address.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteContact {
    /// `WhatsApp` number; +91 is assumed without a country code.
    pub whatsapp: String,
    /// Public email address.
    pub email: String,
    /// A `https://` link to the clinic on a map.
    pub map_url: String,
    /// A note under the opening hours.
    pub hours_note: String,
}

/// Links to the clinic's profiles.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteSocial {
    /// An `https://` link.
    pub instagram: String,
    /// An `https://` link.
    pub facebook: String,
    /// An `https://` link.
    pub youtube: String,
}

/// What search engines show.
#[derive(Debug, Default, Clone, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct SiteSeo {
    /// Page title, up to 70 characters.
    pub title: String,
    /// Description, up to 170 characters.
    pub description: String,
}

/// Everything the owner writes. Every part is optional.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct WebsiteContent {
    /// The top of the home page.
    pub hero: SiteHero,
    /// About the clinic.
    pub about: SiteAbout,
    /// Doctor introductions.
    pub doctors: Vec<SiteDoctorProfile>,
    /// Services and fees.
    pub services: SiteServices,
    /// Reviews, up to 12.
    pub reviews: Vec<SiteReview>,
    /// Contact details.
    pub contact: SiteContact,
    /// Social links.
    pub social: SiteSocial,
    /// Search engine text.
    pub seo: SiteSeo,
}

fn convert<A: Serialize, B: for<'de> Deserialize<'de>>(from: &A) -> Result<B, ApiFailure> {
    serde_json::to_value(from)
        .and_then(serde_json::from_value)
        .map_err(|_| ApiFailure(ApiError::internal("could not convert website content")))
}

/// A website picture.
#[derive(Debug, Serialize, ToSchema)]
pub struct SitePhoto {
    /// The picture.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// `logo`, `hero`, `about`, `doctor` or `gallery`.
    pub kind: String,
    /// Where to load it from, on the clinic's host.
    pub url: String,
    /// What it shows.
    pub alt: Option<String>,
}

impl From<&PhotoView> for SitePhoto {
    fn from(view: &PhotoView) -> Self {
        Self {
            id: view.id,
            kind: view.kind.as_str().to_owned(),
            url: view.url.clone(),
            alt: view.alt.clone(),
        }
    }
}

/// The clinic's address.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteAddress {
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
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteClinic {
    /// Display name.
    pub name: String,
    /// The clinic's brand colour, `#RRGGBB`, if set.
    pub brand: Option<String>,
    /// Address.
    pub address: SiteAddress,
    /// Phone, `E.164`.
    pub phone: Option<String>,
    /// `WhatsApp` number, `E.164`.
    pub whatsapp: Option<String>,
    /// Public email address.
    pub email: Option<String>,
    /// A map link.
    pub map_url: Option<String>,
}

/// Opening hours of one weekday.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteDay {
    /// 1 Monday to 7 Sunday.
    pub weekday: i16,
    /// Open spans: `[start, end]` as `HH:MM`.
    pub spans: Vec<[String; 2]>,
}

/// A doctor on the website.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteDoctor {
    /// The doctor.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// What they practise.
    pub specialty: Option<String>,
    /// Degrees and training.
    pub qualifications: Option<String>,
    /// Introduction.
    pub bio: Option<String>,
    /// Portrait.
    pub photo: Option<SitePhoto>,
}

/// A service on the website.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteService {
    /// The price list entry.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Category key, such as `restorative`.
    pub category: Option<String>,
    /// Fee in paise; absent when the clinic hides fees.
    pub fee_paise: Option<i64>,
    /// A sentence about it.
    pub description: Option<String>,
}

/// Pictures by use.
#[derive(Debug, Serialize, ToSchema)]
pub struct SitePhotos {
    /// The logo.
    pub logo: Option<SitePhoto>,
    /// The top picture.
    pub hero: Option<SitePhoto>,
    /// The about picture.
    pub about: Option<SitePhoto>,
    /// The gallery, in order.
    pub gallery: Vec<SitePhoto>,
}

/// The design the clinic chose.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteDesign {
    /// `one` or `multi`.
    pub layout: String,
    /// `aurora`, `hearth`, `clinical` or `bold`.
    pub template: String,
    /// One of the template's palettes.
    pub palette: String,
    /// One of the font pairings.
    pub fonts: String,
}

/// What a clinic website shows, and only that: no patient data, no registration numbers.
#[derive(Debug, Serialize, ToSchema)]
pub struct SitePage {
    /// The design.
    pub design: SiteDesign,
    /// The clinic.
    pub clinic: SiteClinic,
    /// Opening hours; days without hours are left out.
    pub hours: Vec<SiteDay>,
    /// A note under the hours.
    pub hours_note: Option<String>,
    /// The top of the home page.
    pub hero: SiteHero,
    /// About the clinic.
    pub about: SiteAbout,
    /// Doctors.
    pub doctors: Vec<SiteDoctor>,
    /// A line above the services.
    pub services_intro: Option<String>,
    /// Services.
    pub services: Vec<SiteService>,
    /// Reviews the clinic chose to show.
    pub reviews: Vec<SiteReview>,
    /// Pictures.
    pub photos: SitePhotos,
    /// Profile links.
    pub social: SiteSocial,
    /// Search engine text; empty parts are filled by the page.
    pub seo: SiteSeo,
    /// Whether patients may book online.
    pub booking_enabled: bool,
}

impl TryFrom<&PublicSite> for SitePage {
    type Error = ApiFailure;

    fn try_from(site: &PublicSite) -> Result<Self, ApiFailure> {
        let photo = |p: &PhotoView| SitePhoto::from(p);
        Ok(Self {
            design: SiteDesign {
                layout: site.layout.as_str().to_owned(),
                template: site.template.clone(),
                palette: site.palette.clone(),
                fonts: site.fonts.clone(),
            },
            clinic: SiteClinic {
                name: site.clinic.name.clone(),
                brand: site.clinic.brand.clone(),
                address: SiteAddress {
                    line1: site.clinic.address.line1.clone(),
                    line2: site.clinic.address.line2.clone(),
                    city: site.clinic.address.city.clone(),
                    state: site.clinic.address.state.clone(),
                    pincode: site.clinic.address.pincode.clone(),
                },
                phone: site.clinic.phone.clone(),
                whatsapp: site.clinic.whatsapp.clone(),
                email: site.clinic.email.clone(),
                map_url: site.clinic.map_url.clone(),
            },
            hours: site
                .hours
                .iter()
                .map(|d| SiteDay {
                    weekday: d.weekday,
                    spans: d
                        .spans
                        .iter()
                        .map(|(a, b)| [a.clone(), b.clone()])
                        .collect(),
                })
                .collect(),
            hours_note: site.hours_note.clone(),
            hero: convert(&site.hero)?,
            about: convert(&site.about)?,
            doctors: site
                .doctors
                .iter()
                .map(|d| SiteDoctor {
                    id: d.id,
                    name: d.name.clone(),
                    specialty: d.specialty.clone(),
                    qualifications: d.qualifications.clone(),
                    bio: d.bio.clone(),
                    photo: d.photo.as_ref().map(photo),
                })
                .collect(),
            services_intro: site.services_intro.clone(),
            services: site
                .services
                .iter()
                .map(|s| SiteService {
                    id: s.id,
                    name: s.name.clone(),
                    category: s.category.clone(),
                    fee_paise: s.fee_paise,
                    description: s.description.clone(),
                })
                .collect(),
            reviews: convert(&site.reviews)?,
            photos: SitePhotos {
                logo: site.photos.logo.as_ref().map(photo),
                hero: site.photos.hero.as_ref().map(photo),
                about: site.photos.about.as_ref().map(photo),
                gallery: site.photos.gallery.iter().map(photo).collect(),
            },
            social: convert(&site.social)?,
            seo: convert(&site.seo)?,
            booking_enabled: site.booking_enabled,
        })
    }
}

/// A doctor or service the owner may show or hide.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteChoice {
    /// Identifier.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// Name.
    pub name: String,
    /// Specialty (doctors) or category (services).
    pub detail: Option<String>,
    /// Fee in paise (services).
    pub fee_paise: Option<i64>,
}

impl From<&Candidate> for SiteChoice {
    fn from(c: &Candidate) -> Self {
        Self {
            id: c.id,
            name: c.name.clone(),
            detail: c.detail.clone(),
            fee_paise: c.fee_paise,
        }
    }
}

/// A design the owner may choose.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteTemplate {
    /// Identifier.
    pub id: String,
    /// Its palettes; the first is the default.
    pub palettes: Vec<String>,
}

/// Where the clinic's own domain verification stands, with what to show the owner.
#[derive(Debug, Serialize, ToSchema)]
pub struct SiteDomain {
    /// The clinic's own domain, if any.
    pub custom_domain: Option<String>,
    /// `none`, `pending`, `verified` or `failed`.
    pub status: String,
    /// The value of the TXT record that proves ownership.
    pub verification_token: Option<String>,
    /// When it was last checked (RFC 3339).
    pub checked_at: Option<String>,
    /// What a `www` CNAME record points to.
    pub sites_target: String,
    /// The free address the site is served on without a domain of the clinic's own.
    pub default_address: String,
}

/// The owner's website settings and everything the editor needs.
#[derive(Debug, Serialize, ToSchema)]
pub struct WebsiteSettings {
    /// `one` or `multi`.
    pub layout: String,
    /// The design.
    pub template: String,
    /// The palette.
    pub palette: String,
    /// The font pairing.
    pub fonts: String,
    /// The owner's text and choices.
    pub content: WebsiteContent,
    /// Whether the site is live.
    pub published: bool,
    /// When it last went live (RFC 3339).
    pub published_at: Option<String>,
    /// The custom domain step.
    pub domain: SiteDomain,
    /// Every picture, including doctor portraits.
    pub photos: Vec<SitePhoto>,
    /// The site as it shows now, published or not.
    pub preview: SitePage,
    /// Doctors the owner may show or hide.
    pub doctors: Vec<SiteChoice>,
    /// Services the owner may show or hide.
    pub services: Vec<SiteChoice>,
    /// The designs and their palettes.
    pub templates: Vec<SiteTemplate>,
    /// The font pairings.
    pub fonts_available: Vec<String>,
}

fn settings_view(state: &AppState, view: &WebsiteView) -> Result<WebsiteSettings, ApiFailure> {
    let s = &view.settings;
    let links = state.website();
    Ok(WebsiteSettings {
        layout: s.layout.as_str().to_owned(),
        template: s.template.clone(),
        palette: s.palette.clone(),
        fonts: s.fonts.clone(),
        content: convert(&s.content)?,
        published: s.published,
        published_at: s.published_at.map(rfc3339),
        domain: SiteDomain {
            custom_domain: s.custom_domain.clone(),
            status: s.domain_status.as_str().to_owned(),
            verification_token: s.domain_token.clone(),
            checked_at: s.domain_checked_at.map(rfc3339),
            sites_target: links.sites_target.clone(),
            default_address: links.address_for(&view.slug),
        },
        photos: view.photos.iter().map(SitePhoto::from).collect(),
        preview: SitePage::try_from(&view.preview)?,
        doctors: view.doctors.iter().map(SiteChoice::from).collect(),
        services: view.services.iter().map(SiteChoice::from).collect(),
        templates: TEMPLATES
            .iter()
            .map(|t| SiteTemplate {
                id: t.id.to_owned(),
                palettes: t.palettes.iter().map(|p| (*p).to_owned()).collect(),
            })
            .collect(),
        fonts_available: FONTS.iter().map(|f| (*f).to_owned()).collect(),
    })
}

/// The owner's website settings, pictures and a preview of the page.
#[utoipa::path(
    get,
    path = "/api/v1/settings/website",
    operation_id = "getWebsiteSettings",
    tag = "website",
    security(("bearer" = [])),
    responses(
        (status = 200, body = WebsiteSettings),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<WebsiteSettings>, ApiFailure> {
    let view = app::get(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(settings_view(&state, &view)?))
}

/// Changes to the website; anything left out stays as it is.
#[derive(Debug, Deserialize, ToSchema)]
pub struct WebsiteChanges {
    /// `one` or `multi`.
    pub layout: Option<String>,
    /// The design. A new design starts with its first palette unless `palette` is given.
    pub template: Option<String>,
    /// One of the design's palettes.
    pub palette: Option<String>,
    /// One of the font pairings.
    pub fonts: Option<String>,
    /// All the content; replaces what is stored.
    pub content: Option<WebsiteContent>,
    /// Publish or take the site down.
    pub published: Option<bool>,
    /// The clinic's own domain; an empty string removes it. A new domain starts as `pending`.
    pub custom_domain: Option<String>,
}

/// Changes the website: design, content, published state or domain. Doctors in `content` must
/// belong to the clinic; links must start with `https://`.
#[utoipa::path(
    patch,
    path = "/api/v1/settings/website",
    operation_id = "updateWebsiteSettings",
    tag = "website",
    request_body = WebsiteChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = WebsiteSettings),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn update_settings(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<WebsiteChanges>,
) -> Result<Json<WebsiteSettings>, ApiFailure> {
    let published = body.published;
    let content: Option<SiteContent> = body.content.as_ref().map(convert).transpose()?;
    let view = app::update(
        state.db(),
        &request.actor,
        request.request_id,
        SiteChanges {
            layout: body.layout,
            template: body.template,
            palette: body.palette,
            fonts: body.fonts,
            content,
            published,
            custom_domain: body.custom_domain,
        },
    )
    .await?;
    let event = if published.is_some() {
        Event::WebsitePublished
    } else {
        Event::WebsiteChanged
    };
    tracing::info!(event = event.as_str(), "website changed");
    Ok(Json(settings_view(&state, &view)?))
}

/// The form a picture upload sends (`multipart/form-data`).
#[derive(Debug, ToSchema)]
#[expect(
    dead_code,
    reason = "documents the multipart form; fields are read from the stream"
)]
pub struct PhotoForm {
    /// The picture: JPEG, PNG or WebP, up to 5 MB. Its type is read from its content.
    #[schema(value_type = String, format = Binary)]
    file: Vec<u8>,
    /// `logo`, `hero`, `about`, `doctor` or `gallery` (default).
    kind: Option<String>,
    /// What it shows, for people who cannot see it.
    alt: Option<String>,
}

/// Room for a picture and the form around it.
pub(crate) const MAX_UPLOAD_BODY: usize = MAX_PHOTO_BYTES + 64 * 1024;

fn bad_form(message: &'static str) -> ApiFailure {
    ApiFailure(ApiError::bad_request("invalid_request", message))
}

fn too_large() -> ApiFailure {
    ApiFailure(ApiError::new(
        ErrorKind::PayloadTooLarge,
        "too_large",
        "file: must be at most 5 MB",
    ))
}

fn form_error(error: &MultipartError) -> ApiFailure {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        too_large()
    } else {
        bad_form("the form could not be read")
    }
}

async fn read_form(mut form: Multipart) -> Result<PhotoUpload, ApiFailure> {
    let mut upload = PhotoUpload::default();
    let mut has_file = false;
    while let Some(field) = form.next_field().await.map_err(|e| form_error(&e))? {
        let name = field.name().unwrap_or_default().to_owned();
        if name == "file" {
            upload.bytes = field.bytes().await.map_err(|e| form_error(&e))?.to_vec();
            if upload.bytes.len() > MAX_PHOTO_BYTES {
                return Err(too_large());
            }
            has_file = true;
            continue;
        }
        let text = field.text().await.map_err(|e| form_error(&e))?;
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        match name.as_str() {
            "kind" => upload.kind = Some(text.to_owned()),
            "alt" => upload.alt = Some(text.to_owned()),
            _ => return Err(bad_form("unknown form field")),
        }
    }
    if has_file {
        Ok(upload)
    } else {
        Err(bad_form("file: is required"))
    }
}

/// Uploads a website picture (`multipart/form-data`, field `file` up to 5 MB). A logo, hero or
/// about picture replaces the one before it.
#[utoipa::path(
    post,
    path = "/api/v1/settings/website/photos",
    operation_id = "uploadWebsitePhoto",
    tag = "website",
    request_body(content = PhotoForm, content_type = "multipart/form-data"),
    security(("bearer" = [])),
    responses(
        (status = 201, body = SitePhoto),
        (status = 400, description = "Not a JPEG, PNG or WebP picture, a bad field, or too many pictures"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 413, description = "Larger than 5 MB")
    )
)]
pub(crate) async fn upload_photo(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    form: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<SitePhoto>), ApiFailure> {
    let form = form.map_err(|_| bad_form("send the file as multipart/form-data"))?;
    let upload = read_form(form).await?;
    let view = app::upload_photo(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        upload,
    )
    .await?;
    tracing::info!(event = Event::WebsitePhotoChanged.as_str(), photo_id = %view.id, "website picture uploaded");
    Ok((StatusCode::CREATED, Json(SitePhoto::from(&view))))
}

/// A picture's new description.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PhotoChanges {
    /// What it shows; empty removes it.
    pub alt: String,
}

/// Changes a picture's description.
#[utoipa::path(
    patch,
    path = "/api/v1/settings/website/photos/{id}",
    operation_id = "describeWebsitePhoto",
    tag = "website",
    params(("id" = String, Path, description = "The picture")),
    request_body = PhotoChanges,
    security(("bearer" = [])),
    responses(
        (status = 200, body = SitePhoto),
        (status = 400, description = "Invalid input"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such picture in this clinic")
    )
)]
pub(crate) async fn describe_photo(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PhotoChanges>,
) -> Result<Json<SitePhoto>, ApiFailure> {
    let view = app::describe_photo(
        state.db(),
        &request.actor,
        request.request_id,
        id,
        Some(&body.alt),
    )
    .await?;
    Ok(Json(SitePhoto::from(&view)))
}

/// Removes a picture. Doctors who used it as a portrait lose it.
#[utoipa::path(
    delete,
    path = "/api/v1/settings/website/photos/{id}",
    operation_id = "deleteWebsitePhoto",
    tag = "website",
    params(("id" = String, Path, description = "The picture")),
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 404, description = "No such picture in this clinic")
    )
)]
pub(crate) async fn delete_photo(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiFailure> {
    app::delete_photo(
        state.db(),
        state.files()?,
        &request.actor,
        request.request_id,
        id,
    )
    .await?;
    tracing::info!(event = Event::WebsitePhotoChanged.as_str(), photo_id = %id, "website picture removed");
    Ok(StatusCode::NO_CONTENT)
}

/// Public, no sign-in: the clinic's published website. Holds the clinic's name, doctors,
/// services, hours and contact details, and nothing about patients.
#[utoipa::path(
    get,
    path = "/api/v1/public/site",
    operation_id = "getPublicSite",
    tag = "public",
    responses(
        (status = 200, body = SitePage),
        (status = 404, description = "Not a clinic, or its website is not published"),
        (status = 429, description = "Too many requests from this address")
    )
)]
pub(crate) async fn public_site(
    State(state): State<AppState>,
    public: ClinicHost,
) -> Result<Response, ApiFailure> {
    let site = app::public_site(state.db(), public.clinic_id, public.request_id)
        .await?
        .ok_or_else(|| ApiFailure(not_found()))?;
    let mut response = Json(SitePage::try_from(&site)?).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=30"),
    );
    Ok(response)
}

/// Public, no sign-in: one of the clinic's website pictures.
#[utoipa::path(
    get,
    path = "/api/v1/public/site/photos/{id}",
    operation_id = "getPublicSitePhoto",
    tag = "public",
    params(("id" = String, Path, description = "The picture")),
    responses(
        (status = 200, description = "The picture, with its media type"),
        (status = 404, description = "Not a picture of this clinic"),
        (status = 429, description = "Too many requests from this address")
    )
)]
pub(crate) async fn public_photo(
    State(state): State<AppState>,
    public: ClinicHost,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiFailure> {
    let photo = app::public_photo(
        state.db(),
        state.files()?,
        public.clinic_id,
        public.request_id,
        id,
    )
    .await?;
    let mut response = photo.bytes.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(photo.image.mime_type()),
    );
    // A picture's id never serves different bytes, so browsers and the edge may keep it.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=86400, immutable"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
    );
    Ok(response)
}
