//! The current clinic and the signed-in member, read inside a clinic transaction.

use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// What the portal needs to know about the clinic it is running in.
#[derive(Debug, Clone)]
pub struct ClinicProfile {
    /// The clinic.
    pub id: Uuid,
    /// Its subdomain.
    pub slug: String,
    /// Its name.
    pub name: String,
    /// Patient-number prefix, such as `SD`.
    pub number_prefix: String,
    /// IANA time zone, such as `Asia/Kolkata`.
    pub timezone: String,
    /// Branding settings (brand colour, theme mode), as stored.
    pub branding: serde_json::Value,
}

/// The current clinic's profile; `None` only if the clinic transaction has no clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn profile(conn: &mut PgConnection) -> Result<Option<ClinicProfile>, DbError> {
    let row = sqlx::query_as!(
        ClinicProfile,
        r#"select o.id, o.slug, o.name, o.number_prefix, o.timezone,
                  coalesce(s.branding, '{}'::jsonb) as "branding!"
           from aarogyam.organizations o
           left join aarogyam.org_settings s on s.org_id = o.id
           where o.id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The current clinic's profile and the member's display name, in one round trip; `None` only
/// if the clinic transaction has no clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn session(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Option<(ClinicProfile, Option<String>)>, DbError> {
    let row = sqlx::query!(
        r#"select o.id, o.slug, o.name, o.number_prefix, o.timezone,
                  coalesce(s.branding, '{}'::jsonb) as "branding!",
                  (select u.display_name from aarogyam.users u where u.id = $1) as display_name
           from aarogyam.organizations o
           left join aarogyam.org_settings s on s.org_id = o.id
           where o.id = app.tenant_id()"#,
        user_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| {
        (
            ClinicProfile {
                id: row.id,
                slug: row.slug,
                name: row.name,
                number_prefix: row.number_prefix,
                timezone: row.timezone,
                branding: row.branding,
            },
            row.display_name,
        )
    }))
}

/// The signed-in member's display name, visible to them inside their clinic.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn display_name(
    conn: &mut PgConnection,
    user_id: Uuid,
) -> Result<Option<String>, DbError> {
    let name = sqlx::query_scalar!(
        r#"select display_name from aarogyam.users where id = $1"#,
        user_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(name)
}
