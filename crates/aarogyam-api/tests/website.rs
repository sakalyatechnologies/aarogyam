//! The clinic website on a real database: the owner's editor (permissions, validation, design
//! choices, pictures, the custom domain step), the published public payload (no private
//! fields, only this clinic's data) and cross-clinic isolation.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one journey end to end, step by step"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt as _;

const SETTINGS: &str = "/api/v1/settings/website";
const SITE: &str = "/api/v1/public/site";
const BOUNDARY: &str = "aarogyam-site-boundary";

fn png(extra: usize) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.extend(std::iter::repeat_n(7_u8, extra));
    bytes
}

async fn upload(
    app: &TestApp,
    host: &str,
    token: &str,
    bytes: &[u8],
    fields: &[(&str, &str)],
) -> (StatusCode, Value) {
    let mut body = Vec::new();
    for (name, value) in fields {
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    body.extend_from_slice(
        format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::post(format!("{SETTINGS}/photos"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// A public fetch: status, content type, cache control and bytes.
async fn fetch(app: &TestApp, host: &str, path: &str) -> (StatusCode, String, String, Vec<u8>) {
    let request = Request::get(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let header = |name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    };
    let (content_type, cache) = (header("content-type"), header("cache-control"));
    let bytes = to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (status, content_type, cache, bytes.to_vec())
}

async fn patch(app: &TestApp, host: &str, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(Method::PATCH, host, SETTINGS, Some(token), Some(body))
        .await
}

async fn post(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_owner_edits_the_design_and_content_with_checks() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);

    let (status, site) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    assert_eq!(site["layout"], "one");
    assert_eq!(site["template"], "aurora");
    assert_eq!(site["palette"], "gold");
    assert_eq!(site["published"], false);
    assert_eq!(site["domain"]["status"], "none");
    assert_eq!(site["domain"]["default_address"], "alpha-site.localtest.me");
    assert_eq!(site["domain"]["sites_target"], "sites.localtest.me");
    assert!(site["templates"].as_array().unwrap().len() >= 4);
    assert_eq!(site["preview"]["clinic"]["name"], "Alpha Dental");

    // A new design takes its own first palette; a palette of another design is refused.
    let (status, site) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "layout": "multi", "template": "hearth", "fonts": "friendly" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    assert_eq!(site["layout"], "multi");
    assert_eq!(site["palette"], "terracotta");
    assert_eq!(site["preview"]["design"]["template"], "hearth");
    for (body, field) in [
        (json!({ "palette": "gold" }), "palette"),
        (json!({ "template": "nope" }), "template"),
        (json!({ "fonts": "comic" }), "fonts"),
        (json!({ "layout": "three" }), "layout"),
        (json!({ "custom_domain": "not a domain" }), "custom_domain"),
        (
            json!({ "content": { "contact": { "map_url": "javascript:alert(1)" } } }),
            "content.contact.map_url",
        ),
        (
            json!({ "content": { "hero": { "headline": "x".repeat(121) } } }),
            "content.hero.headline",
        ),
        (
            json!({ "content": { "reviews": [{ "name": "A", "rating": 9, "text": "Good" }] } }),
            "content.reviews.rating",
        ),
        (
            json!({ "content": { "contact": { "whatsapp": "12" } } }),
            "content.contact.whatsapp",
        ),
        (
            json!({ "content": { "doctors": [{ "practitioner_id": "0190a1b2-0000-7000-8000-000000000001" }] } }),
            "content.doctors",
        ),
    ] {
        let (status, error) = patch(&app, ALPHA, &owner, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {error}");
        assert!(
            error["error"]["message"].as_str().unwrap().contains(field),
            "{field}: {error}"
        );
    }

    // Content is stored cleaned, and the WhatsApp number in E.164.
    let (status, site) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "content": {
            "hero": { "headline": "  Gentle   care  " },
            "contact": { "whatsapp": "98765 43210", "map_url": "https://maps.example/alpha" },
            "reviews": [{ "name": "Priya N.", "rating": 5, "text": "Kind and quick." }]
        } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    assert_eq!(site["content"]["hero"]["headline"], "Gentle care");
    assert_eq!(site["content"]["contact"]["whatsapp"], "+919876543210");
    assert_eq!(site["preview"]["clinic"]["whatsapp"], "+919876543210");
    assert_eq!(site["preview"]["reviews"][0]["name"], "Priya N.");
    // The earlier design choices survived the content change.
    assert_eq!(site["template"], "hearth");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_settings_managers_edit_and_clinics_stay_apart() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app.send(Method::GET, ALPHA, SETTINGS, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    for person in [ALPHA_ASSISTANT, ALPHA_FRONT_DESK, ALPHA_NOTHING] {
        let token = app.token(person);
        let (status, _) = app
            .send(Method::GET, ALPHA, SETTINGS, Some(&token), None)
            .await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{status}"
        );
        let (status, _) = patch(&app, ALPHA, &token, json!({ "published": true })).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{status}"
        );
        let (status, _) = upload(&app, ALPHA, &token, &png(64), &[]).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{status}"
        );
    }
    // The front desk really is refused (not only hidden).
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = patch(&app, ALPHA, &desk, json!({ "published": true })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Nothing changed.
    let (_, site) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(site["published"], false);

    // Beta's owner is not a member of Alpha.
    let (status, _) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = patch(&app, ALPHA, &beta, json!({ "published": true })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Each clinic has its own settings, doctors and pictures.
    let (status, photo) = upload(&app, ALPHA, &owner, &png(64), &[("kind", "gallery")]).await;
    assert_eq!(status, StatusCode::CREATED, "{photo}");
    let photo_id = photo["id"].as_str().unwrap().to_owned();
    patch(
        &app,
        ALPHA,
        &owner,
        json!({ "template": "bold", "published": true }),
    )
    .await;
    let (_, beta_site) = app
        .send(Method::GET, BETA, SETTINGS, Some(&beta), None)
        .await;
    assert_eq!(beta_site["template"], "aurora");
    assert_eq!(beta_site["published"], false);
    assert_eq!(beta_site["photos"].as_array().unwrap().len(), 0);
    assert_eq!(beta_site["preview"]["clinic"]["name"], "Beta Dental");

    // Another clinic's picture is not found, to describe, delete or view.
    let (status, _) = app
        .send(
            Method::PATCH,
            BETA,
            &format!("{SETTINGS}/photos/{photo_id}"),
            Some(&beta),
            Some(json!({ "alt": "x" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::DELETE,
            BETA,
            &format!("{SETTINGS}/photos/{photo_id}"),
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, ..) = fetch(&app, BETA, &format!("{SITE}/photos/{photo_id}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // A doctor profile cannot point at another clinic's picture or doctor.
    let doctor = post(
        &app,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, error) = app
        .send(
            Method::PATCH,
            BETA,
            SETTINGS,
            Some(&beta),
            Some(json!({ "content": { "doctors": [{ "practitioner_id": doctor }] } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    // Beta's public site is not published, and Alpha's is.
    let (status, ..) = fetch(&app, BETA, SITE).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, ..) = fetch(&app, ALPHA, SITE).await;
    assert_eq!(status, StatusCode::OK);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_public_site_shows_published_public_content_only() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    // A patient, a doctor with a private registration number and shifts, and a price list.
    let patient = post(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Meera Shah", "phone": "98765 11111", "email": "meera@patient.example" }),
    )
    .await;
    assert!(patient["id"].is_string());
    let doctor = post(
        &app,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha Rao", "specialty": "Orthodontics",
                "registration_number": "MH-REG-778899" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let shifts = json!({ "shifts": [
        { "weekday": 1, "starts": "09:00", "ends": "13:00" },
        { "weekday": 1, "starts": "16:00", "ends": "20:00" },
        { "weekday": 2, "starts": "09:00", "ends": "13:00" },
    ] });
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{doctor}/working-hours"),
            Some(&owner),
            Some(shifts),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let scaling = post(
        &app,
        &owner,
        "/api/v1/price-items",
        json!({ "name": "Scaling and polishing", "price_paise": 150_000, "category": "preventive" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let crown = post(
        &app,
        &owner,
        "/api/v1/price-items",
        json!({ "name": "Zirconia crown", "price_paise": 1_250_000, "category": "restorative" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    post(
        &app,
        &owner,
        "/api/v1/price-items",
        json!({ "name": "Toothpaste", "price_paise": 20_000, "category": "medicines",
                "taxable": true, "tax_rate_bps": 1200 }),
    )
    .await;

    // Not published yet: nothing is public, though the owner can preview it.
    let (status, ..) = fetch(&app, ALPHA, SITE).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, preview) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(preview["preview"]["services"].as_array().unwrap().len(), 2);

    let (status, photo) = upload(
        &app,
        ALPHA,
        &owner,
        &png(300),
        &[("kind", "doctor"), ("alt", "Dr Asha smiling")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{photo}");
    let portrait = photo["id"].as_str().unwrap().to_owned();
    let (status, site) = patch(
        &app,
        ALPHA,
        &owner,
        json!({
            "published": true,
            "custom_domain": "www.alphadental.in",
            "content": {
                "doctors": [{ "practitioner_id": doctor, "qualifications": "BDS, MDS (Orthodontics)",
                              "bio": "Twelve years of braces.", "photo_id": portrait }],
                "services": { "hidden": [crown], "show_fees": true,
                              "notes": [{ "price_item_id": scaling, "description": "Every six months." }] },
                "contact": { "hours_note": "Closed on public holidays" }
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    assert_eq!(site["published"], true);
    assert!(site["published_at"].is_string());
    assert_eq!(site["domain"]["status"], "pending");
    let token = site["domain"]["verification_token"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(token.starts_with("aarogyam-verify-"));

    let (status, content_type, cache, bytes) = fetch(&app, ALPHA, SITE).await;
    assert_eq!(status, StatusCode::OK);
    assert!(content_type.starts_with("application/json"));
    assert!(cache.contains("public"));
    let public: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(public["clinic"]["name"], "Alpha Dental");
    assert_eq!(public["design"]["template"], "aurora");
    assert_eq!(public["services"].as_array().unwrap().len(), 1, "{public}");
    assert_eq!(public["services"][0]["name"], "Scaling and polishing");
    assert_eq!(public["services"][0]["fee_paise"], 150_000);
    assert_eq!(public["services"][0]["description"], "Every six months.");
    assert_eq!(public["doctors"][0]["name"], "Dr Asha Rao");
    assert_eq!(
        public["doctors"][0]["qualifications"],
        "BDS, MDS (Orthodontics)"
    );
    assert_eq!(public["doctors"][0]["photo"]["alt"], "Dr Asha smiling");
    assert_eq!(public["hours"][0]["weekday"], 1);
    assert_eq!(
        public["hours"][0]["spans"],
        json!([["09:00", "13:00"], ["16:00", "20:00"]])
    );
    assert_eq!(public["hours"].as_array().unwrap().len(), 2);
    assert_eq!(public["hours_note"], "Closed on public holidays");
    assert_eq!(public["booking_enabled"], true);

    // No private fields: the exact set of top-level keys, and none of the private values
    // anywhere in the payload.
    let mut keys: Vec<&str> = public
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "about",
            "booking_enabled",
            "clinic",
            "design",
            "doctors",
            "hero",
            "hours",
            "hours_note",
            "photos",
            "reviews",
            "seo",
            "services",
            "services_intro",
            "social"
        ]
    );
    let text = String::from_utf8(bytes).unwrap();
    for private in [
        "Meera Shah",
        "98765 11111",
        "9876511111",
        "patient.example",
        "MH-REG-778899",
        "registration",
        "verify",
        &token,
        "alphadental.in",
        "domain",
        "published",
        "Zirconia",
        "Toothpaste",
        "org_id",
        "membership",
        "gstin",
        "upi",
    ] {
        assert!(!text.contains(private), "{private} leaked into: {text}");
    }
    // Hiding fees removes them from the public page, not only from the screen.
    patch(
        &app,
        ALPHA,
        &owner,
        json!({ "content": { "services": { "show_fees": false } } }),
    )
    .await;
    let (_, _, _, bytes) = fetch(&app, ALPHA, SITE).await;
    let public: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(public["services"][0]["fee_paise"].is_null());
    assert_eq!(public["services"].as_array().unwrap().len(), 2);

    // Taking the site down hides it again.
    patch(&app, ALPHA, &owner, json!({ "published": false })).await;
    let (status, ..) = fetch(&app, ALPHA, SITE).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn pictures_are_checked_by_content_replaced_and_served_publicly() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);

    for (bytes, what) in [
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>".to_vec(),
            "svg",
        ),
        (b"%PDF-1.7 not a picture".to_vec(), "pdf"),
        (Vec::new(), "empty"),
    ] {
        let (status, _) = upload(&app, ALPHA, &owner, &bytes, &[]).await;
        assert!(status == StatusCode::BAD_REQUEST, "{what}: {status}");
    }
    let (status, error) = upload(&app, ALPHA, &owner, &png(16), &[("kind", "banner")]).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    let (status, _) = upload(&app, ALPHA, &owner, &png(5 * 1024 * 1024 + 10), &[]).await;
    assert!(
        status == StatusCode::PAYLOAD_TOO_LARGE || status == StatusCode::BAD_REQUEST,
        "{status}"
    );

    let (status, first) = upload(
        &app,
        ALPHA,
        &owner,
        &png(100),
        &[("kind", "logo"), ("alt", "  Alpha   logo ")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["alt"], "Alpha logo");
    let first_url = first["url"].as_str().unwrap().to_owned();
    let (status, content_type, cache, bytes) = fetch(&app, ALPHA, &first_url).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type, "image/png");
    assert!(cache.contains("immutable"));
    assert_eq!(bytes, png(100));

    // A new logo replaces the old one, and the old file is gone.
    let (_, second) = upload(&app, ALPHA, &owner, &png(200), &[("kind", "logo")]).await;
    let (status, ..) = fetch(&app, ALPHA, &first_url).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, site) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(site["photos"].as_array().unwrap().len(), 1);
    assert_eq!(site["preview"]["photos"]["logo"]["id"], second["id"]);

    // Gallery pictures add up; describing and deleting work; the id is a path, so it can only
    // reach this clinic's pictures.
    let (_, one) = upload(&app, ALPHA, &owner, &png(10), &[("kind", "gallery")]).await;
    let (_, two) = upload(&app, ALPHA, &owner, &png(20), &[("kind", "gallery")]).await;
    let (status, described) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("{SETTINGS}/photos/{}", one["id"].as_str().unwrap()),
            Some(&owner),
            Some(json!({ "alt": "Reception" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{described}");
    assert_eq!(described["alt"], "Reception");
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            &format!("{SETTINGS}/photos/{}", two["id"].as_str().unwrap()),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            &format!("{SETTINGS}/photos/{}", two["id"].as_str().unwrap()),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, site) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(
        site["preview"]["photos"]["gallery"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // Deleting a doctor's portrait removes it from the profile.
    let doctor = post(
        &app,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Dev" }),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, portrait) = upload(&app, ALPHA, &owner, &png(30), &[("kind", "doctor")]).await;
    let portrait_id = portrait["id"].as_str().unwrap().to_owned();
    let (status, site) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "content": { "doctors": [{ "practitioner_id": doctor, "photo_id": portrait_id }] } }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    assert_eq!(
        site["content"]["doctors"][0]["photo_id"],
        portrait_id.as_str()
    );
    // A gallery picture is not a doctor portrait.
    let (status, _) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "content": { "doctors": [{ "practitioner_id": doctor, "photo_id": one["id"] }] } }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.send(
        Method::DELETE,
        ALPHA,
        &format!("{SETTINGS}/photos/{portrait_id}"),
        Some(&owner),
        None,
    )
    .await;
    let (_, site) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert!(site["content"]["doctors"][0]["photo_id"].is_null());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_custom_domain_is_cleaned_starts_pending_and_can_be_removed() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, site) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "custom_domain": " HTTPS://WWW.Alpha-Dental.in/ " }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    assert_eq!(site["domain"]["custom_domain"], "www.alpha-dental.in");
    assert_eq!(site["domain"]["status"], "pending");
    let token = site["domain"]["verification_token"].clone();
    assert!(token.is_string());
    // The same domain again keeps the token; another domain gets a new one.
    let (_, again) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "custom_domain": "www.alpha-dental.in" }),
    )
    .await;
    assert_eq!(again["domain"]["verification_token"], token);
    let (_, other) = patch(
        &app,
        ALPHA,
        &owner,
        json!({ "custom_domain": "alpha.co.in" }),
    )
    .await;
    assert_ne!(other["domain"]["verification_token"], token);
    let (status, cleared) = patch(&app, ALPHA, &owner, json!({ "custom_domain": "" })).await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert_eq!(cleared["domain"]["status"], "none");
    assert!(cleared["domain"]["custom_domain"].is_null());
    assert!(cleared["domain"]["verification_token"].is_null());
    app.finish().await;
}
