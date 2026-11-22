//! The patient's history page: every visit within reach as a rich card (teeth, X-rays, the
//! note's first line, medicines, bills, plans), plus the files that belong to no visit. One
//! statement per section for the whole page, so the cost doesn't grow with the visit count.

use std::collections::HashMap;

use aarogyam_dal::history as dal;
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::billing::InvoiceStatus;
use aarogyam_domain::clinical::{EncounterStatus, NoteBody, PlanStatus};
use aarogyam_domain::dental::{Finding, Tooth};
use aarogyam_domain::ids::{
    AttachmentId, EncounterId, InvoiceId, MembershipId, PatientId, TreatmentPlanId,
};
use aarogyam_domain::permission::Permission;
use sakalya_db::Db;
use sakalya_types::Paise;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::chart::{self, ChartEntryView};
use crate::error::AppError;
use crate::scope::staff_scope as scope;
use crate::visits::{self, Member};

/// Most visits one page returns: the whole history of nearly every patient, so search and
/// filters see everything without asking the server again.
pub const MAX_PAGE: i64 = 200;
/// Images shown on a card; the rest are counted.
pub const CARD_IMAGES: usize = 4;
/// Files outside any visit listed on the first page.
pub const MAX_LOOSE_FILES: i64 = 50;
/// Characters of a note's first line.
pub const FIRST_LINE_CHARS: usize = 120;

/// Where the next page starts: strictly older than this visit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cursor {
    /// The last listed visit's start.
    pub started_at: OffsetDateTime,
    /// The last listed visit, to break ties between visits that started together.
    pub id: EncounterId,
}

/// What happened to a tooth in a visit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToothWork {
    /// A finding with no treatment.
    Found,
    /// Treatment planned.
    Planned,
    /// Treatment started, more sittings to come.
    InProgress,
    /// Treatment done.
    Done,
    /// Work done at another clinic, told to us in this visit.
    Elsewhere,
}

impl ToothWork {
    /// The wire value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Found => "found",
            Self::Planned => "planned",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Elsewhere => "elsewhere",
        }
    }
}

/// A tooth touched in a visit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryTooth {
    /// The tooth.
    pub tooth: Tooth,
    /// The chart finding, for chart entries.
    pub finding: Option<Finding>,
    /// The procedure's id in the dental vocabulary, for chart entries that name one.
    pub procedure_key: Option<String>,
    /// What the clinician reads: the procedure's label or name; none for a bare finding.
    pub label: Option<String>,
    /// What happened.
    pub work: ToothWork,
}

/// A file on a card, or one outside any visit.
#[derive(Debug, Clone)]
pub struct HistoryFile {
    /// The file.
    pub id: AttachmentId,
    /// `photo`, `xray`, `report` or `document`.
    pub kind: String,
    /// Its content type, so only images ask for a preview.
    pub mime_type: String,
    /// Its tag.
    pub label: Option<String>,
    /// When it was added.
    pub created_at: OffsetDateTime,
}

/// A bill of a visit.
#[derive(Debug, Clone)]
pub struct HistoryBill {
    /// The bill.
    pub id: InvoiceId,
    /// Its number once issued.
    pub number: Option<String>,
    /// Draft or issued.
    pub status: InvoiceStatus,
    /// The total.
    pub total: Paise,
    /// Received against it.
    pub paid: Paise,
}

/// A plan proposed in a visit.
#[derive(Debug, Clone)]
pub struct HistoryPlan {
    /// The plan.
    pub id: TreatmentPlanId,
    /// Its title.
    pub title: String,
    /// Where it stands.
    pub status: PlanStatus,
}

/// What a visit holds besides its card lines.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HistoryCounts {
    /// Signed notes.
    pub notes: usize,
    /// Voice recordings.
    pub recordings: usize,
    /// Files other than recordings and consent scans.
    pub files: usize,
    /// Procedures.
    pub procedures: usize,
}

/// One visit on the history page.
#[derive(Debug, Clone)]
pub struct HistoryVisit {
    /// The visit.
    pub id: EncounterId,
    /// Its number.
    pub number: String,
    /// Open or closed.
    pub status: EncounterStatus,
    /// When it started.
    pub started_at: OffsetDateTime,
    /// When it ended.
    pub ended_at: Option<OffsetDateTime>,
    /// The clinician.
    pub clinician: Member,
    /// Why the patient came, as typed when the visit started (the visit detail shows the same).
    pub chief_complaint: Option<String>,
    /// Teeth touched, in the order recorded.
    pub teeth: Vec<HistoryTooth>,
    /// The first images (photos and X-rays).
    pub images: Vec<HistoryFile>,
    /// All images in the visit.
    pub image_count: usize,
    /// The first line of the first signed note, at most [`FIRST_LINE_CHARS`] characters.
    pub note_first_line: Option<String>,
    /// Medicines prescribed, in order.
    pub medicines: Vec<String>,
    /// The visit's bills; `None` when the caller may not see money.
    pub bills: Option<Vec<HistoryBill>>,
    /// Plans proposed in the visit.
    pub plans: Vec<HistoryPlan>,
    /// What else it holds.
    pub counts: HistoryCounts,
}

/// A page of the patient's history.
#[derive(Debug, Clone)]
pub struct HistoryPage {
    /// Visits, newest first.
    pub visits: Vec<HistoryVisit>,
    /// Files that belong to no visit, newest first; only on the first page.
    pub loose_files: Vec<HistoryFile>,
    /// Where the next page starts; `None` on the last page.
    pub next: Option<Cursor>,
}

/// The patient's history, newest first, and writes the access record.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic or out of reach.
#[expect(
    clippy::too_many_lines,
    reason = "one statement per section, folded into the cards in one pass"
)]
pub async fn page(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    before: Option<Cursor>,
    limit: i64,
) -> Result<HistoryPage, AppError> {
    actor.require(Permission::ClinicalRead)?;
    let limit = limit.clamp(1, MAX_PAGE);
    // Money stays with billing.read, and never with Sakalya support (money totals stay hidden).
    let money = actor.require(Permission::BillingRead).is_ok() && actor.support_grant.is_none();
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalRead);
        let member = reach.member();
        let patient = visits::require_patient(tx, patient_id, reach).await?;
        // The timeline's resource: `access_log.resource` has no `history` value, and the page
        // reads the same record.
        visits::record_access(tx, actor, request_id, patient.id, "chart", None, "view").await?;
        let before = before.map(|c| (c.started_at, c.id.uuid()));
        let mut rows = dal::visits(tx.conn(), patient.id, before, limit + 1, member).await?;
        let more = rows.len() > usize::try_from(limit).unwrap_or(usize::MAX);
        rows.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
        let next = rows.last().filter(|_| more).map(|row| Cursor {
            started_at: row.started_at,
            id: EncounterId::from_uuid(row.id),
        });
        let loose_files = if before.is_none() {
            dal::loose_files(tx.conn(), patient.id, MAX_LOOSE_FILES, member)
                .await?
                .into_iter()
                .map(file)
                .collect()
        } else {
            Vec::new()
        };
        if rows.is_empty() {
            return Ok(HistoryPage {
                visits: Vec::new(),
                loose_files,
                next,
            });
        }
        let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
        let mut cards = Cards::default();
        for note in dal::notes(tx.conn(), &ids, member).await? {
            let card = cards.at(note.encounter_id);
            card.counts.notes += 1;
            if card.note_first_line.is_none() {
                card.note_first_line = serde_json::from_value::<NoteBody>(note.body)
                    .ok()
                    .and_then(|body| first_line(&body));
            }
        }
        for entry in current(chart::of_visits(tx, &ids, member).await?) {
            if let Some(visit) = entry.visit_id {
                cards.at(visit.uuid()).teeth.push(chart_tooth(&entry));
            }
        }
        for row in dal::procedures(tx.conn(), &ids, member).await? {
            let card = cards.at(row.encounter_id);
            card.counts.procedures += 1;
            if let Some(tooth) = row.tooth.and_then(|t| Tooth::new(i64::from(t)).ok()) {
                let work = if row.status == "planned" {
                    ToothWork::Planned
                } else {
                    ToothWork::Done
                };
                let seen = card
                    .teeth
                    .iter()
                    .any(|t| t.tooth == tooth && t.label.as_deref() == Some(row.name.as_str()));
                if !seen {
                    // The procedure names the work; a bare chart mark of the same finished work on
                    // that tooth would say it twice.
                    let name = row.name.to_lowercase();
                    card.teeth.retain(|t| {
                        !(t.tooth == tooth
                            && t.work == ToothWork::Done
                            && t.label
                                .as_ref()
                                .is_none_or(|l| name.contains(&l.to_lowercase())))
                    });
                    card.teeth.push(HistoryTooth {
                        tooth,
                        finding: None,
                        procedure_key: None,
                        label: Some(row.name),
                        work,
                    });
                }
            }
        }
        for row in dal::files(tx.conn(), &ids, member).await? {
            let Some(visit) = row.encounter_id else {
                continue;
            };
            let card = cards.at(visit);
            match row.kind.as_str() {
                "audio" => card.counts.recordings += 1,
                "consent" | "payment_proof" => {}
                kind => {
                    card.counts.files += 1;
                    if kind == "photo" || kind == "xray" {
                        card.image_count += 1;
                        if card.images.len() < CARD_IMAGES {
                            card.images.push(file(row));
                        }
                    }
                }
            }
        }
        for row in dal::medicines(tx.conn(), &ids, member).await? {
            let card = cards.at(row.encounter_id);
            if !card.medicines.contains(&row.drug_name) {
                card.medicines.push(row.drug_name);
            }
        }
        if money {
            for row in dal::bills(tx.conn(), &ids, member).await? {
                let status = InvoiceStatus::parse(&row.status)
                    .map_err(|_| AppError::Internal("a stored bill status is unknown"))?;
                cards.at(row.encounter_id).bills.push(HistoryBill {
                    id: InvoiceId::from_uuid(row.id),
                    number: row.number,
                    status,
                    total: Paise::new(row.total_paise),
                    paid: Paise::new(row.paid_paise),
                });
            }
        }
        for row in dal::plans(tx.conn(), &ids, member).await? {
            let status = PlanStatus::parse(&row.status)
                .map_err(|_| AppError::Internal("a stored plan status is unknown"))?;
            cards.at(row.encounter_id).plans.push(HistoryPlan {
                id: TreatmentPlanId::from_uuid(row.id),
                title: row.title,
                status,
            });
        }
        let visits = rows
            .into_iter()
            .map(|row| {
                let card = cards.0.remove(&row.id).unwrap_or_default();
                Ok(HistoryVisit {
                    id: EncounterId::from_uuid(row.id),
                    number: row.number,
                    status: EncounterStatus::parse(&row.status)
                        .map_err(|_| AppError::Internal("a stored visit status is unknown"))?,
                    started_at: row.started_at,
                    ended_at: row.ended_at,
                    clinician: Member {
                        id: MembershipId::from_uuid(row.clinician_id),
                        name: row.clinician_name.unwrap_or_default(),
                    },
                    chief_complaint: row.chief_complaint.filter(|c| !c.trim().is_empty()),
                    teeth: card.teeth,
                    images: card.images,
                    image_count: card.image_count,
                    note_first_line: card.note_first_line,
                    medicines: card.medicines,
                    bills: money.then_some(card.bills),
                    plans: card.plans,
                    counts: card.counts,
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        Ok(HistoryPage {
            visits,
            loose_files,
            next,
        })
    })
    .await
}

#[derive(Debug, Default)]
struct Card {
    teeth: Vec<HistoryTooth>,
    images: Vec<HistoryFile>,
    image_count: usize,
    note_first_line: Option<String>,
    medicines: Vec<String>,
    bills: Vec<HistoryBill>,
    plans: Vec<HistoryPlan>,
    counts: HistoryCounts,
}

#[derive(Debug, Default)]
struct Cards(HashMap<Uuid, Card>);

impl Cards {
    fn at(&mut self, visit: Uuid) -> &mut Card {
        self.0.entry(visit).or_default()
    }
}

fn file(row: dal::FileRow) -> HistoryFile {
    HistoryFile {
        id: AttachmentId::from_uuid(row.id),
        kind: row.kind,
        mime_type: row.mime_type,
        label: row.label,
        created_at: row.created_at,
    }
}

/// Current entries only: a correction replaces the entry it supersedes, and a clear is not news.
fn current(entries: Vec<ChartEntryView>) -> Vec<ChartEntryView> {
    let replaced: Vec<_> = entries.iter().filter_map(|e| e.supersedes_id).collect();
    entries
        .into_iter()
        .filter(|e| !replaced.contains(&e.id))
        .filter(|e| !(e.finding == Finding::Sound && e.supersedes_id.is_some()))
        .filter(|e| e.finding != Finding::Sound || e.procedure.is_some())
        .collect()
}

fn chart_tooth(entry: &ChartEntryView) -> HistoryTooth {
    let work = if entry.elsewhere {
        ToothWork::Elsewhere
    } else if entry.in_progress {
        ToothWork::InProgress
    } else if entry.status == "planned" {
        ToothWork::Planned
    } else if entry.procedure.is_some() || is_work(entry.finding) {
        ToothWork::Done
    } else {
        ToothWork::Found
    };
    HistoryTooth {
        tooth: entry.tooth,
        finding: Some(entry.finding),
        procedure_key: entry.procedure.as_ref().map(|t| t.id.clone()),
        label: entry.procedure.as_ref().map(|t| t.label.clone()),
        work,
    }
}

/// Findings that record finished work rather than a problem, when charted in the visit.
const fn is_work(finding: Finding) -> bool {
    matches!(
        finding,
        Finding::Filled | Finding::Crown | Finding::RootCanal | Finding::Implant
    )
}

/// The note's first line to read on a card: the first non-empty line in section order, without
/// a voice line's `[HH:MM]` stamp or a list marker, cut at [`FIRST_LINE_CHARS`] characters.
#[must_use]
pub fn first_line(body: &NoteBody) -> Option<String> {
    [
        &body.subjective,
        &body.objective,
        &body.assessment,
        &body.plan,
    ]
    .into_iter()
    .flatten()
    .flat_map(|section| section.lines())
    .map(clean_line)
    .find(|line| !line.is_empty())
    .map(|line| {
        if line.chars().count() > FIRST_LINE_CHARS {
            let cut: String = line.chars().take(FIRST_LINE_CHARS - 1).collect();
            format!("{}…", cut.trim_end())
        } else {
            line.to_owned()
        }
    })
}

fn clean_line(line: &str) -> &str {
    let mut line = line.trim();
    // `[09:41] ` stamps a spoken or typed line in the subjective section.
    if line.len() > 8
        && line.as_bytes().first() == Some(&b'[')
        && line.as_bytes().get(6) == Some(&b']')
        && line.get(1..6).is_some_and(|t| {
            t.bytes().enumerate().all(|(i, b)| {
                if i == 2 {
                    b == b':'
                } else {
                    b.is_ascii_digit()
                }
            })
        })
    {
        line = line.get(7..).unwrap_or_default().trim_start();
    }
    for marker in ["- ", "* ", "# ", "## ", "### "] {
        if let Some(rest) = line.strip_prefix(marker) {
            return rest.trim();
        }
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(subjective: Option<&str>, assessment: Option<&str>) -> NoteBody {
        NoteBody {
            subjective: subjective.map(str::to_owned),
            objective: None,
            assessment: assessment.map(str::to_owned),
            plan: None,
        }
    }

    #[test]
    fn the_first_line_skips_blanks_stamps_and_markers() {
        assert_eq!(
            first_line(&body(Some("\n[09:41] Pain on biting\nmore"), None)).as_deref(),
            Some("Pain on biting")
        );
        assert_eq!(
            first_line(&body(None, Some("- Deep caries 36"))).as_deref(),
            Some("Deep caries 36")
        );
        assert_eq!(first_line(&body(Some("  \n"), None)), None);
    }

    #[test]
    fn the_first_line_is_cut_at_120_characters() {
        let long = "é".repeat(300);
        let line = first_line(&body(Some(&long), None)).unwrap();
        assert_eq!(line.chars().count(), FIRST_LINE_CHARS);
        assert!(line.ends_with('…'));
    }
}
