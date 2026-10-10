//! The retention report: which records are past their class's retention period. A dry run and
//! nothing else: it reads and reports, and deletes nothing. Run by an operator with the schema
//! owner's connection (`aarogyam retention`), across every clinic.

use aarogyam_dal::retention::{self as dal, Group};
use aarogyam_domain::retention::{Class, Period, adult_born_on_or_before};
use sakalya_db::{Db, DbError};
use time::OffsetDateTime;

/// What one class holds past its retention period.
#[derive(Debug, Clone)]
pub struct ClassReport {
    /// The class.
    pub class: Class,
    /// Its retention period.
    pub period: Period,
    /// Records anchored before this are past retention.
    pub cutoff: OffsetDateTime,
    /// Per clinic.
    pub groups: Vec<Group>,
}

impl ClassReport {
    /// All records of the class past retention, over every clinic.
    #[must_use]
    pub fn total(&self) -> i64 {
        self.groups.iter().map(|group| group.count).sum()
    }
}

/// Every class's records past retention at `now`, with up to `sample` identifiers per clinic
/// and class. Reads only.
///
/// # Errors
/// [`DbError`] on a database failure.
pub async fn report(
    db: &Db,
    now: OffsetDateTime,
    sample: i32,
) -> Result<Vec<ClassReport>, DbError> {
    let mut classes = Vec::with_capacity(Class::ALL.len());
    for &class in Class::ALL {
        let cutoff = class.cutoff(now);
        let groups = match class {
            Class::PatientRecord => {
                dal::patient_records(db.pool(), cutoff, adult_born_on_or_before(now), sample)
                    .await?
            }
            Class::Invoices => dal::invoices(db.pool(), cutoff, sample).await?,
            Class::Outbox => dal::outbox(db.pool(), cutoff, sample).await?,
            Class::Messages => dal::messages(db.pool(), cutoff, sample).await?,
            Class::ShareLinks => dal::share_links(db.pool(), cutoff, sample).await?,
            Class::ImportSessions => dal::import_sessions(db.pool(), cutoff, sample).await?,
            Class::AccessLog => dal::access_log(db.pool(), cutoff, sample).await?,
            Class::AuditEvents => dal::audit_events(db.pool(), cutoff, sample).await?,
            Class::ClinicApplications => {
                dal::clinic_applications(db.pool(), cutoff, sample).await?
            }
            Class::ChatMessages => dal::chat_messages(db.pool(), cutoff, sample).await?,
            Class::LabWork => dal::lab_work(db.pool(), cutoff, sample).await?,
            Class::LabContacts => dal::lab_contacts(db.pool(), cutoff, sample).await?,
            Class::MessageTemplates => dal::message_templates(db.pool(), cutoff, sample).await?,
        };
        classes.push(ClassReport {
            class,
            period: class.period(),
            cutoff,
            groups,
        });
    }
    Ok(classes)
}
