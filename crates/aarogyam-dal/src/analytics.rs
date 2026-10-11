//! The figures behind the owner's Analytics page, read in one statement. Takes the connection
//! of an open clinic transaction.
//!
//! A visit is an appointment that isn't deleted, cancelled, a no-show or an unconfirmed online
//! request. A chair's booked time also counts no-shows: the chair was held for them.

use sakalya_db::DbError;
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

/// What [`analytics`] reads.
#[derive(Debug, Clone, Copy)]
pub struct AnalyticsQuery<'a> {
    /// The clinic's IANA time zone.
    pub timezone: &'a str,
    /// `month` or `week`, as Postgres' `date_trunc` names them.
    pub bucket: &'a str,
    /// First clinic day.
    pub from: Date,
    /// Last clinic day, included.
    pub to: Date,
    /// The instant `from` starts.
    pub start: OffsetDateTime,
    /// The instant after `to` ends.
    pub end: OffsetDateTime,
    /// Whether to read money: payments, expenses and stock purchases.
    pub money: bool,
}

/// Booked minutes on a chair in a period.
#[derive(Debug, Clone)]
pub struct ChairPeriod {
    /// The period's first day.
    pub period: Date,
    /// The chair.
    pub room_id: Uuid,
    /// Its name.
    pub name: String,
    /// Its branch.
    pub branch_id: Option<Uuid>,
    /// Booked minutes.
    pub minutes: i64,
    /// Appointments.
    pub appointments: i64,
}

/// A chair the clinic has now.
#[derive(Debug, Clone)]
pub struct Chair {
    /// The chair.
    pub room_id: Uuid,
    /// Its name.
    pub name: String,
    /// Its branch.
    pub branch_id: Option<Uuid>,
}

/// Minutes a branch is open on a weekday, from its opening hours.
#[derive(Debug, Clone, Copy)]
pub struct OpenDay {
    /// The branch.
    pub branch_id: Uuid,
    /// ISO weekday, 1 Monday to 7 Sunday.
    pub weekday: i64,
    /// Minutes open.
    pub minutes: i64,
}

/// An amount in a period, with a count.
#[derive(Debug, Clone)]
pub struct PeriodAmount {
    /// The period's first day.
    pub period: Date,
    /// A category key, for expenses.
    pub key: Option<String>,
    /// Paise.
    pub amount_paise: i64,
    /// How many rows.
    pub count: i64,
}

/// Patients seen in a period.
#[derive(Debug, Clone, Copy)]
pub struct PatientPeriod {
    /// The period's first day.
    pub period: Date,
    /// Whose first visit ever was in this period.
    pub new: i64,
    /// Who had visited before it.
    pub returning: i64,
}

/// A count under a key.
#[derive(Debug, Clone)]
pub struct KeyCount {
    /// The key: an appointment kind or a referral source kind (`None` when not recorded).
    pub key: Option<String>,
    /// How many.
    pub count: i64,
}

/// Booked chair minutes under an appointment kind.
#[derive(Debug, Clone)]
pub struct KindMinutes {
    /// The appointment kind.
    pub key: Option<String>,
    /// Booked minutes on chairs, no-shows included.
    pub minutes: i64,
}

/// Patients seen in the range by age in whole years on the last day.
#[derive(Debug, Clone, Copy)]
pub struct AgeCount {
    /// Age in years; `None` without a date of birth.
    pub years: Option<i64>,
    /// How many patients.
    pub count: i64,
}

/// Visits starting in an hour of a weekday, in clinic time.
#[derive(Debug, Clone, Copy)]
pub struct HourCount {
    /// ISO weekday, 1 Monday to 7 Sunday.
    pub weekday: i64,
    /// Hour of the day, 0 to 23.
    pub hour: i64,
    /// Visits.
    pub count: i64,
}

/// Everything [`analytics`] returns. Money lists are empty unless asked for.
#[derive(Debug, Clone, Default)]
pub struct AnalyticsRows {
    /// Active chairs.
    pub chairs: Vec<Chair>,
    /// Booked minutes per chair and period.
    pub chair_periods: Vec<ChairPeriod>,
    /// Payments received (not void) per period.
    pub income: Vec<PeriodAmount>,
    /// Expenses recorded (not void) per period and category key.
    pub expenses: Vec<PeriodAmount>,
    /// Stock received per period, at cost.
    pub stock: Vec<PeriodAmount>,
    /// New and returning patients per period.
    pub patients: Vec<PatientPeriod>,
    /// Patients seen, by age.
    pub ages: Vec<AgeCount>,
    /// Visits by appointment kind.
    pub visit_kinds: Vec<KeyCount>,
    /// Patients whose first visit was in the range, by referral source kind.
    pub referrals: Vec<KeyCount>,
    /// Visits by weekday and hour.
    pub busy_hours: Vec<HourCount>,
    /// Opening minutes per branch and weekday; empty when no hours are set.
    pub open_days: Vec<OpenDay>,
    /// Lab orders received back in the range, and their minutes from sent to received.
    pub lab_received: LabTurnaround,
    /// Patients seen, by recorded sex.
    pub sexes: Vec<KeyCount>,
    /// Procedures done, by the category of the bill line that charged them (`None`: not billed
    /// yet or no category).
    pub procedures: Vec<KeyCount>,
    /// Booked chair minutes by appointment kind.
    pub chair_kinds: Vec<KindMinutes>,
    /// Visits that were booked appointments, and walk-in tokens that were not.
    pub booked_visits: i64,
    /// Walk-in tokens in the range (not those who left without being seen).
    pub walk_ins: i64,
}

/// Lab orders received back in a range.
#[derive(Debug, Clone, Copy, Default)]
pub struct LabTurnaround {
    /// How many.
    pub orders: i64,
    /// Their minutes at the lab, added up.
    pub total_minutes: i64,
}

/// The analytics figures for `query`, in one round trip.
///
/// # Errors
/// [`DbError`] on a database failure.
#[expect(
    clippy::too_many_lines,
    reason = "one statement and the match that sorts its rows"
)]
pub async fn analytics(
    conn: &mut PgConnection,
    query: &AnalyticsQuery<'_>,
) -> Result<AnalyticsRows, DbError> {
    let rows = sqlx::query!(
        r#"with booked as (
             select a.patient_id, a.room_id, a.kind, a.status, a.starts_at, a.ends_at,
                    a.starts_at at time zone $1 as local_start
             from aarogyam.appointments a
             where a.deleted_at is null and a.status not in ('cancelled', 'requested')
               and a.starts_at >= $5 and a.starts_at < $6
           ), visits as (
             select * from booked where status <> 'no_show'
           ), firsts as (
             select a.patient_id, min(a.starts_at) as first_at
             from aarogyam.appointments a
             where a.deleted_at is null and a.status not in ('cancelled', 'requested', 'no_show')
               and a.starts_at < $6
               and a.patient_id in (select patient_id from visits)
             group by a.patient_id
           )
           select 'chair'::text as "kind!", date_trunc($2, b.local_start)::date as period,
                  r.id::text as key, r.name as label,
                  sum(extract(epoch from b.ends_at - b.starts_at) / 60)::bigint as a,
                  count(*)::bigint as b, 0::bigint as c, r.branch_id as branch
           from booked b
           join aarogyam.rooms r on r.id = b.room_id
           where r.kind = 'chair'
           group by 2, 3, 4, 8
           union all
           select 'room', null, r.id::text, r.name, 0, 0, 0, r.branch_id
           from aarogyam.rooms r
           where r.kind = 'chair' and r.active and r.deleted_at is null
           union all
           select 'income', date_trunc($2, m.received_at at time zone $1)::date, null, null,
                  sum(m.amount_paise)::bigint, count(*), 0, null
           from aarogyam.payments m
           where $7 and m.status = 'received' and m.received_at >= $5 and m.received_at < $6
           group by 2
           union all
           select 'expense', date_trunc($2, e.spent_on::timestamp)::date, c.key, null,
                  sum(e.amount_paise)::bigint, count(*), 0, null
           from aarogyam.expenses e
           join aarogyam.expense_categories c on c.org_id = e.org_id and c.id = e.category_id
           where $7 and e.status = 'recorded' and e.spent_on between $3 and $4
           group by 2, 3
           union all
           select 'stock', date_trunc($2, s.received_on::timestamp)::date, null, null,
                  sum(s.received_quantity * s.unit_cost_paise)::bigint, count(*), 0, null
           from aarogyam.stock_batches s
           where $7 and s.received_on between $3 and $4
           group by 2
           union all
           select 'patients', x.period, null, null,
                  count(distinct x.patient_id) filter (where x.first_period = x.period),
                  count(distinct x.patient_id) filter (where x.first_period < x.period), 0, null
           from (select v.patient_id, date_trunc($2, v.local_start)::date as period,
                        date_trunc($2, f.first_at at time zone $1)::date as first_period
                 from visits v join firsts f on f.patient_id = v.patient_id) x
           group by x.period
           union all
           select 'age', null, null, null,
                  extract(year from age($4::date, p.date_of_birth))::bigint, count(*), 0, null
           from aarogyam.patients p
           where p.id in (select patient_id from visits)
           group by 5
           union all
           select 'visit_kind', null, v.kind, null, count(*), 0, 0, null
           from visits v
           group by 3
           union all
           select 'referral', null, s.kind, null, count(*), 0, 0, null
           from firsts f
           join aarogyam.patients p on p.id = f.patient_id
           left join aarogyam.referral_sources s on s.org_id = p.org_id and s.id = p.referral_source_id
           where f.first_at >= $5
           group by 3
           union all
           select 'lab', null, null, null, count(*)::bigint,
                  coalesce(sum(extract(epoch from l.received_at - l.sent_at) / 60), 0)::bigint, 0,
                  null
           from aarogyam.lab_orders l
           where l.received_at >= $5 and l.received_at < $6 and l.sent_at is not null
           union all
           select 'busy', null, null, null, extract(isodow from v.local_start)::bigint,
                  extract(hour from v.local_start)::bigint, count(*), null
           from visits v
           group by 5, 6
           union all
           select 'sex', null, p.sex::text, null, count(*), 0, 0, null
           from aarogyam.patients p
           where p.id in (select patient_id from visits)
           group by 3
           union all
           select 'procedure', null,
                  (select nullif(btrim(ii.category), '') from aarogyam.invoice_items ii
                    where ii.procedure_id = pr.id and ii.category is not null limit 1),
                  null, count(*), 0, 0, null
           from aarogyam.procedures pr
           where pr.status = 'done' and pr.performed_at >= $5 and pr.performed_at < $6
           group by 3
           union all
           select 'chair_kind', null, b.kind::text, null,
                  sum(extract(epoch from b.ends_at - b.starts_at) / 60)::bigint, 0, 0, null
           from booked b
           join aarogyam.rooms r on r.id = b.room_id
           where r.kind = 'chair'
           group by 3
           union all
           select 'booked', null, null, null, count(*), 0, 0, null from visits
           union all
           select 'walk_in', null, null, null, count(*), 0, 0, null
           from aarogyam.queue_tokens t
           where t.appointment_id is null and t.status <> 'left' and t.day between $3 and $4
           union all
           select 'hours', null, null, null, h.weekday::bigint,
                  sum(extract(epoch from h.ends - h.starts) / 60)::bigint, 0, h.branch_id
           from aarogyam.clinic_hours h
           group by 5, 8"#,
        query.timezone,
        query.bucket,
        query.from,
        query.to,
        query.start,
        query.end,
        query.money,
    )
    .fetch_all(conn)
    .await?;
    let mut out = AnalyticsRows::default();
    for row in rows {
        let (a, b, c) = (row.a.unwrap_or(0), row.b.unwrap_or(0), row.c.unwrap_or(0));
        let room_id = row.key.as_deref().and_then(|key| Uuid::parse_str(key).ok());
        match (row.kind.as_str(), row.period) {
            ("chair", Some(period)) => {
                if let (Some(room_id), Some(name)) = (room_id, row.label) {
                    out.chair_periods.push(ChairPeriod {
                        period,
                        room_id,
                        name,
                        branch_id: row.branch,
                        minutes: a,
                        appointments: b,
                    });
                }
            }
            ("room", _) => {
                if let (Some(room_id), Some(name)) = (room_id, row.label) {
                    out.chairs.push(Chair {
                        room_id,
                        name,
                        branch_id: row.branch,
                    });
                }
            }
            (kind @ ("income" | "expense" | "stock"), Some(period)) => {
                let amount = PeriodAmount {
                    period,
                    key: row.key,
                    amount_paise: a,
                    count: b,
                };
                match kind {
                    "income" => out.income.push(amount),
                    "expense" => out.expenses.push(amount),
                    _ => out.stock.push(amount),
                }
            }
            ("patients", Some(period)) => out.patients.push(PatientPeriod {
                period,
                new: a,
                returning: b,
            }),
            ("age", _) => out.ages.push(AgeCount {
                years: row.a,
                count: b,
            }),
            ("visit_kind", _) => out.visit_kinds.push(KeyCount {
                key: row.key,
                count: a,
            }),
            ("referral", _) => out.referrals.push(KeyCount {
                key: row.key,
                count: a,
            }),
            ("sex", _) => out.sexes.push(KeyCount {
                key: row.key,
                count: a,
            }),
            ("procedure", _) => out.procedures.push(KeyCount {
                key: row.key,
                count: a,
            }),
            ("chair_kind", _) => out.chair_kinds.push(KindMinutes {
                key: row.key,
                minutes: a,
            }),
            ("booked", _) => out.booked_visits = a,
            ("walk_in", _) => out.walk_ins = a,
            ("lab", _) => {
                out.lab_received = LabTurnaround {
                    orders: a,
                    total_minutes: b,
                };
            }
            ("busy", _) => out.busy_hours.push(HourCount {
                weekday: a,
                hour: b,
                count: c,
            }),
            ("hours", _) => {
                if let Some(branch_id) = row.branch {
                    out.open_days.push(OpenDay {
                        branch_id,
                        weekday: a,
                        minutes: b,
                    });
                }
            }
            _ => {}
        }
    }
    Ok(out)
}
