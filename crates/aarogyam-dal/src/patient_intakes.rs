//! The case-paper registration fields (`aarogyam.patient_intakes`): one row per patient,
//! replaced as a whole.

use aarogyam_domain::patient_intake::{PatientIntake, RawIntake};
use sakalya_db::DbError;
use sqlx::PgConnection;
use uuid::Uuid;

/// The patient's intake as stored, as text, or none when never saved.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn get(conn: &mut PgConnection, patient_id: Uuid) -> Result<Option<RawIntake>, DbError> {
    let row = sqlx::query!(
        r#"select blood_group, alt_phone, emergency_contact_name, emergency_contact_phone,
                  referred_by, call_time, occupation, heard_via, heard_via_text,
                  family_doctor_name, family_doctor_phone, family_doctor_address,
                  health_other, pregnant, due_date, nursing
           from aarogyam.patient_intakes where patient_id = $1"#,
        patient_id
    )
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|r| RawIntake {
        blood_group: r.blood_group,
        alt_phone: r.alt_phone,
        emergency_contact_name: r.emergency_contact_name,
        emergency_contact_phone: r.emergency_contact_phone,
        referred_by: r.referred_by,
        call_time: r.call_time,
        occupation: r.occupation,
        heard_via: r.heard_via,
        heard_via_text: r.heard_via_text,
        family_doctor_name: r.family_doctor_name,
        family_doctor_phone: r.family_doctor_phone,
        family_doctor_address: r.family_doctor_address,
        health_other: r.health_other,
        pregnant: r.pregnant,
        due_date: r.due_date.map(|d| d.to_string()),
        nursing: r.nursing,
    }))
}

/// Saves the patient's intake, replacing every field of an earlier one.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn upsert(
    conn: &mut PgConnection,
    patient_id: Uuid,
    intake: &PatientIntake,
) -> Result<(), DbError> {
    let raw = intake.to_raw();
    sqlx::query!(
        r#"insert into aarogyam.patient_intakes
             (patient_id, blood_group, alt_phone, emergency_contact_name, emergency_contact_phone,
              referred_by, call_time, occupation, heard_via, heard_via_text, family_doctor_name,
              family_doctor_phone, family_doctor_address, health_other, pregnant, due_date, nursing)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           on conflict (org_id, patient_id) do update set
             blood_group = excluded.blood_group, alt_phone = excluded.alt_phone,
             emergency_contact_name = excluded.emergency_contact_name,
             emergency_contact_phone = excluded.emergency_contact_phone,
             referred_by = excluded.referred_by, call_time = excluded.call_time,
             occupation = excluded.occupation, heard_via = excluded.heard_via,
             heard_via_text = excluded.heard_via_text,
             family_doctor_name = excluded.family_doctor_name,
             family_doctor_phone = excluded.family_doctor_phone,
             family_doctor_address = excluded.family_doctor_address,
             health_other = excluded.health_other, pregnant = excluded.pregnant,
             due_date = excluded.due_date, nursing = excluded.nursing, updated_at = now()"#,
        patient_id,
        raw.blood_group,
        raw.alt_phone,
        raw.emergency_contact_name,
        raw.emergency_contact_phone,
        raw.referred_by,
        raw.call_time,
        raw.occupation,
        raw.heard_via,
        raw.heard_via_text,
        raw.family_doctor_name,
        raw.family_doctor_phone,
        raw.family_doctor_address,
        raw.health_other,
        raw.pregnant,
        intake.due_date,
        raw.nursing,
    )
    .execute(conn)
    .await?;
    Ok(())
}
