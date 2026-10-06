//! A real API on a fresh database, migrated as a Supabase-shaped owner and queried as the API's
//! own login role, so permission mistakes fail here the way they would on Supabase.
//!
//! Needs `DATABASE_URL` pointing at a local Postgres superuser (the pre-commit hook sets it).
#![expect(
    dead_code,
    reason = "each test binary uses a different part of this shared module"
)]

use std::path::PathBuf;
use std::sync::Arc;

use aarogyam_api::{AppState, DevTokens, Hosts, TokenCheck, router};
use aarogyam_app::files::{Files, LinkSigner, LocalDisk};
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use sakalya_db::{Db, DbConfig};
use sakalya_http::HttpConfig;
use sakalya_testkit::PgRoundTrips;
use secrecy::SecretString;
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::{ConnectOptions as _, Executor as _};
use tower::ServiceExt as _;
use uuid::Uuid;

pub const ALPHA: &str = "alpha.localtest.me";
pub const BETA: &str = "beta.localtest.me";
pub const CONSOLE: &str = "console.localtest.me";
/// The secret the test API signs download links with.
pub const FILE_KEY: &[u8] = b"test-file-signing-key-0123456789abcdef";

/// People in the test seed, by their Supabase Auth id.
pub mod people {
    use uuid::{Uuid, uuid};
    /// Owner of Alpha Dental.
    pub const ALPHA_OWNER: Uuid = uuid!("a0000000-0000-4000-8000-000000000001");
    /// Assistant at Alpha (patients.read, no patients.write, no patients.contact).
    pub const ALPHA_ASSISTANT: Uuid = uuid!("a0000000-0000-4000-8000-000000000002");
    /// Front desk at Alpha (patients.read, write and contact).
    pub const ALPHA_FRONT_DESK: Uuid = uuid!("a0000000-0000-4000-8000-000000000003");
    /// Member of Alpha whose role has no permissions at all.
    pub const ALPHA_NOTHING: Uuid = uuid!("a0000000-0000-4000-8000-000000000004");
    /// Owner of Beta Dental.
    pub const BETA_OWNER: Uuid = uuid!("b0000000-0000-4000-8000-000000000001");
    /// Sakalya platform owner.
    pub const STAFF: Uuid = uuid!("c0000000-0000-4000-8000-000000000001");
    /// Signed in, but a member of nothing.
    pub const STRANGER: Uuid = uuid!("d0000000-0000-4000-8000-000000000001");
}

const SEED: &str = r"
insert into aarogyam.users (id, auth_uid, display_name, email) values
  ('01900000-0000-7000-8000-0000000000a1', 'a0000000-0000-4000-8000-000000000001', 'Asha Owner', 'asha@alpha.test'),
  ('01900000-0000-7000-8000-0000000000a2', 'a0000000-0000-4000-8000-000000000002', 'Arun Assistant', 'arun@alpha.test'),
  ('01900000-0000-7000-8000-0000000000a3', 'a0000000-0000-4000-8000-000000000003', 'Farah Desk', 'farah@alpha.test'),
  ('01900000-0000-7000-8000-0000000000a4', 'a0000000-0000-4000-8000-000000000004', 'Nikhil Nothing', 'nikhil@alpha.test'),
  ('01900000-0000-7000-8000-0000000000b1', 'b0000000-0000-4000-8000-000000000001', 'Bina Owner', 'bina@beta.test'),
  ('01900000-0000-7000-8000-0000000000c1', 'c0000000-0000-4000-8000-000000000001', 'Sakalya Staff', 'staff@sakalya.test'),
  ('01900000-0000-7000-8000-0000000000d1', 'd0000000-0000-4000-8000-000000000001', 'Stranger', 'stranger@example.test');
insert into aarogyam.platform_users (user_id, role) values ('01900000-0000-7000-8000-0000000000c1', 'owner');
do $$
declare
  alpha uuid := app.create_clinic('alpha', 'Alpha Dental', 'AD', 'dental', 'alpha.localtest.me',
                                  '01900000-0000-7000-8000-0000000000a1');
  beta uuid := app.create_clinic('beta', 'Beta Dental', 'BD', 'dental', 'beta.localtest.me',
                                 '01900000-0000-7000-8000-0000000000b1');
begin
  insert into aarogyam.roles (org_id, key, name) values (alpha, 'nothing', 'Nothing');
  insert into aarogyam.memberships (org_id, user_id, role_id, status)
  select alpha, m.user_id, r.id, 'active'
  from (values ('01900000-0000-7000-8000-0000000000a2'::uuid, 'assistant'),
               ('01900000-0000-7000-8000-0000000000a3'::uuid, 'front_desk'),
               ('01900000-0000-7000-8000-0000000000a4'::uuid, 'nothing')) as m(user_id, role_key)
  join aarogyam.roles r on r.org_id = alpha and r.key = m.role_key;
end $$;
";

/// Part of the SQL sakalya-db's pool runs on every released connection, which
/// [`TestApp::counting_db`] counts apart from the request's own statements.
pub const RELEASE_CHECK: &str = "pg_catalog.statement_timestamp()";

/// A running API on its own database.
pub struct TestApp {
    pub router: Router,
    pub tokens: DevTokens,
    pub owner: PgPool,
    admin: PgConnectOptions,
    database: String,
    api_url: String,
    /// Where the test API keeps patient files.
    pub files_dir: PathBuf,
}

/// Advisory lock key shared by every test process that creates databases on this server.
const TEMPLATE_LOCK: i64 = 0x6161_726f_6779_616d; // "aarogyam"

/// A name for the migrated and seeded template of this exact migration set and seed, so a
/// branch with other migrations gets its own template.
fn template_name() -> String {
    use std::hash::{Hash as _, Hasher as _};
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../db/migrations");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "sql"))
        .collect();
    files.sort();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for file in &files {
        file.file_name().hash(&mut hasher);
        std::fs::read(file).unwrap().hash(&mut hasher);
    }
    SEED.hash(&mut hasher);
    format!("aarogyam_test_tpl_{:016x}", hasher.finish())
}

/// Creates `database` as a copy of the migrated, seeded template, building the template first
/// if this migration set has none. Every test process takes the same advisory lock, so only
/// one migrates at a time: migrations change cluster-wide roles, and concurrent runs from
/// several worktrees otherwise fail on their own `lock_timeout`. Copying a template is also
/// much faster than migrating each test database.
async fn create_from_template(admin: &PgConnectOptions, database: &str) {
    let template = template_name();
    // One connection, not a pool: the advisory lock belongs to the session.
    let mut conn = admin.connect().await.unwrap();
    sqlx::query("select pg_advisory_lock($1)")
        .bind(TEMPLATE_LOCK)
        .execute(&mut conn)
        .await
        .unwrap();
    let exists: bool =
        sqlx::query_scalar("select exists (select from pg_database where datname = $1)")
            .bind(&template)
            .fetch_one(&mut conn)
            .await
            .unwrap();
    if !exists {
        sqlx::raw_sql(
            r"do $$ begin create role aarogyam_owner login createrole createdb bypassrls;
               exception when duplicate_object then null; end $$;
              do $$ declare r text; begin
                foreach r in array array['app_user', 'aarogyam_api'] loop
                  if exists (select from pg_roles where rolname = r) then
                    execute format('grant %I to aarogyam_owner with admin true, inherit false, set false', r);
                  end if;
                end loop;
              end $$;",
        )
        .execute(&mut conn)
        .await
        .unwrap();
        // Build under a temporary name and rename at the end, so a failed build never leaves
        // a half-migrated template behind.
        let building = format!("aarogyam_test_build_{}", Uuid::now_v7().simple());
        // Both names are generated here, so they are safe to splice into the statements.
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "create database {building} owner aarogyam_owner"
        )))
        .execute(&mut conn)
        .await
        .unwrap();
        let owner = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(admin.clone().username("aarogyam_owner").database(&building))
            .await
            .unwrap();
        aarogyam_dal::migrate(&owner).await.unwrap();
        sqlx::raw_sql(SEED).execute(&owner).await.unwrap();
        owner.close().await;
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "alter database {building} rename to {template}"
        )))
        .execute(&mut conn)
        .await
        .unwrap();
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "alter database {template} is_template true"
        )))
        .execute(&mut conn)
        .await
        .unwrap();
    }
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "create database {database} owner aarogyam_owner template {template}"
    )))
    .execute(&mut conn)
    .await
    .unwrap();
    sqlx::query("select pg_advisory_unlock($1)")
        .bind(TEMPLATE_LOCK)
        .execute(&mut conn)
        .await
        .unwrap();
}

fn admin_options() -> PgConnectOptions {
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost:5432/postgres".into());
    url.parse::<PgConnectOptions>()
        .unwrap()
        .disable_statement_logging()
}

pub fn dev_tokens() -> DevTokens {
    DevTokens::new(
        "aarogyam-test",
        "authenticated",
        SecretString::from("test-secret-0123456789abcdef0123456789"),
    )
}

fn hosts() -> Hosts {
    Hosts {
        portal_host_template: "{slug}.localtest.me".into(),
        console: CONSOLE.into(),
        app: "app.localtest.me".into(),
    }
}

/// State whose database is never contacted, for tests that stop before the database.
pub fn offline_state(http: HttpConfig) -> AppState {
    let url = SecretString::from("postgres://aarogyam_api@localhost:5432/never_contacted");
    let db = Db::connect_lazy(&DbConfig::new(url)).unwrap();
    AppState::new(db, http, TokenCheck::Dev(dev_tokens()), hosts())
}

/// A router whose database is never contacted.
pub fn offline_router(http: HttpConfig) -> Router {
    router(offline_state(http))
}

impl TestApp {
    /// Creates a database owned by `aarogyam_owner`, migrates it as that owner, seeds it, and
    /// builds the API on the `aarogyam_api` login.
    pub async fn start() -> Self {
        Self::start_with(HttpConfig::default()).await
    }

    pub async fn start_with(http: HttpConfig) -> Self {
        Self::start_configured(http, TokenCheck::Dev(dev_tokens()), |state| state).await
    }

    /// Like [`Self::start_with`], with a change to the state, such as a fake allergy source.
    pub async fn start_custom(http: HttpConfig, adjust: impl FnOnce(AppState) -> AppState) -> Self {
        Self::start_configured(http, TokenCheck::Dev(dev_tokens()), adjust).await
    }

    /// Like [`Self::start_with`], checking tokens with `tokens` and adjusting the state with
    /// `configure` (a fake Supabase admin client, a throttle).
    pub async fn start_configured(
        http: HttpConfig,
        tokens: TokenCheck,
        configure: impl FnOnce(AppState) -> AppState,
    ) -> Self {
        let admin = admin_options();
        let database = format!("aarogyam_test_{}", Uuid::now_v7().simple());
        create_from_template(&admin, &database).await;

        let owner_options = admin.clone().username("aarogyam_owner").database(&database);
        let owner = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(owner_options)
            .await
            .unwrap();

        let api_url = format!(
            "postgres://aarogyam_api@{}:{}/{database}",
            admin.get_host(),
            admin.get_port()
        );
        let db = Db::connect_lazy(&DbConfig::new(SecretString::from(api_url.clone()))).unwrap();
        let files_dir = std::env::temp_dir().join(format!("aarogyam-files-{database}"));
        let files = Files::new(
            Arc::new(LocalDisk::new(&files_dir)),
            LinkSigner::new(FILE_KEY).unwrap(),
        );
        let router = router(configure(
            AppState::new(db, http, tokens, hosts()).with_files(files),
        ));
        Self {
            router,
            tokens: dev_tokens(),
            owner,
            admin,
            database,
            api_url,
            files_dir,
        }
    }

    /// A database handle on the API's login role, for row-level security checks.
    pub fn api_db(&self) -> Db {
        Db::connect_lazy(&DbConfig::new(SecretString::from(self.api_url.clone()))).unwrap()
    }

    /// A database handle on the API's login role whose traffic passes through a proxy that
    /// counts round trips. Build routers on it with [`Self::router_on`].
    pub async fn counting_db(&self) -> (Db, PgRoundTrips) {
        let target = format!("{}:{}", self.admin.get_host(), self.admin.get_port());
        let trips = PgRoundTrips::start(&target)
            .await
            .unwrap()
            .with_marker(RELEASE_CHECK);
        let port = trips.port();
        let url = format!(
            "postgres://aarogyam_api@127.0.0.1:{port}/{}?sslmode=disable",
            self.database
        );
        let db = Db::connect_lazy(&DbConfig::new(SecretString::from(url))).unwrap();
        (db, trips)
    }

    /// A router on its own state (empty caches) over `db`.
    pub fn router_on(&self, db: Db) -> Router {
        let files = Files::new(
            Arc::new(LocalDisk::new(&self.files_dir)),
            LinkSigner::new(FILE_KEY).unwrap(),
        );
        router(
            AppState::new(
                db,
                HttpConfig::default(),
                TokenCheck::Dev(dev_tokens()),
                hosts(),
            )
            .with_files(files),
        )
    }

    /// The id of the seeded clinic with this slug.
    pub async fn clinic_id(&self, slug: &str) -> Uuid {
        sqlx::query_scalar("select id from aarogyam.organizations where slug = $1")
            .bind(slug)
            .fetch_one(&self.owner)
            .await
            .unwrap()
    }

    pub fn token(&self, auth_uid: Uuid) -> String {
        self.tokens.mint(auth_uid).unwrap()
    }

    pub async fn send(
        &self,
        method: Method,
        host: &str,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        send(&self.router, method, host, path, token, body).await
    }

    /// [`Self::send`] with extra headers, such as `Idempotency-Key`.
    pub async fn send_with(
        &self,
        method: Method,
        host: &str,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        headers: &[(&str, &str)],
    ) -> (StatusCode, Value) {
        send_with_headers(&self.router, method, host, path, token, body, headers).await
    }

    /// Uploads `bytes` as the `file` field of a multipart form to a patient's attachments, with
    /// the other form fields given.
    pub async fn upload(
        &self,
        host: &str,
        token: &str,
        patient: &str,
        bytes: &[u8],
        fields: &[(&str, &str)],
    ) -> (StatusCode, Value) {
        const BOUNDARY: &str = "aarogyam-test-boundary";
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
        let request = Request::post(format!("/api/v1/patients/{patient}/attachments"))
            .header("host", host)
            .header("authorization", format!("Bearer {token}"))
            .header(
                "content-type",
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(Body::from(body))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// [`Self::send_with`] that also returns the response headers, such as `ETag`.
    pub async fn send_full(
        &self,
        method: Method,
        host: &str,
        path: &str,
        token: Option<&str>,
        body: Option<Value>,
        headers: &[(&str, &str)],
    ) -> (StatusCode, HeaderMap, Value) {
        send_full(&self.router, method, host, path, token, body, headers).await
    }

    /// Drops the database. Called at the end of each test; a failed test leaves it for inspection.
    pub async fn finish(self) {
        let _ = std::fs::remove_dir_all(&self.files_dir);
        self.owner.close().await;
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(self.admin)
            .await
            .unwrap();
        pool.execute(sqlx::AssertSqlSafe(format!(
            "drop database if exists {} with (force)",
            self.database
        )))
        .await
        .unwrap();
    }
}

pub async fn send(
    router: &Router,
    method: Method,
    host: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    send_with_headers(router, method, host, path, token, body, &[]).await
}

pub async fn send_with_headers(
    router: &Router,
    method: Method,
    host: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> (StatusCode, Value) {
    let (status, _, value) = send_full(router, method, host, path, token, body, headers).await;
    (status, value)
}

/// Sends a request with extra headers and returns the status, response headers and JSON body.
pub async fn send_full(
    router: &Router,
    method: Method,
    host: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
    headers: &[(&str, &str)],
) -> (StatusCode, HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", host);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    if let Some(token) = token {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let request = match body {
        Some(body) => request
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
        None => request.body(Body::empty()).unwrap(),
    };
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let response_headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, response_headers, value)
}
