//! `GET /patients` sorts and pages on the server: every sort and direction, paging by offset
//! without duplicates or gaps, filters together with a sort, `400` for bad values, and clinic
//! B's patients never in clinic A's list.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn register(app: &TestApp, host: &str, token: &str, name: &str) -> String {
    let (status, value) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{value}");
    value["id"].as_str().unwrap().to_owned()
}

async fn list(app: &TestApp, host: &str, token: &str, query: &str) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/patients?{query}"),
        Some(token),
        None,
    )
    .await
}

fn ids(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_owned())
        .collect()
}

/// The page's ids that are in `mine`, in page order.
fn only(page: &Value, mine: &[String]) -> Vec<String> {
    ids(page)
        .into_iter()
        .filter(|id| mine.contains(id))
        .collect()
}

/// Five patients registered in this order; the first two registered two months ago, and three
/// have a last visit (the second is the latest, the fourth the earliest).
async fn five(app: &TestApp, owner: &str) -> Vec<String> {
    let mut made = Vec::new();
    for name in [
        "Dev Mehta",
        "asha Verma",
        "Chitra Rao",
        "Bala Iyer",
        "Esha Nair",
    ] {
        made.push(register(app, ALPHA, owner, name).await);
    }
    for (index, visit) in [(0, "2026-01-02"), (1, "2026-01-03"), (3, "2026-01-01")] {
        sqlx::query(
            "update aarogyam.patients set last_visit_at = $1::timestamptz where id = $2::uuid",
        )
        .bind(format!("{visit}T10:00:00Z"))
        .bind(&made[index])
        .execute(&app.owner)
        .await
        .unwrap();
    }
    // The row-meta trigger would put created_at back; switch it off for the backdating.
    sqlx::query("alter table aarogyam.patients disable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    for index in [0, 1] {
        sqlx::query("update aarogyam.patients set created_at = now() - interval '60 days' where id = $1::uuid")
            .bind(&made[index])
            .execute(&app.owner)
            .await
            .unwrap();
    }
    sqlx::query("alter table aarogyam.patients enable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    made
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn every_sort_and_direction_orders_the_whole_list() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let m = five(&app, &owner).await;
    let pick = |order: [usize; 5]| order.iter().map(|i| m[*i].clone()).collect::<Vec<_>>();

    let by = |query: &'static str| {
        let (app, owner, m) = (&app, &owner, &m);
        async move {
            let (status, page) = list(app, ALPHA, owner, &format!("{query}&limit=50")).await;
            assert_eq!(status, StatusCode::OK, "{page}");
            only(&page, m)
        }
    };
    // Names, case-blind: asha, Bala, Chitra, Dev, Esha.
    assert_eq!(by("sort=name").await, pick([1, 3, 2, 0, 4]));
    assert_eq!(by("sort=name&dir=asc").await, pick([1, 3, 2, 0, 4]));
    assert_eq!(by("sort=name&dir=desc").await, pick([4, 0, 2, 3, 1]));
    // Numbers follow registration.
    assert_eq!(by("sort=number").await, pick([0, 1, 2, 3, 4]));
    assert_eq!(by("sort=number&dir=desc").await, pick([4, 3, 2, 1, 0]));
    // Newest registration first by default.
    assert_eq!(by("").await, pick([4, 3, 2, 1, 0]));
    assert_eq!(by("sort=recent").await, pick([4, 3, 2, 1, 0]));
    assert_eq!(by("sort=recent&dir=asc").await, pick([0, 1, 2, 3, 4]));
    // Last visit: the dated ones in order, patients never seen last whichever way.
    let asc = by("sort=last_visit&dir=asc").await;
    assert_eq!(asc[..3], pick([3, 0, 1, 0, 0])[..3]);
    assert_eq!(asc[3..].len(), 2);
    let desc = by("sort=last_visit").await;
    assert_eq!(desc[..3], pick([1, 0, 3, 0, 0])[..3]);
    assert!(desc[3..].contains(&m[2]) && desc[3..].contains(&m[4]));
    assert!(asc[3..].contains(&m[2]) && asc[3..].contains(&m[4]));
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn offset_paging_has_no_duplicates_or_gaps() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    five(&app, &owner).await;
    for sort in ["name", "number", "recent", "last_visit"] {
        let (_, whole) = list(&app, ALPHA, &owner, &format!("sort={sort}&limit=50")).await;
        let total = whole["total"].as_i64().unwrap();
        assert_eq!(usize::try_from(total).unwrap(), ids(&whole).len());
        assert_eq!(whole["has_more"], false);
        let mut seen = Vec::new();
        let mut offset = 0;
        loop {
            let (status, page) = list(
                &app,
                ALPHA,
                &owner,
                &format!("sort={sort}&limit=2&offset={offset}"),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{page}");
            assert_eq!(page["total"], total, "{sort}: {page}");
            seen.extend(ids(&page));
            offset += 2;
            if page["has_more"] == false {
                break;
            }
            assert!(offset < 100, "paging never ended");
        }
        assert_eq!(seen, ids(&whole), "{sort}");
    }
    // Past the end: nothing, no more, and no total to report.
    let (status, page) = list(&app, ALPHA, &owner, "offset=10000").await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(ids(&page), Vec::<String>::new());
    assert_eq!(page["has_more"], false);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn filters_combine_with_sort_and_paging() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let m = five(&app, &owner).await;
    // The first two were registered two months ago, so "new this month" leaves the other three.
    let new = [m[2].clone(), m[3].clone(), m[4].clone()];
    let (status, page) = list(
        &app,
        ALPHA,
        &owner,
        "new_this_month=true&sort=name&limit=50",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(ids(&page).iter().filter(|id| m.contains(id)).count(), 3);
    assert_eq!(only(&page, &m), [m[3].clone(), m[2].clone(), m[4].clone()]);
    let (_, page) = list(
        &app,
        ALPHA,
        &owner,
        "new_this_month=true&sort=name&dir=desc&limit=2&offset=1",
    )
    .await;
    assert!(ids(&page).iter().all(|id| !m[..2].contains(id)));
    let (_, whole) = list(
        &app,
        ALPHA,
        &owner,
        "new_this_month=true&sort=name&dir=desc&limit=50",
    )
    .await;
    assert_eq!(ids(&page), ids(&whole)[1..3]);
    assert_eq!(page["total"], whole["total"]);
    assert!(new.iter().all(|id| ids(&whole).contains(id)));
    // A filter nobody passes is an empty page.
    let (_, none) = list(&app, ALPHA, &owner, "recalls_due=true&sort=number").await;
    assert_eq!(ids(&none), Vec::<String>::new());
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_sort_values_are_a_400_naming_the_field() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    for (query, field) in [
        ("sort=age", "sort"),
        ("sort=name&dir=up", "dir"),
        ("offset=-1", "offset"),
        ("offset=10001", "offset"),
        ("limit=0", "limit"),
        ("limit=51", "limit"),
        ("offset=abc", "offset"),
    ] {
        let (status, body) = list(&app, ALPHA, &owner, query).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}: {body}");
        let message = body["error"]["message"].as_str().unwrap();
        assert!(message.contains(field), "{query}: {body}");
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinics_patients_never_appear() {
    let app = TestApp::start().await;
    let (alpha, beta) = (app.token(ALPHA_OWNER), app.token(BETA_OWNER));
    let mine = five(&app, &alpha).await;
    let mut theirs = Vec::new();
    for name in ["Aaron Beta", "Zed Beta", "Mina Beta"] {
        theirs.push(register(&app, BETA, &beta, name).await);
    }
    for sort in ["name", "number", "recent", "last_visit"] {
        for dir in ["asc", "desc"] {
            let (status, page) = list(
                &app,
                ALPHA,
                &alpha,
                &format!("sort={sort}&dir={dir}&limit=50"),
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{page}");
            let got = ids(&page);
            assert!(mine.iter().all(|id| got.contains(id)));
            assert!(theirs.iter().all(|id| !got.contains(id)), "{sort} {dir}");
            let (_, theirs_page) = list(
                &app,
                BETA,
                &beta,
                &format!("sort={sort}&dir={dir}&limit=50"),
            )
            .await;
            assert!(ids(&theirs_page).iter().all(|id| !mine.contains(id)));
        }
    }
}
