//! Routes under `/api/v1`. Each route's extractor names who may call it:
//! [`crate::extract::Require`] (a clinic member with a permission), [`crate::extract::PlatformRequest`]
//! (Sakalya staff on the console host) or [`crate::extract::SignedIn`] (anyone signed in).

pub(crate) mod analytics;
pub(crate) mod appointments;
pub(crate) mod auth;
pub(crate) mod billing;
pub(crate) mod campaigns;
pub(crate) mod chart;
pub(crate) mod chat;
pub(crate) mod check_in;
pub(crate) mod client_errors;
pub(crate) mod clinic_hours;
pub(crate) mod consents;
pub(crate) mod console;
pub(crate) mod console_support;
pub(crate) mod dental_terms;
pub(crate) mod duplicates;
pub(crate) mod expenses;
pub(crate) mod facts;
pub(crate) mod files;
pub(crate) mod health;
pub(crate) mod imports;
pub(crate) mod internal;
pub(crate) mod inventory;
pub(crate) mod invitations;
pub(crate) mod lab_order_changes;
pub(crate) mod lab_orders;
pub(crate) mod lab_payments;
pub(crate) mod labs;
pub(crate) mod legal_hold;
pub(crate) mod letterhead;
pub(crate) mod me;
pub(crate) mod message_feedback;
pub(crate) mod message_templates;
pub(crate) mod messages;
pub(crate) mod meta;
pub(crate) mod notices;
pub(crate) mod notifications;
pub(crate) mod onboarding;
pub(crate) mod patient_app;
pub(crate) mod patient_links;
pub(crate) mod patient_notes;
pub(crate) mod patient_sessions;
pub(crate) mod patients;
pub(crate) mod payments;
pub(crate) mod prescriptions;
pub(crate) mod public_booking;
pub(crate) mod quality;
pub(crate) mod queue;
pub(crate) mod quick_picks;
pub(crate) mod recalls;
pub(crate) mod registrations;
pub(crate) mod reports;
pub(crate) mod roles;
pub(crate) mod schedule;
pub(crate) mod settings;
pub(crate) mod setup;
pub(crate) mod smart_import;
pub(crate) mod staff;
pub(crate) mod support_grants;
pub(crate) mod today;
pub(crate) mod treatment;
pub(crate) mod visits;
pub(crate) mod vitals;
pub(crate) mod walk_ins;
pub(crate) mod website;
pub(crate) mod whatsapp_webhook;

use axum::Json;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::{HeaderValue, header};
use axum::routing::{delete, get, patch, post, put};
use sakalya_http::ApiError;
use sakalya_types::{Entity, Id};
use time::format_description::well_known::Rfc3339;
use time::{Date, OffsetDateTime, Time};
use uuid::Uuid;

use axum::middleware::from_fn;

use crate::AppState;
use crate::revalidate::revalidate;

/// The version 1 routes. `local_dev` adds the development sign-in and the outbox drain, which
/// deployed servers don't have until Cloud Scheduler's signed calls are checked.
#[expect(
    clippy::too_many_lines,
    reason = "every route in one table, so reviews and the route audit see them together"
)]
pub(crate) fn routes(local_dev: bool) -> Router<AppState> {
    let router = Router::new()
        // Public: which app versions are served.
        .route("/meta", get(meta::meta))
        // Public: for uptime checks, through the edge (no database).
        .route("/health", get(health::health))
        // Public, throttled per IP and capped in size: errors from the web apps, logged only.
        .route(
            "/client-errors",
            post(client_errors::report).layer(DefaultBodyLimit::max(client_errors::MAX_BODY)),
        )
        .route("/me", get(me::me))
        .route("/me/sessions", get(me::sessions))
        .route("/me/sessions/{id}/revoke", post(me::revoke_session))
        .route("/session", get(me::session))
        // The patient app: a signed-in patient's own records, at the clinics that linked them
        // (tests/patient_app.rs). Reads on the app host; booking, cancelling and files on the
        // clinic's host, which must have linked the account.
        .route("/me/patient", get(patient_app::me))
        .route("/me/patient/home", get(patient_app::home))
        .route("/me/patient/sessions", get(patient_sessions::list))
        .route(
            "/me/patient/sessions/{id}",
            delete(patient_sessions::revoke),
        )
        .route("/me/patient/appointments", get(patient_app::appointments))
        .route("/me/patient/prescriptions", get(patient_app::prescriptions))
        .route("/me/patient/bills", get(patient_app::bills))
        .route("/me/patient/files", get(patient_app::files))
        .route("/me/patient/links", post(patient_app::redeem))
        .route("/me/patient/links/{id}/revoke", post(patient_app::revoke))
        .route("/me/patient/link-requests", post(patient_app::request_link))
        .route("/me/patient/bookings", post(patient_app::book))
        .route(
            "/me/patient/appointments/{id}/cancel",
            post(patient_app::cancel),
        )
        .route(
            "/me/patient/files/{id}/content",
            get(patient_app::file_content),
        )
        // Central sign-in: a signed-in person asks for a one-time code for another host; that
        // host redeems it, unauthenticated, throttled per IP (tests/handoff.rs).
        .route("/auth/handoff", post(auth::create))
        .route("/auth/handoff/redeem", post(auth::redeem))
        .route("/invitations/accept", post(invitations::accept))
        .route("/patients", get(patients::recent).post(patients::register))
        .route("/patients/search", post(patients::search))
        .route("/patients/lookup", post(patients::lookup))
        .route("/patients/{id}", get(patients::open).patch(patients::edit))
        .route(
            "/patients/{id}/identifiers",
            get(imports::identifiers).post(imports::add_identifier),
        )
        .route(
            "/patients/{id}/identifiers/{identifier_id}",
            delete(imports::remove_identifier),
        )
        .route(
            "/imports/patients",
            // 2 MB of CSV, plus JSON escaping.
            post(imports::import_patients).layer(DefaultBodyLimit::max(3 * 1024 * 1024)),
        )
        .route(
            "/imports/sessions",
            post(smart_import::upload).layer(DefaultBodyLimit::max(smart_import::MAX_UPLOAD_BODY)),
        )
        .route("/imports/sessions/{id}", delete(smart_import::discard))
        .route(
            "/imports/sessions/{id}/preview",
            post(smart_import::preview),
        )
        .route("/imports/sessions/{id}/commit", post(smart_import::commit))
        .route("/imports/incomplete", get(smart_import::incomplete))
        .route(
            "/imports/incomplete/{id}/dismiss",
            post(smart_import::dismiss),
        )
        .route("/rooms", get(schedule::rooms).post(schedule::add_room))
        .route(
            "/rooms/{id}",
            patch(schedule::change_room).delete(schedule::remove_room),
        )
        .route(
            "/practitioners",
            get(schedule::practitioners).post(schedule::add_practitioner),
        )
        .route(
            "/practitioners/{id}",
            patch(schedule::change_practitioner).delete(schedule::remove_practitioner),
        )
        .route(
            "/practitioners/{id}/working-hours",
            get(schedule::hours).put(schedule::set_hours),
        )
        .route(
            "/clinic-hours",
            get(clinic_hours::hours).put(clinic_hours::set_hours),
        )
        .route(
            "/leave-blocks",
            get(schedule::leave).post(schedule::add_leave),
        )
        .route("/leave-blocks/{id}", delete(schedule::remove_leave))
        .route(
            "/appointments",
            get(appointments::list).post(appointments::book),
        )
        .route("/appointments/{id}", patch(appointments::change))
        .route("/appointments/{id}/status", post(appointments::set_status))
        .route("/appointments/{id}/check-in", post(check_in::check_in))
        .route("/queue", get(queue::list).post(queue::walk_in))
        .route("/queue/{id}/status", post(queue::set_status))
        .route("/queue/{id}/start-visit", post(queue::start_visit))
        .route("/walk-ins", post(walk_ins::register))
        .route("/quick-picks", get(quick_picks::get))
        .route("/today", get(today::today))
        .route(
            "/patients/{id}/visits",
            get(visits::list).post(visits::start),
        )
        .route("/patients/{id}/timeline", get(visits::timeline))
        .route(
            "/patients/{id}/consents",
            get(consents::list).post(consents::record),
        )
        .route("/consents/{id}/withdraw", post(consents::withdraw))
        // Messages to patients: staff send, the patient's list and contact preferences.
        .route("/messages", post(messages::send))
        .route("/patients/{id}/messages", get(messages::list))
        .route(
            "/patients/{id}/contact-preferences",
            post(messages::set_preference),
        )
        // Public, no sign-in: the one-click unsubscribe link (an opaque token, throttled per IP)
        // and Resend's signed webhook (Svix signature, size cap).
        .route(
            "/public/unsubscribe/{token}",
            post(message_feedback::unsubscribe).layer(DefaultBodyLimit::max(
                message_feedback::MAX_UNSUBSCRIBE_BODY,
            )),
        )
        .route(
            "/webhooks/resend",
            post(message_feedback::resend_webhook)
                .layer(DefaultBodyLimit::max(message_feedback::MAX_WEBHOOK_BODY)),
        )
        // Meta's WhatsApp webhook: the handshake (verify token) and signed events (HMAC).
        .route(
            "/webhooks/whatsapp",
            get(whatsapp_webhook::handshake)
                .post(whatsapp_webhook::receive)
                .layer(DefaultBodyLimit::max(whatsapp_webhook::MAX_BODY)),
        )
        // The clinic's message templates (settings.manage).
        .route(
            "/templates",
            get(message_templates::list).post(message_templates::create),
        )
        .route("/templates/{id}", patch(message_templates::update))
        .route("/templates/{id}/submit", post(message_templates::submit))
        // Audiences and campaigns (campaigns.manage: owners).
        .route(
            "/audiences",
            get(campaigns::list_audiences).post(campaigns::create_audience),
        )
        .route("/audiences/preview", post(campaigns::preview))
        .route(
            "/audiences/{id}",
            get(campaigns::get_audience)
                .patch(campaigns::update_audience)
                .delete(campaigns::delete_audience),
        )
        .route("/campaigns", get(campaigns::list).post(campaigns::create))
        .route(
            "/campaigns/{id}",
            get(campaigns::get).patch(campaigns::update),
        )
        .route("/campaigns/{id}/schedule", post(campaigns::schedule))
        .route("/campaigns/{id}/cancel", post(campaigns::cancel))
        .route("/campaigns/{id}/test-send", post(campaigns::test_send))
        .route("/patients/{id}/legal-hold", put(legal_hold::set))
        .route(
            "/support-grants",
            get(support_grants::list).post(support_grants::create),
        )
        .route("/support-grants/{id}/revoke", post(support_grants::revoke))
        .route("/support-grants/{id}/actions", get(support_grants::actions))
        .route(
            "/consent-notices",
            get(notices::list).post(notices::publish),
        )
        .route("/patient-duplicates", get(duplicates::list))
        .route(
            "/patient-duplicates/{id}/dismiss",
            post(duplicates::dismiss),
        )
        .route("/patients/{id}/merge", post(duplicates::merge))
        .route("/patients/{id}/app-access", get(patient_links::access))
        .route(
            "/patients/{id}/app-invitations",
            post(patient_links::invite),
        )
        .route("/patient-links/{id}/confirm", post(patient_links::confirm))
        .route("/patient-links/{id}/decline", post(patient_links::decline))
        .route("/patient-links/{id}/revoke", post(patient_links::revoke))
        .route("/attachments/{id}/sharing", put(patient_links::set_sharing))
        .route("/patients/{id}/notes", get(patient_notes::get))
        .route(
            "/patients/{id}/summary-note",
            put(patient_notes::save_summary),
        )
        .route("/visits/{id}", get(visits::open))
        .route("/visits/{id}/close", post(visits::close))
        .route("/visits/{id}/notes", post(visits::create_note))
        .route("/notes/{id}", patch(visits::edit_note))
        .route("/notes/{id}/sign", post(visits::sign_note))
        .route("/notes/{id}/addenda", post(visits::add_addendum))
        .route("/notes/{id}/entered-in-error", post(visits::note_in_error))
        .route("/visits/{id}/observations", post(vitals::record))
        .route(
            "/observations/{id}/entered-in-error",
            post(vitals::in_error),
        )
        .route(
            "/patients/{id}/conditions",
            get(facts::conditions).post(facts::add_condition),
        )
        .route(
            "/patients/{id}/conditions/{condition_id}",
            patch(facts::edit_condition),
        )
        .route(
            "/patients/{id}/allergies",
            get(facts::allergies).post(facts::add_allergy),
        )
        .route(
            "/patients/{id}/allergies/{allergy_id}",
            patch(facts::edit_allergy),
        )
        .route(
            "/patients/{id}/allergies/{allergy_id}/confirm",
            post(facts::confirm_allergy),
        )
        .route("/patients/{id}/clinical-flags", get(facts::flags))
        .route(
            "/patients/{id}/dental-chart",
            get(chart::get).post(chart::record),
        )
        .route(
            "/dental-terms",
            get(dental_terms::list).post(chart::add_term),
        )
        .route("/dental-terms/{id}", patch(dental_terms::rename))
        .route("/dental-terms/{id}/retire", post(dental_terms::retire))
        .route("/dental-terms/{id}/restore", post(dental_terms::restore))
        .route("/visits/{id}/procedures", post(treatment::record_procedure))
        .route("/patients/{id}/procedures", get(treatment::procedures))
        .route("/procedures/{id}/complete", post(treatment::complete))
        .route(
            "/procedures/{id}/entered-in-error",
            post(treatment::procedure_in_error),
        )
        .route(
            "/patients/{id}/treatment-plans",
            get(treatment::plans).post(treatment::create_plan),
        )
        .route("/treatment-plans/{id}/accept", post(treatment::accept_plan))
        .route(
            "/treatment-plan-items/{id}",
            patch(treatment::set_item_status),
        )
        .route(
            "/patients/{id}/attachments",
            get(files::list)
                .post(files::upload)
                .layer(DefaultBodyLimit::max(files::MAX_UPLOAD_BODY)),
        )
        .route(
            "/letterhead",
            get(letterhead::document).layer(from_fn(revalidate)),
        )
        .route(
            "/settings/letterhead/images/{slot}",
            put(letterhead::upload_image)
                .delete(letterhead::remove_image)
                .layer(DefaultBodyLimit::max(letterhead::MAX_UPLOAD_BODY)),
        )
        // Public, no sign-in: on the clinic's host, by signed link or share token.
        .route(
            "/letterhead/images/{id}/content",
            get(letterhead::image_content),
        )
        .route(
            "/shared/{token}/letterhead",
            get(letterhead::shared_document),
        )
        .route("/attachments/{id}/download", get(files::link))
        .route("/attachments/{id}/content", get(files::content))
        .route(
            "/settings/website",
            get(website::get_settings).patch(website::update_settings),
        )
        .route(
            "/settings/website/photos",
            post(website::upload_photo).layer(DefaultBodyLimit::max(website::MAX_UPLOAD_BODY)),
        )
        .route(
            "/settings/website/photos/{id}",
            patch(website::describe_photo).delete(website::delete_photo),
        )
        .route("/staff", get(staff::list))
        .route("/staff/invitations", post(staff::invite))
        .route("/staff/{membership_id}", patch(staff::change))
        .route(
            "/roles",
            get(staff::roles)
                .layer(from_fn(revalidate))
                .post(roles::create),
        )
        .route("/roles/{key}", get(roles::role).delete(roles::delete))
        .route("/roles/{key}/permissions", put(roles::set_permissions))
        .route(
            "/permissions",
            get(roles::catalogue).layer(from_fn(revalidate)),
        )
        .route(
            "/settings/onboarding",
            get(setup::get_clinic_setup).patch(setup::update_clinic_setup),
        )
        .route(
            "/me/onboarding",
            get(setup::get_my_setup).patch(setup::update_my_setup),
        )
        .route(
            "/me/practitioner",
            get(setup::my_practitioner).patch(setup::update_my_practitioner),
        )
        .route(
            "/me/working-hours",
            get(setup::my_hours).put(setup::set_my_hours),
        )
        .route(
            "/settings/clinic",
            get(settings::get_clinic)
                .layer(from_fn(revalidate))
                .patch(settings::update_clinic),
        )
        .route(
            "/console/clinics",
            get(console::clinics).post(console::create_clinic),
        )
        .route("/console/metrics", get(console::metrics))
        .route("/console/quality", get(quality::quality))
        .route("/console/clinics/{id}", get(onboarding::clinic))
        .route(
            "/console/clinics/{id}/invitations",
            post(onboarding::invite),
        )
        .route(
            "/console/clinics/{id}/owner-invitation/resend",
            post(onboarding::resend_owner_invitation),
        )
        .route("/console/slugs", get(console::check_slug))
        .route("/console/support-grants", get(console_support::mine))
        .route("/console/applications", get(onboarding::applications))
        .route(
            "/console/applications/{id}/approve",
            post(onboarding::approve),
        )
        .route(
            "/console/applications/{id}/reject",
            post(onboarding::reject),
        )
        // Public: the landing page's registration form. Throttled per IP (see
        // `crate::throttle_rules`) and answers the same whatever happened.
        .route("/registrations", post(registrations::register))
        // Public, on the clinic's host: patients booking for themselves. Reads need no
        // sign-in; booking needs a verified-email sign-in with no clinic membership.
        .route("/public/booking", get(public_booking::booking_options))
        .route("/public/availability", get(public_booking::free_slots))
        .route("/public/bookings", post(public_booking::book_online))
        // Public, on the clinic's host: the published website and its pictures.
        .route("/public/site", get(website::public_site))
        .route("/public/site/photos/{id}", get(website::public_photo))
        .route(
            "/price-items",
            get(billing::price_items)
                .layer(from_fn(revalidate))
                .post(billing::create_price_item),
        )
        .route("/price-items/{id}", patch(billing::update_price_item))
        .route(
            "/invoices",
            get(billing::list_invoices).post(billing::create_invoice),
        )
        .route(
            "/invoices/{id}",
            get(billing::get_invoice).patch(billing::edit_invoice),
        )
        .route("/invoices/{id}/issue", post(billing::issue_invoice))
        .route("/invoices/{id}/void", post(billing::void_invoice))
        .route(
            "/suppliers",
            get(inventory::suppliers).post(inventory::create_supplier),
        )
        .route(
            "/suppliers/{id}",
            patch(inventory::update_supplier).delete(inventory::delete_supplier),
        )
        .route(
            "/inventory-items",
            get(inventory::items).post(inventory::create_item),
        )
        .route(
            "/inventory-items/{id}",
            get(inventory::item)
                .patch(inventory::update_item)
                .delete(inventory::delete_item),
        )
        .route("/stock", get(inventory::summary))
        .route("/stock/low", get(inventory::low))
        .route("/stock/expiring", get(inventory::expiring))
        .route("/stock/receive", post(inventory::receive))
        .route("/stock/use", post(inventory::use_stock))
        .route("/stock/adjust", post(inventory::adjust))
        .route("/stock/batches/{id}/expire", post(inventory::expire_batch))
        .route("/payments", get(payments::list).post(payments::record))
        .route("/payments/{id}", get(payments::get))
        .route("/payments/{id}/void", post(payments::void))
        .route("/reports/collections", get(reports::collections))
        .route("/reports/pending", get(reports::pending))
        .route("/reports/analytics", get(analytics::analytics))
        .route("/notifications", get(notifications::list))
        .route("/notifications/count", get(notifications::count))
        .route("/notifications/read-all", post(notifications::read_all))
        .route("/notifications/{id}/read", post(notifications::read))
        .route("/inbox", get(notifications::inbox))
        .route("/conversations", get(chat::list).post(chat::start))
        .route("/conversations/{id}", get(chat::detail))
        .route("/conversations/{id}/members", post(chat::add_members))
        .route(
            "/conversations/{id}/members/{membership_id}",
            delete(chat::remove_member),
        )
        .route("/conversations/{id}/leave", post(chat::leave))
        .route("/conversations/{id}/mute", put(chat::mute))
        .route(
            "/conversations/{id}/messages",
            get(chat::messages).post(chat::post_message),
        )
        .route(
            "/conversations/{id}/messages/{message_id}",
            delete(chat::delete_message),
        )
        .route("/conversations/{id}/read", post(chat::mark_read))
        .route("/me/badges", get(chat::badges))
        .route("/expenses", get(expenses::list).post(expenses::record))
        .route("/expenses/{id}/void", post(expenses::void))
        .route(
            "/lab-vendors",
            get(labs::list_vendors).post(labs::create_vendor),
        )
        .route(
            "/lab-vendors/{id}",
            get(labs::get_vendor)
                .patch(labs::update_vendor)
                .delete(labs::delete_vendor),
        )
        .route("/lab-vendors/{id}/contacts", post(labs::create_contact))
        .route("/lab-vendors/{id}/balance", get(labs::balance))
        .route(
            "/lab-contacts/{id}",
            patch(labs::update_contact).delete(labs::delete_contact),
        )
        .route(
            "/lab-orders",
            get(lab_orders::list).post(lab_orders::create),
        )
        .route(
            "/lab-orders/{id}",
            get(lab_orders::get).patch(lab_orders::update),
        )
        .route("/lab-orders/{id}/status", post(lab_orders::set_status))
        .route("/lab-orders/{id}/remind", post(lab_orders::remind))
        .route("/lab-orders/{id}/items", post(lab_order_changes::add_item))
        .route(
            "/lab-orders/{id}/contacts-log",
            post(lab_order_changes::log_contact),
        )
        .route(
            "/lab-order-items/{id}",
            patch(lab_order_changes::update_item).delete(lab_order_changes::remove_item),
        )
        .route("/patients/{id}/lab-orders", get(lab_orders::for_patient))
        .route(
            "/lab-payments",
            get(lab_payments::list).post(lab_payments::record),
        )
        .route("/lab-payments/{id}/void", post(lab_payments::void))
        .route("/today/money", get(reports::today_money))
        .route("/patients/{id}/recalls", post(recalls::create))
        .route("/recalls", get(recalls::due))
        .route("/recalls/{id}/done", post(recalls::done))
        .route("/drugs/search", post(prescriptions::search_drugs))
        .route(
            "/patients/{id}/prescriptions",
            get(prescriptions::for_patient).post(prescriptions::create),
        )
        .route(
            "/patients/{id}/prescriptions/last",
            get(prescriptions::last),
        )
        .route(
            "/prescriptions/{id}",
            get(prescriptions::get).patch(prescriptions::edit),
        )
        .route("/prescriptions/{id}/issue", post(prescriptions::issue))
        .route("/prescriptions/{id}/cancel", post(prescriptions::cancel))
        .route(
            "/prescriptions/{id}/share",
            post(prescriptions::create_share),
        )
        // Public, no sign-in: on the clinic's host, limited by the link's token and PIN.
        .route("/shared/{token}", get(prescriptions::shared_preview))
        .route("/shared/{token}/open", post(prescriptions::shared_open))
        .route(
            "/verify/prescriptions/{verify_token}",
            get(prescriptions::verify),
        );
    if local_dev {
        router
            .route("/dev/token", post(crate::dev::token))
            .route("/internal/outbox/drain", post(internal::drain_outbox))
    } else {
        router
    }
}

/// RFC 3339 for timestamps in responses.
pub(crate) fn rfc3339(at: OffsetDateTime) -> String {
    at.format(&Rfc3339).unwrap_or_default()
}

/// An optional identifier where an empty string means none.
pub(crate) fn optional_uuid(field: &'static str, text: &str) -> Result<Option<Uuid>, ApiError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    Uuid::parse_str(text)
        .map(Some)
        .map_err(|_| ApiError::bad_request("invalid_request", format!("{field}: must be an id")))
}

pub(crate) fn bad(field: &str, problem: &str) -> ApiError {
    ApiError::bad_request("invalid_request", format!("{field}: {problem}"))
}

/// An instant in RFC 3339, such as `2026-10-05T10:00:00+05:30`.
pub(crate) fn parse_instant(field: &str, text: &str) -> Result<OffsetDateTime, ApiError> {
    OffsetDateTime::parse(text.trim(), &Rfc3339).map_err(|_| {
        bad(
            field,
            "must be an RFC 3339 time such as 2026-10-05T10:00:00+05:30",
        )
    })
}

/// A local date, `YYYY-MM-DD`.
pub(crate) fn parse_day(field: &str, text: &str) -> Result<Date, ApiError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    Date::parse(text.trim(), &format).map_err(|_| bad(field, "must be YYYY-MM-DD"))
}

/// A local time of day, `HH:MM`.
pub(crate) fn parse_clock(field: &str, text: &str) -> Result<Time, ApiError> {
    let format = time::macros::format_description!("[hour]:[minute]");
    Time::parse(text.trim(), &format).map_err(|_| bad(field, "must be HH:MM"))
}

/// A local time of day as `HH:MM`.
pub(crate) fn clock(at: Time) -> String {
    format!("{:02}:{:02}", at.hour(), at.minute())
}

/// An identifier sent in a body.
pub(crate) fn parse_id(field: &str, text: &str) -> Result<Uuid, ApiError> {
    Uuid::parse_str(text.trim()).map_err(|_| bad(field, "must be an id"))
}

/// A record's JSON with its `ETag`.
pub(crate) type WithEtag<T> = ([(header::HeaderName, HeaderValue); 1], Json<T>);

/// `body` with the `ETag` for a record at `row_version`: the version in quotes, which the client
/// sends back in `If-Match` when it edits the record.
pub(crate) fn with_etag<T>(row_version: i64, body: T) -> WithEtag<T> {
    let value = HeaderValue::from_str(&format!("\"{row_version}\""))
        .unwrap_or_else(|_| HeaderValue::from_static("\"0\""));
    ([(header::ETAG, value)], Json(body))
}

/// An identifier the client chose for a record it creates: a version 7 UUID, so records made
/// offline can refer to each other and a retry can't create a second copy.
pub(crate) fn client_id<T: Entity>(field: &str, text: &str) -> Result<Id<T>, ApiError> {
    aarogyam_domain::client_id::client_id(parse_id(field, text)?)
        .map_err(|error| bad(field, &error.to_string()))
}
