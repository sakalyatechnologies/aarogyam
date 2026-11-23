//! A doctor's own day in numbers: visits finished, procedures done, prescriptions issued and
//! money collected on their visits' invoices.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// One doctor's figures for a span of time.
#[derive(Debug, Clone, Copy, Default)]
pub struct MyStatsRow {
    /// Appointments of the doctor completed in the span.
    pub patients_seen: i64,
    /// Procedures the member performed in the span.
    pub procedures_done: i64,
    /// Prescriptions the member issued in the span (cancelled ones excluded).
    pub prescriptions_issued: i64,
    /// Paise of payments received in the span, allocated to invoices of the member's visits.
    pub collected_paise: i64,
}

/// The figures for `practitioner_id` (their appointments) and `membership_id` (their own
/// procedures, prescriptions and encounters) over `[start, end)`.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn my_stats(
    conn: &mut PgConnection,
    practitioner_id: Uuid,
    membership_id: Uuid,
    start: OffsetDateTime,
    end: OffsetDateTime,
) -> Result<MyStatsRow, DbError> {
    let row = sqlx::query!(
        r#"select
             (select count(*) from aarogyam.appointments a
               where a.practitioner_id = $1 and a.status = 'completed' and a.deleted_at is null
                 and a.completed_at >= $3 and a.completed_at < $4) as "patients_seen!",
             (select count(*) from aarogyam.procedures p
               where p.clinician_id = $2 and p.status = 'done'
                 and p.performed_at >= $3 and p.performed_at < $4) as "procedures_done!",
             (select count(*) from aarogyam.prescriptions r
               where r.issued_by = $2 and r.status = 'issued'
                 and r.issued_at >= $3 and r.issued_at < $4) as "prescriptions_issued!",
             (select coalesce(sum(al.amount_paise), 0)::bigint
                from aarogyam.payment_allocations al
                join aarogyam.payments m on m.org_id = al.org_id and m.id = al.payment_id
                join aarogyam.invoices i on i.org_id = al.org_id and i.id = al.invoice_id
                join aarogyam.encounters e on e.org_id = i.org_id and e.id = i.encounter_id
               where e.clinician_id = $2 and m.status = 'received'
                 and m.received_at >= $3 and m.received_at < $4) as "collected_paise!""#,
        practitioner_id,
        membership_id,
        start,
        end,
    )
    .fetch_one(conn)
    .await?;
    Ok(MyStatsRow {
        patients_seen: row.patients_seen,
        procedures_done: row.procedures_done,
        prescriptions_issued: row.prescriptions_issued,
        collected_paise: row.collected_paise,
    })
}
