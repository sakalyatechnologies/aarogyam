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
use axum::http::{Method, Request, StatusCode};
use sakalya_db::{Db, DbConfig};
use sakalya_http::HttpConfig;
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
        portal_domain: "localtest.me".into(),
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

    /// Like [`Self::start_with`], checking tokens with `tokens` and adjusting the state with
    /// `configure` (a fake Supabase admin client, a throttle).
    pub async fn start_configured(
        http: HttpConfig,
        tokens: TokenCheck,
        configure: impl FnOnce(AppState) -> AppState,
    ) -> Self {
        let admin = admin_options();
        let conn = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(admin.clone())
            .await
            .unwrap();
        conn.execute(
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
        .await
        .unwrap();
        let database = format!("aarogyam_test_{}", Uuid::now_v7().simple());
        // The name is generated here, so it is safe to splice into the statement.
        conn.execute(sqlx::AssertSqlSafe(format!(
            "create database {database} owner aarogyam_owner"
        )))
        .await
        .unwrap();
        conn.close().await;

        let owner_options = admin.clone().username("aarogyam_owner").database(&database);
        let owner = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(owner_options)
            .await
            .unwrap();
        aarogyam_dal::migrate(&owner).await.unwrap();
        sqlx::raw_sql(SEED).execute(&owner).await.unwrap();

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
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", host);
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
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}
