//! The current clinic's settings: the organisation row, `org_settings` and the default branch.
//! Every function takes the connection of an open clinic transaction.

use sakalya_db::DbError;

use crate::schedule::PractitionerRow;
use serde_json::Value;
use sqlx::PgConnection;
use uuid::Uuid;

/// The clinic's settings as stored.
#[derive(Debug, Clone)]
pub struct SettingsRow {
    /// Display name.
    pub name: String,
    /// The clinic's specialty: `dental` or `general`.
    pub specialty: String,
    /// Registered legal name.
    pub legal_name: Option<String>,
    /// GST identification number.
    pub gstin: Option<String>,
    /// IANA time zone.
    pub timezone: String,
    /// Branding (`brand`, `mode`, and keys other screens may add).
    pub branding: Value,
    /// Billing settings (`upi_id`, …).
    pub billing: Value,
    /// Prescription settings (`footer`, …).
    pub prescription: Value,
    /// Online booking settings (`slot_minutes`, `auto_confirm`, …); missing keys use defaults.
    pub booking: Value,
    /// The default branch, if the clinic has one.
    pub branch_id: Option<Uuid>,
    /// The default branch's address (`line1`, `line2`, `city`, `state`, `pincode`).
    pub address: Option<Value>,
    /// The default branch's phone in `E.164`.
    pub phone_e164: Option<String>,
}

/// The current clinic's settings.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection) -> Result<Option<SettingsRow>, DbError> {
    let row = sqlx::query_as!(
        SettingsRow,
        r#"select o.name, o.specialty, o.legal_name, o.gstin, o.timezone, s.branding, s.billing, s.prescription, s.booking,
                  b.id as "branch_id?", b.address as "address?", b.phone_e164
           from aarogyam.organizations o
           join aarogyam.org_settings s on s.org_id = o.id
           left join aarogyam.branches b on b.org_id = o.id and b.is_default and b.deleted_at is null
           where o.id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// The current clinic's settings and its active doctors by name, in one statement.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_with_doctors(
    conn: &mut PgConnection,
) -> Result<Option<(SettingsRow, Vec<PractitionerRow>)>, DbError> {
    let row = sqlx::query!(
        r#"select o.name, o.specialty, o.legal_name, o.gstin, o.timezone, s.branding, s.billing,
                  s.prescription, s.booking, b.id as "branch_id?", b.address as "address?",
                  b.phone_e164,
                  coalesce((
                    select jsonb_agg(to_jsonb(d) order by d.display_name)
                    from (select p.id, p.membership_id, p.display_name, p.registration_number,
                                 p.qualifications, p.specialty, p.calendar_color, p.active
                          from aarogyam.practitioners p
                          where p.deleted_at is null and p.active) d
                  ), '[]'::jsonb) as "doctors!: sqlx::types::Json<Vec<PractitionerRow>>"
           from aarogyam.organizations o
           join aarogyam.org_settings s on s.org_id = o.id
           left join aarogyam.branches b on b.org_id = o.id and b.is_default and b.deleted_at is null
           where o.id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|row| {
        (
            SettingsRow {
                name: row.name,
                specialty: row.specialty,
                legal_name: row.legal_name,
                gstin: row.gstin,
                timezone: row.timezone,
                branding: row.branding,
                billing: row.billing,
                prescription: row.prescription,
                booking: row.booking,
                branch_id: row.branch_id,
                address: row.address,
                phone_e164: row.phone_e164,
            },
            row.doctors.0,
        )
    }))
}

/// The current clinic's settings, locked until the transaction ends so concurrent edits apply
/// one after the other.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get_for_update(conn: &mut PgConnection) -> Result<Option<SettingsRow>, DbError> {
    let row = sqlx::query_as!(
        SettingsRow,
        r#"select o.name, o.specialty, o.legal_name, o.gstin, o.timezone, s.branding, s.billing, s.prescription, s.booking,
                  b.id as "branch_id?", b.address as "address?", b.phone_e164
           from aarogyam.organizations o
           join aarogyam.org_settings s on s.org_id = o.id
           left join aarogyam.branches b on b.org_id = o.id and b.is_default and b.deleted_at is null
           where o.id = app.tenant_id()
           for update of o, s"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(row)
}

/// Saves the settings. The audit triggers record what changed; unchanged rows record nothing.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn save(conn: &mut PgConnection, row: &SettingsRow) -> Result<(), DbError> {
    sqlx::query!(
        r#"update aarogyam.organizations
           set name = $1, legal_name = $2, gstin = $3, timezone = $4
           where id = app.tenant_id()"#,
        row.name,
        row.legal_name,
        row.gstin,
        row.timezone
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query!(
        r#"update aarogyam.org_settings
           set branding = $1, billing = $2, prescription = $3, booking = $4"#,
        row.branding,
        row.billing,
        row.prescription,
        row.booking
    )
    .execute(&mut *conn)
    .await?;
    if let Some(branch_id) = row.branch_id {
        sqlx::query!(
            r#"update aarogyam.branches
               set address = $2, phone_e164 = $3
               where id = $1"#,
            branch_id,
            row.address
                .clone()
                .unwrap_or_else(|| Value::Object(serde_json::Map::new())),
            row.phone_e164
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// The current clinic's online booking settings object, as stored.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn booking(conn: &mut PgConnection) -> Result<Value, DbError> {
    let value = sqlx::query_scalar!(
        r#"select booking as "booking!" from aarogyam.org_settings where org_id = app.tenant_id()"#
    )
    .fetch_optional(conn)
    .await?;
    Ok(value.unwrap_or_else(|| Value::Object(serde_json::Map::new())))
}
