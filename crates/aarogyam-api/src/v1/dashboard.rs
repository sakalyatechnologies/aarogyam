//! The Today board's layout and its catalogue: the clinic's default (`/settings/dashboard-layout`,
//! `settings.manage`) and each member's own (`/me/dashboard-layout`, any member). Every read
//! returns the catalogue too (templates, widgets with their zones, sizes, options and the
//! permission each needs), so the portal renders and edits from one source. Layouts are checked
//! against the registry in `aarogyam-domain`; a bad one is 400.

use aarogyam_app::dashboard::{self as app, Resolved, Source};
use aarogyam_domain::dashboard::{
    self as domain, CardStyle, Density, Layout, Metric, OptKind, OptSpec, RailWidth, RawItem,
    RawLayout, Side, Size, Template, Widget, Zone,
};
use aarogyam_domain::event::Event;
use aarogyam_domain::permission::require::SettingsManage;
use axum::Json;
use axum::extract::State;
use sakalya_http::{ApiError, ApiJson};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use utoipa::ToSchema;

use crate::AppState;
use crate::extract::{ClinicRequest, Require};
use crate::failure::ApiFailure;

const fn version() -> u8 {
    domain::VERSION
}

/// Where the rail is and how wide.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LayoutRail {
    /// `left` or `right`.
    pub side: String,
    /// `narrow`, `medium` or `wide`.
    pub width: String,
}

/// One widget on the board.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LayoutItem {
    /// A widget key from the catalogue; each widget appears at most once.
    pub key: String,
    /// `top`, `main` or `rail`; the widget's `zones` say which it may use.
    pub zone: String,
    /// `S`, `M`, `L` or `full`: 4, 6, 8 or 12 of 12 columns; the widget's `sizes` say which it
    /// may have. Ignored in the rail.
    pub size: String,
    /// The widget's options. Options left out get their default; unknown ones are refused.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub opts: Map<String, Value>,
}

/// A dashboard layout, version 2.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DashboardLayout {
    /// The version; 2. May be left out when saving.
    #[serde(default = "version")]
    pub v: u8,
    /// The template it started from: `medsync`, `executive`, `care`, `focus`, `compact` or
    /// `front_desk`.
    pub tpl: String,
    /// `compact` or `cozy`.
    pub density: String,
    /// `flat`, `soft` or `outline`.
    pub card: String,
    /// The side column.
    pub rail: LayoutRail,
    /// The widgets, in order within each zone; at most one per widget.
    pub items: Vec<LayoutItem>,
}

impl From<&Layout> for DashboardLayout {
    fn from(layout: &Layout) -> Self {
        Self {
            v: layout.v,
            tpl: layout.tpl.to_string(),
            density: layout.density.to_string(),
            card: layout.card.to_string(),
            rail: LayoutRail {
                side: layout.rail.side.to_string(),
                width: layout.rail.width.to_string(),
            },
            items: layout
                .items
                .iter()
                .map(|item| LayoutItem {
                    key: item.key.to_string(),
                    zone: item.zone.to_string(),
                    size: item.size.to_string(),
                    opts: item.opts.clone(),
                })
                .collect(),
        }
    }
}

impl DashboardLayout {
    /// Checks the layout against the registry.
    fn check(self) -> Result<Layout, ApiFailure> {
        let raw = RawLayout {
            v: Some(self.v),
            tpl: self.tpl,
            density: self.density,
            card: self.card,
            rail_side: self.rail.side,
            rail_width: self.rail.width,
            items: self
                .items
                .into_iter()
                .map(|item| RawItem {
                    key: item.key,
                    zone: item.zone,
                    size: item.size,
                    opts: item.opts,
                })
                .collect(),
        };
        domain::validate(&raw).map_err(|error| {
            ApiFailure::from(ApiError::bad_request("invalid_layout", error.to_string()))
        })
    }
}

/// A starting layout.
#[derive(Debug, Serialize, ToSchema)]
pub struct TemplateInfo {
    /// The key, such as `medsync`.
    pub key: String,
    /// The name staff read.
    pub label: String,
    /// What it is for.
    pub description: String,
    /// The template's layout; "Reset to template" saves this.
    pub layout: DashboardLayout,
}

/// A headline number the `kpis` widget can show.
#[derive(Debug, Serialize, ToSchema)]
pub struct MetricInfo {
    /// The key used in `kpis.opts.metrics`.
    pub key: String,
    /// The name staff read.
    pub label: String,
    /// The permission needed to see it, such as `finance.view`; hide the number without it.
    pub requires: Option<String>,
}

/// One option of a widget.
#[derive(Debug, Serialize, ToSchema)]
pub struct OptionInfo {
    /// The key in `opts`.
    pub key: String,
    /// The name staff read.
    pub label: String,
    /// `choice` (one of `choices`, words), `int_choice` (one of `choices`, numbers), `int_range`
    /// (a whole number from `min` to `max`), `bool`, or `metrics` (a list of 4 to 6 distinct
    /// keys from the metric catalogue; `min` and `max` bound the length).
    pub kind: String,
    /// Used when the option is left out.
    pub default: Value,
    /// The allowed values, for `choice` and `int_choice`.
    pub choices: Option<Vec<Value>>,
    /// The smallest value (`int_range`) or list length (`metrics`).
    pub min: Option<i64>,
    /// The largest value (`int_range`) or list length (`metrics`).
    pub max: Option<i64>,
}

/// A widget the board can hold.
#[derive(Debug, Serialize, ToSchema)]
pub struct WidgetInfo {
    /// The key, such as `kpis`.
    pub key: String,
    /// The name staff read.
    pub label: String,
    /// What it shows.
    pub description: String,
    /// The zones it may sit in.
    pub zones: Vec<String>,
    /// The sizes it may have.
    pub sizes: Vec<String>,
    /// The zone a newly added widget goes to.
    pub default_zone: String,
    /// The size a newly added widget gets.
    pub default_size: String,
    /// The permission needed to see it, such as `finance.view`; the board hides it without. A
    /// layout may include widgets a role never sees.
    pub requires: Option<String>,
    /// Its options.
    pub options: Vec<OptionInfo>,
}

/// Everything the portal needs to draw and edit layouts.
#[derive(Debug, Serialize, ToSchema)]
pub struct LayoutCatalogue {
    /// The layout version, 2.
    pub version: u8,
    /// The templates.
    pub templates: Vec<TemplateInfo>,
    /// The widgets.
    pub widgets: Vec<WidgetInfo>,
    /// The headline numbers for `kpis`.
    pub metrics: Vec<MetricInfo>,
    /// Allowed `density` values.
    pub densities: Vec<String>,
    /// Allowed `card` values.
    pub cards: Vec<String>,
    /// Allowed `rail.side` values.
    pub rail_sides: Vec<String>,
    /// Allowed `rail.width` values.
    pub rail_widths: Vec<String>,
    /// Allowed `zone` values.
    pub zones: Vec<String>,
    /// Allowed `size` values.
    pub sizes: Vec<String>,
}

/// A layout with where it came from and the catalogue.
#[derive(Debug, Serialize, ToSchema)]
pub struct DashboardLayoutView {
    /// The layout to show.
    pub layout: DashboardLayout,
    /// `member` (their own), `clinic` (the clinic's default) or `template` (nothing saved: the
    /// `MedSync` template).
    pub source: String,
    /// Templates, widgets and options.
    pub catalogue: LayoutCatalogue,
}

fn strings<T: ToString>(values: &[T]) -> Vec<String> {
    values.iter().map(ToString::to_string).collect()
}

fn option_info(option: &OptSpec) -> OptionInfo {
    let (kind, choices, min, max) = match option.kind {
        OptKind::Choice { choices, .. } => (
            "choice",
            Some(choices.iter().map(|c| Value::from(*c)).collect()),
            None,
            None,
        ),
        OptKind::IntChoice { choices, .. } => (
            "int_choice",
            Some(choices.iter().map(|c| Value::from(*c)).collect()),
            None,
            None,
        ),
        OptKind::IntRange { min, max, .. } => ("int_range", None, Some(min), Some(max)),
        OptKind::Bool { .. } => ("bool", None, None, None),
        OptKind::Metrics { min, max, .. } => (
            "metrics",
            None,
            i64::try_from(min).ok(),
            i64::try_from(max).ok(),
        ),
    };
    OptionInfo {
        key: option.key.to_owned(),
        label: option.label.to_owned(),
        kind: kind.to_owned(),
        default: option.default_value(),
        choices,
        min,
        max,
    }
}

fn catalogue() -> LayoutCatalogue {
    LayoutCatalogue {
        version: domain::VERSION,
        templates: Template::ALL
            .iter()
            .map(|template| TemplateInfo {
                key: template.to_string(),
                label: template.label().to_owned(),
                description: template.description().to_owned(),
                layout: DashboardLayout::from(&template.layout()),
            })
            .collect(),
        widgets: Widget::ALL
            .iter()
            .map(|widget| {
                let spec = widget.spec();
                WidgetInfo {
                    key: widget.to_string(),
                    label: spec.label.to_owned(),
                    description: spec.description.to_owned(),
                    zones: strings(spec.zones),
                    sizes: strings(spec.sizes),
                    default_zone: spec.default_zone.to_string(),
                    default_size: spec.default_size.to_string(),
                    requires: spec.requires.map(|p| p.key().to_owned()),
                    options: spec.options.iter().map(option_info).collect(),
                }
            })
            .collect(),
        metrics: Metric::ALL
            .iter()
            .map(|metric| MetricInfo {
                key: metric.to_string(),
                label: metric.label().to_owned(),
                requires: metric.requires().map(|p| p.key().to_owned()),
            })
            .collect(),
        densities: strings(Density::ALL),
        cards: strings(CardStyle::ALL),
        rail_sides: strings(Side::ALL),
        rail_widths: strings(RailWidth::ALL),
        zones: strings(Zone::ALL),
        sizes: strings(Size::ALL),
    }
}

fn view(resolved: &Resolved) -> DashboardLayoutView {
    DashboardLayoutView {
        layout: DashboardLayout::from(&resolved.layout),
        source: match resolved.source {
            Source::Member => "member",
            Source::Clinic => "clinic",
            Source::Template => "template",
        }
        .to_owned(),
        catalogue: catalogue(),
    }
}

fn changed(what: &'static str) {
    tracing::info!(
        event = Event::SettingsChanged.as_str(),
        what,
        "dashboard layout changed"
    );
}

/// The caller's layout for this clinic: their own, else the clinic's default, else `MedSync`;
/// with the catalogue. Any member may read it; it is the same on every device.
#[utoipa::path(
    get,
    path = "/api/v1/me/dashboard-layout",
    operation_id = "getMyDashboardLayout",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = DashboardLayoutView),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn get_mine(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<Json<DashboardLayoutView>, ApiFailure> {
    let resolved = app::mine(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(view(&resolved)))
}

/// Saves the caller's own layout for this clinic and returns it. It replaces the previous one
/// and wins over the clinic's default until reset.
#[utoipa::path(
    put,
    path = "/api/v1/me/dashboard-layout",
    operation_id = "putMyDashboardLayout",
    tag = "settings",
    request_body = DashboardLayout,
    security(("bearer" = [])),
    responses(
        (status = 200, body = DashboardLayoutView),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it"),
        (status = 400, description = "An unknown or repeated widget, a zone or size it does not allow, or a bad option")
    )
)]
pub(crate) async fn put_mine(
    State(state): State<AppState>,
    request: ClinicRequest,
    ApiJson(body): ApiJson<DashboardLayout>,
) -> Result<Json<DashboardLayoutView>, ApiFailure> {
    let layout = body.check()?;
    let resolved = app::set_mine(state.db(), &request.actor, request.request_id, layout).await?;
    changed("dashboard_layout_member");
    Ok(Json(view(&resolved)))
}

/// Resets the caller's layout: deletes their own and returns the one that applies now, the
/// clinic's default or `MedSync`. Also fine when they had none.
#[utoipa::path(
    delete,
    path = "/api/v1/me/dashboard-layout",
    operation_id = "resetMyDashboardLayout",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = DashboardLayoutView),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not a clinic, or not a member of it")
    )
)]
pub(crate) async fn reset_mine(
    State(state): State<AppState>,
    request: ClinicRequest,
) -> Result<Json<DashboardLayoutView>, ApiFailure> {
    let resolved = app::reset_mine(state.db(), &request.actor, request.request_id).await?;
    changed("dashboard_layout_member");
    Ok(Json(view(&resolved)))
}

/// The clinic's default layout, or `MedSync` when none was saved; with the catalogue.
#[utoipa::path(
    get,
    path = "/api/v1/settings/dashboard-layout",
    operation_id = "getDashboardLayout",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = DashboardLayoutView),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn get_default(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<DashboardLayoutView>, ApiFailure> {
    let resolved = app::clinic_default(state.db(), &request.actor, request.request_id).await?;
    Ok(Json(view(&resolved)))
}

/// Saves the clinic's default layout and returns it. Members who saved their own keep it.
#[utoipa::path(
    put,
    path = "/api/v1/settings/dashboard-layout",
    operation_id = "putDashboardLayout",
    tag = "settings",
    request_body = DashboardLayout,
    security(("bearer" = [])),
    responses(
        (status = 200, body = DashboardLayoutView),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage"),
        (status = 400, description = "An unknown or repeated widget, a zone or size it does not allow, or a bad option")
    )
)]
pub(crate) async fn put_default(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
    ApiJson(body): ApiJson<DashboardLayout>,
) -> Result<Json<DashboardLayoutView>, ApiFailure> {
    let layout = body.check()?;
    let resolved =
        app::set_clinic_default(state.db(), &request.actor, request.request_id, layout).await?;
    changed("dashboard_layout_clinic");
    Ok(Json(view(&resolved)))
}

/// Removes the clinic's default, so `MedSync` applies again to everyone without their own layout.
#[utoipa::path(
    delete,
    path = "/api/v1/settings/dashboard-layout",
    operation_id = "resetDashboardLayout",
    tag = "settings",
    security(("bearer" = [])),
    responses(
        (status = 200, body = DashboardLayoutView),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks settings.manage")
    )
)]
pub(crate) async fn reset_default(
    State(state): State<AppState>,
    Require { request, .. }: Require<SettingsManage>,
) -> Result<Json<DashboardLayoutView>, ApiFailure> {
    let resolved =
        app::reset_clinic_default(state.db(), &request.actor, request.request_id).await?;
    changed("dashboard_layout_clinic");
    Ok(Json(view(&resolved)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fake API in `web/packages/api-client` serves this file as its catalogue, so it cannot
    /// drift from the registry. Regenerate with `UPDATE_OPENAPI=1 cargo test -p aarogyam-api
    /// dashboard`.
    #[test]
    fn the_fake_apis_catalogue_matches_the_registry() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../web/packages/api-client/src/fake/dashboard-catalogue.json");
        let generated = serde_json::to_string_pretty(&catalogue()).unwrap() + "\n";
        if std::env::var("UPDATE_OPENAPI").is_ok_and(|value| value == "1") {
            std::fs::write(&path, generated).unwrap();
            return;
        }
        let committed = std::fs::read_to_string(&path).unwrap_or_default();
        assert!(
            committed == generated,
            "dashboard-catalogue.json is stale. Regenerate it with \
             `UPDATE_OPENAPI=1 cargo test -p aarogyam-api dashboard`, and commit it."
        );
    }
}
