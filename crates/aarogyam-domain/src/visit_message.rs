//! The visit summary a doctor sends from their own `WhatsApp` (docs/plans/visit-story-design.md,
//! C2), and the aftercare it and the patient's visit page draw from (C6). Both are specialty data
//! in `specialties/dental/` (AGENTS.md rule 11), compiled in and checked by the tests below.
//!
//! Who it goes to ([`Recipient`]), why it can't be prepared ([`Refusal`]), teeth in words
//! ([`tooth_in_words`]), which aftercare fits today's work ([`aftercare_key`]) and the text
//! itself ([`compose`]): pure rules, no I/O.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;
use time::{Date, Month};

use sakalya_types::Paise;

use crate::dental::Tooth;
use crate::patient::BirthDate;
use crate::quick_picks::TextPick;

const MESSAGE_SOURCE: &str = include_str!("../../../specialties/dental/visit-message.json");
const AFTERCARE_SOURCE: &str = include_str!("../../../specialties/dental/aftercare.json");
const TREATMENT_SOURCE: &str = include_str!("../../../specialties/dental/treatment-words.json");
const DIAGNOSIS_SOURCE: &str = include_str!("../../../specialties/dental/diagnosis-words.json");

/// The age from which a patient gets their own summary.
pub const ADULT_AGE: u16 = 18;
/// Most care-at-home steps the message carries; the page shows them all.
pub const CARE_STEPS: usize = 3;
/// Fewest care-at-home lines the message carries; everyday care fills up to it.
const CARE_MIN: usize = 2;
/// Most characters of any one line, so one long entry can't crowd out the rest.
const LINE_MAX: usize = 160;

/// Who the summary goes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recipient {
    /// The patient.
    Patient,
    /// A relative: a minor's guardian or parent, or an adult's primary contact.
    Guardian,
}

impl Recipient {
    /// The value clients see.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Patient => "patient",
            Self::Guardian => "guardian",
        }
    }
}

/// Whether a patient counts as a minor on `today`: under [`ADULT_AGE`] by date of birth. An
/// unknown date of birth counts as an adult.
#[must_use]
pub fn is_minor(date_of_birth: Option<Date>, today: Date) -> bool {
    date_of_birth.is_some_and(|born| BirthDate::Exact(born).age_on(today) < ADULT_AGE)
}

/// Why a summary can't be prepared (`409`, with [`Self::code`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    /// The visit is still open.
    #[error("Close the visit first; the summary is made from the finished visit.")]
    VisitOpen,
    /// Nobody to send it to has a mobile number.
    #[error("There is no mobile number to send this to.")]
    NoPhone,
    /// Consent doesn't allow care messages.
    #[error("The patient hasn't agreed to care messages.")]
    NoConsent,
    /// The recipient opted out of care messages on `WhatsApp`.
    #[error("The patient asked not to get care messages on WhatsApp.")]
    OptedOut,
}

impl Refusal {
    /// The problem code clients branch on.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::VisitOpen => "visit_open",
            Self::NoPhone => "no_phone",
            Self::NoConsent => "no_consent",
            Self::OptedOut => "opted_out",
        }
    }
}

/// An FDI tooth in plain words, such as "lower right back tooth (first molar)" for 46.
#[must_use]
pub fn tooth_in_words(tooth: Tooth) -> String {
    let number = tooth.number();
    let (quadrant, position) = (number / 10, number % 10);
    let jaw_side = match quadrant {
        1 | 5 => "upper right",
        2 | 6 => "upper left",
        3 | 7 => "lower left",
        _ => "lower right",
    };
    let primary = tooth.is_primary();
    let name = match (primary, position) {
        (_, 1) => "central incisor",
        (_, 2) => "lateral incisor",
        (_, 3) => "canine",
        (true, 4) | (false, 6) => "first molar",
        (true, _) | (false, 7) => "second molar",
        (false, 4) => "first premolar",
        (false, 5) => "second premolar",
        (false, _) => "wisdom tooth",
    };
    let front = position <= 3;
    let kind = match (front, primary) {
        (true, false) => "front tooth",
        (false, false) => "back tooth",
        (true, true) => "front milk tooth",
        (false, true) => "back milk tooth",
    };
    format!("{jaw_side} {kind} ({name})")
}

/// Care at home after one kind of treatment.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Aftercare {
    /// Heading, such as "After a tooth removal".
    pub title: String,
    /// What to do, most important first (3 to 6).
    pub steps: Vec<String>,
    /// When to call the clinic.
    pub call_if: String,
}

#[derive(Debug, Deserialize)]
struct AftercareFile {
    items: BTreeMap<String, Aftercare>,
}

fn aftercare_all() -> &'static BTreeMap<String, Aftercare> {
    static ITEMS: OnceLock<BTreeMap<String, Aftercare>> = OnceLock::new();
    ITEMS.get_or_init(|| {
        serde_json::from_str::<AftercareFile>(AFTERCARE_SOURCE)
            .map(|file| file.items)
            .unwrap_or_default()
    })
}

/// The aftercare for `key`, such as `extraction`.
#[must_use]
pub fn aftercare(key: &str) -> Option<&'static Aftercare> {
    aftercare_all().get(key)
}

/// Aftercare keys from most to least important: when a visit did several things, the message's
/// three steps come from the first that applies.
const AFTERCARE_ORDER: [&str; 9] = [
    "wisdom_extraction",
    "extraction",
    "implant",
    "root_canal_between_sittings",
    "root_canal",
    "crown",
    "filling",
    "scaling",
    "whitening",
];

/// A treatment as recorded: its code (a vocabulary or quick-pick id, when coded), name and tooth.
#[derive(Debug, Clone, Copy)]
pub struct Work<'a> {
    /// The code, when coded.
    pub code: Option<&'a str>,
    /// The name as recorded.
    pub name: &'a str,
    /// The tooth, when it concerns one.
    pub tooth: Option<Tooth>,
    /// Started today and not finished, such as a root canal between sittings.
    pub in_progress: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Extraction,
    Wisdom,
    RootCanal,
    Filling,
    Crown,
    Implant,
    Scaling,
    Whitening,
}

fn kind_of(work: &Work<'_>) -> Option<Kind> {
    let code = work.code.unwrap_or("").to_ascii_lowercase();
    let name = work.name.to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|word| name.contains(word));
    let third_molar = work.tooth.is_some_and(|t| t.number() % 10 == 8);
    let kind = match code.as_str() {
        "surgical_extraction" => Some(Kind::Wisdom),
        "extraction" => Some(Kind::Extraction),
        "root_canal" | "rct" | "pulpotomy" => Some(Kind::RootCanal),
        "filling" | "composite_filling" | "core_build_up" | "sealant" => Some(Kind::Filling),
        "crown" | "bridge" | "bridge_abutment" | "bridge_pontic" | "veneer" | "inlay" | "onlay"
        | "post_core" => Some(Kind::Crown),
        "implant" => Some(Kind::Implant),
        "scaling" => Some(Kind::Scaling),
        "whitening" => Some(Kind::Whitening),
        _ => None,
    }
    .or_else(|| {
        if has(&["wisdom", "surgical extraction", "impaction", "disimpaction"]) {
            Some(Kind::Wisdom)
        } else if has(&["extraction", "extract", "removal of tooth"]) {
            Some(Kind::Extraction)
        } else if has(&["implant"]) {
            Some(Kind::Implant)
        } else if has(&["root canal", "rct", "pulpotomy", "pulpectomy"]) {
            Some(Kind::RootCanal)
        } else if has(&["crown", "bridge", "cap", "veneer", "inlay", "onlay"]) {
            Some(Kind::Crown)
        } else if has(&["filling", "restoration", "composite", "gic", "sealant"]) {
            Some(Kind::Filling)
        } else if has(&["scaling", "cleaning", "polish"]) {
            Some(Kind::Scaling)
        } else if has(&["whitening", "bleach"]) {
            Some(Kind::Whitening)
        } else {
            None
        }
    })?;
    Some(if kind == Kind::Extraction && third_molar {
        Kind::Wisdom
    } else {
        kind
    })
}

/// Whether two records are the same treatment on the same tooth: the same code, or the same kind.
#[must_use]
pub fn same_treatment(a: &Work<'_>, b: &Work<'_>) -> bool {
    a.tooth == b.tooth
        && ((a.code.is_some() && a.code == b.code)
            || kind_of(a).is_some_and(|kind| kind_of(b) == Some(kind)))
}

/// The patient's name for a treatment still under way: "Root canal treatment (sitting 4,
/// continuing)".
#[must_use]
pub fn continuing_name(name: &str, sitting: Option<u8>) -> String {
    match sitting {
        Some(sitting) => format!("{name} (sitting {sitting}, continuing)"),
        None => format!("{name} (continuing)"),
    }
}

/// The aftercare key for one treatment done today. A root canal continues when it is marked in
/// progress or another root canal sitting is planned on the same tooth.
#[must_use]
pub fn aftercare_key(work: &Work<'_>, planned: &[Work<'_>]) -> Option<&'static str> {
    Some(match kind_of(work)? {
        Kind::Extraction => "extraction",
        Kind::Wisdom => "wisdom_extraction",
        Kind::RootCanal => {
            let continues = work.in_progress
                || planned
                    .iter()
                    .any(|p| kind_of(p) == Some(Kind::RootCanal) && p.tooth == work.tooth);
            if continues {
                "root_canal_between_sittings"
            } else {
                "root_canal"
            }
        }
        Kind::Filling => "filling",
        Kind::Crown => "crown",
        Kind::Implant => "implant",
        Kind::Scaling => "scaling",
        Kind::Whitening => "whitening",
    })
}

/// The aftercare keys for today's treatments, most important first, each once.
#[must_use]
pub fn aftercare_keys(done: &[Work<'_>], planned: &[Work<'_>]) -> Vec<&'static str> {
    let found: Vec<&str> = done
        .iter()
        .filter_map(|work| aftercare_key(work, planned))
        .collect();
    AFTERCARE_ORDER
        .iter()
        .copied()
        .filter(|key| found.contains(key))
        .collect()
}

/// Where a patient's age puts them for care at home: which general hygiene steps fill the care
/// section, and whether they speak to a parent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgeBand {
    /// Under 6: a parent brushes for them.
    UnderSix,
    /// 6 to 12: a parent helps.
    SixToTwelve,
    /// 13 to 17: still a minor, so the parent is addressed.
    Teen,
    /// 18 or older, or unknown.
    Adult,
}

impl AgeBand {
    /// The aftercare key of the band's general hygiene steps.
    #[must_use]
    pub const fn care_key(self) -> &'static str {
        match self {
            Self::UnderSix => "general_under_6",
            Self::SixToTwelve => "general_6_12",
            Self::Teen => "general_teen",
            Self::Adult => "general_adult",
        }
    }
}

/// The patient's age band on `today` by date of birth; an unknown date of birth counts as an
/// adult, as for [`is_minor`].
#[must_use]
pub fn age_band(date_of_birth: Option<Date>, today: Date) -> AgeBand {
    match date_of_birth.map(|born| BirthDate::Exact(born).age_on(today)) {
        Some(age) if age < 6 => AgeBand::UnderSix,
        Some(age) if age < 13 => AgeBand::SixToTwelve,
        Some(age) if age < ADULT_AGE => AgeBand::Teen,
        _ => AgeBand::Adult,
    }
}

#[derive(Debug, Deserialize)]
struct TreatmentWords {
    procedures: BTreeMap<String, String>,
    why: BTreeMap<String, String>,
    material_today: BTreeMap<String, String>,
}

fn treatment_words() -> Option<&'static TreatmentWords> {
    static WORDS: OnceLock<Option<TreatmentWords>> = OnceLock::new();
    WORDS
        .get_or_init(|| serde_json::from_str(TREATMENT_SOURCE).ok())
        .as_ref()
}

/// The patient's words for a seeded chart procedure, such as "Root canal treatment".
#[must_use]
pub fn procedure_words(id: &str) -> Option<&'static str> {
    treatment_words()?.procedures.get(id).map(String::as_str)
}

#[derive(Debug, Deserialize)]
struct DiagnosisWords {
    chart: BTreeMap<String, String>,
    needs_treatment: String,
    icd10: BTreeMap<String, String>,
    icd11: BTreeMap<String, String>,
}

fn diagnosis_words_file() -> Option<&'static DiagnosisWords> {
    static WORDS: OnceLock<Option<DiagnosisWords>> = OnceLock::new();
    WORDS
        .get_or_init(|| serde_json::from_str(DIAGNOSIS_SOURCE).ok())
        .as_ref()
}

/// The patient's words for a chart finding recorded without a procedure, such as "Decay" for
/// `caries`; none for findings the summary doesn't report.
#[must_use]
pub fn chart_finding_words(finding: &str) -> Option<&'static str> {
    diagnosis_words_file()?
        .chart
        .get(finding)
        .map(String::as_str)
}

/// The words for a tooth given the health level "needs treatment".
#[must_use]
pub fn needs_treatment_words() -> Option<&'static str> {
    diagnosis_words_file().map(|w| w.needs_treatment.as_str())
}

/// The patient's words for a coded condition (`icd10` or `icd11`): the entry for the code or
/// its longest listed prefix (K02 covers K02.1). Free text is never used.
#[must_use]
pub fn diagnosis_words(code_system: &str, code: &str) -> Option<&'static str> {
    let file = diagnosis_words_file()?;
    let map = match code_system {
        "icd10" => &file.icd10,
        "icd11" => &file.icd11,
        _ => return None,
    };
    let code = code.trim().to_ascii_uppercase();
    map.iter()
        .filter(|(key, _)| {
            code.strip_prefix(key.as_str())
                .is_some_and(|rest| rest.is_empty() || rest.starts_with('.') || key.contains('.'))
        })
        .max_by_key(|(key, _)| key.len())
        .map(|(_, words)| words.as_str())
}

/// Findings that explain a treatment when recorded on that tooth (chart finding ids).
const WHY_RECORDED: [&str; 2] = ["caries", "fractured"];
/// Finding chips that explain a treatment, when only one tooth was touched today.
const WHY_CHIPS: [&str; 3] = ["deep_caries", "abscess", "fractured_crown"];

/// Why a tooth was treated, as a `why` key of the treatment words, from recorded facts only: a
/// finding recorded on that tooth before or during the visit (`recorded`), else a finding chip
/// of today's notes (`chips`), but only when exactly one tooth was touched in the chart today
/// (treated, charted, found or given a health level), so the chip can only mean that tooth.
#[must_use]
pub fn why_key<'a>(
    recorded: &[&'a str],
    chips: &[&'a str],
    teeth_touched: usize,
) -> Option<&'a str> {
    recorded
        .iter()
        .find(|finding| WHY_RECORDED.contains(finding))
        .or_else(|| {
            (teeth_touched == 1)
                .then(|| chips.iter().find(|chip| WHY_CHIPS.contains(chip)))
                .flatten()
        })
        .copied()
}

/// The quick picks whose line a note section holds exactly (trimmed, any case), in the note's
/// order and each once. Any other text in the section is never read.
pub fn chip_lines<'a>(section: &str, picks: &'a [TextPick]) -> impl Iterator<Item = &'a TextPick> {
    let mut found: Vec<&TextPick> = Vec::new();
    for line in section.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if let Some(pick) = picks
            .iter()
            .find(|p| p.text.trim().eq_ignore_ascii_case(line))
            && !found.iter().any(|f| f.id == pick.id)
        {
            found.push(pick);
        }
    }
    found.into_iter()
}

/// An FDI tooth in short plain words with its number, such as "upper left front tooth (21)".
#[must_use]
pub fn tooth_short(tooth: Tooth) -> String {
    let number = tooth.number();
    let jaw_side = match number / 10 {
        1 | 5 => "upper right",
        2 | 6 => "upper left",
        3 | 7 => "lower left",
        _ => "lower right",
    };
    let kind = match (number % 10 <= 3, tooth.is_primary()) {
        (true, false) => "front tooth",
        (false, false) => "back tooth",
        (true, true) => "front milk tooth",
        (false, true) => "back milk tooth",
    };
    format!("{jaw_side} {kind} ({number})")
}

#[derive(Debug, Deserialize)]
struct Short {
    greeting: String,
    link: String,
}

#[derive(Debug, Deserialize)]
struct Template {
    language: String,
    max_chars: usize,
    greeting: String,
    greeting_minor: String,
    with_doctor: String,
    intro: String,
    intro_minor: String,
    why: String,
    why_minor: String,
    done: String,
    done_on: String,
    done_plain: String,
    sitting: String,
    continuing: String,
    detail_why: String,
    detail_today: String,
    next_sitting: String,
    next_sitting_on: String,
    next_planned: String,
    exam_teeth: String,
    exam_tooth: String,
    check_up: String,
    consultation: String,
    consultation_with: String,
    visit_only: String,
    visit_only_with: String,
    learn: String,
    found: String,
    within: String,
    within_one: String,
    plan: String,
    recommends: String,
    we_recommend: String,
    estimate: String,
    more_recommended: String,
    care: String,
    medicines: String,
    booked: String,
    follow_up: String,
    more: String,
    days: String,
    one_day: String,
    book: String,
    book_reply: String,
    link: String,
    link_minor: String,
    pin: String,
    warning: String,
    warning_minor: String,
    short: Short,
}

fn template() -> Option<&'static Template> {
    static TEMPLATE: OnceLock<Option<Template>> = OnceLock::new();
    TEMPLATE
        .get_or_init(|| serde_json::from_str(MESSAGE_SOURCE).ok())
        .as_ref()
}

/// A treatment done today, with only the details its record holds.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DoneDetail {
    /// The treatment in patient words ([`procedure_words`]) or the clinic's name for it.
    pub name: String,
    /// The tooth, when it concerns one.
    pub tooth: Option<Tooth>,
    /// The sitting number recorded on the chart entry.
    pub sitting: Option<u8>,
    /// Started today and not finished (`in_progress`).
    pub continuing: bool,
    /// Why, as a `why` key ([`why_key`]); none when nothing on record explains it.
    pub why: Option<String>,
    /// The material stored on today's chart entry (a vocabulary id).
    pub material: Option<String>,
    /// A planned treatment on the same tooth.
    pub next_planned: Option<String>,
}

/// One "What we found" line: a finding in patient words and the teeth it was found on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundLine {
    /// The finding in patient words, such as "Decay".
    pub words: String,
    /// The teeth, in the order found; empty for a finding about the whole mouth.
    pub teeth: Vec<Tooth>,
    /// Treat within this many months (a tooth's health level).
    pub within_months: Option<u8>,
}

/// A recommended treatment: a planned item, with how soon and the estimate when shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecLine {
    /// What is recommended.
    pub name: String,
    /// The tooth, when it concerns one.
    pub tooth: Option<Tooth>,
    /// Within this many months (the tooth's health level), when set.
    pub within_months: Option<u8>,
    /// The estimate, when the clinic shows patients estimates and a price exists.
    pub estimate: Option<Paise>,
}

/// A medicine line: generic name, strength, how often and for how long.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MedicineLine {
    /// Generic name.
    pub generic: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// How often, such as `1-0-1`.
    pub frequency: String,
    /// For how many days.
    pub days: Option<u16>,
}

/// When the plan continues.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NextVisit {
    /// An appointment is booked for this day.
    Booked(Date),
    /// A follow-up falls due on this day.
    Due(Date),
}

/// What the summary is made of. Every field is a recorded fact; free text from notes never
/// reaches it.
#[derive(Debug, Clone)]
pub struct MessageInput<'a> {
    /// The clinic's name.
    pub clinic_name: &'a str,
    /// The doctor's name.
    pub doctor_name: Option<&'a str>,
    /// The patient's full name; only the first word is used.
    pub patient_name: &'a str,
    /// Whether the patient is a minor (parent wording).
    pub minor: bool,
    /// The age band, for general care at home.
    pub age_band: AgeBand,
    /// Why they came: labels of the complaint chips in today's notes.
    pub complaints: &'a [String],
    /// Treatments done today.
    pub done: &'a [DoneDetail],
    /// Distinct teeth charted today, for the check-up line when nothing was treated.
    pub charted_teeth: usize,
    /// What was found today.
    pub found: &'a [FoundLine],
    /// Recommended treatments.
    pub recommend: &'a [RecLine],
    /// When the plan continues.
    pub next_visit: Option<NextVisit>,
    /// Aftercare keys, most important first ([`aftercare_keys`]).
    pub care_keys: &'a [&'a str],
    /// Advice chip lines of today's notes (the chip's text).
    pub advice: &'a [String],
    /// Medicines prescribed.
    pub medicines: &'a [MedicineLine],
    /// The clinic's phone, for the booking line.
    pub clinic_phone: Option<&'a str>,
    /// A public page about today's treatment; none until the learn site exists.
    pub learn_url: Option<&'a str>,
    /// The link to the visit page.
    pub url: &'a str,
    /// The link's PIN.
    pub pin: &'a str,
    /// The sections the doctor left ticked (spec 1.6).
    pub sections: SectionSet,
}

/// One of the doctor's tick boxes on the Done screen (spec 1.6). `Video` is the device's own
/// render and never changes the text; `Offer` builds nothing until offers exist (Part 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageSection {
    /// Today's treatment. Unticked, Done keeps only "Visit with {doctor} today".
    Done,
    /// The Why / Today / Next lines under each treatment.
    Detail,
    /// What we found.
    Found,
    /// Plan and recommendation.
    Plan,
    /// Medicines.
    Medicines,
    /// Care at home.
    Care,
    /// The offer.
    Offer,
    /// The personal video, rendered on the device.
    Video,
}

impl MessageSection {
    /// Every section, in the order the Done screen lists them.
    pub const ALL: [Self; 8] = [
        Self::Done,
        Self::Detail,
        Self::Found,
        Self::Plan,
        Self::Medicines,
        Self::Care,
        Self::Offer,
        Self::Video,
    ];

    /// The name clients and the database use.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Detail => "detail",
            Self::Found => "found",
            Self::Plan => "plan",
            Self::Medicines => "medicines",
            Self::Care => "care",
            Self::Offer => "offer",
            Self::Video => "video",
        }
    }

    /// The section a name stands for.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == name)
    }

    const fn bit(self) -> u8 {
        1 << self as u8
    }
}

/// The ticked sections; the default is every one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SectionSet(u8);

impl SectionSet {
    /// Every section ticked.
    pub const ALL: Self = Self(u8::MAX);

    /// Nothing ticked.
    pub const NONE: Self = Self(0);

    /// Whether the section is ticked.
    #[must_use]
    pub const fn has(self, section: MessageSection) -> bool {
        self.0 & section.bit() != 0
    }

    /// The set with `section` ticked or unticked.
    #[must_use]
    pub const fn with(self, section: MessageSection, ticked: bool) -> Self {
        if ticked {
            Self(self.0 | section.bit())
        } else {
            Self(self.0 & !section.bit())
        }
    }

    /// The set of these names.
    ///
    /// # Errors
    /// The first name that is not a section.
    pub fn parse<S: AsRef<str>>(names: &[S]) -> Result<Self, String> {
        names.iter().try_fold(Self::NONE, |set, name| {
            MessageSection::parse(name.as_ref())
                .map(|section| set.with(section, true))
                .ok_or_else(|| name.as_ref().to_owned())
        })
    }

    /// The ticked sections' names, in the Done screen's order.
    #[must_use]
    pub fn names(self) -> Vec<&'static str> {
        MessageSection::ALL
            .into_iter()
            .filter(|s| self.has(*s))
            .map(MessageSection::as_str)
            .collect()
    }
}

impl Default for SectionSet {
    fn default() -> Self {
        Self::ALL
    }
}

/// The finished summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composed {
    /// The full message: `WhatsApp` formatting, at most the template's `max_chars`.
    pub text: String,
    /// Greeting, link, PIN and the don't-forward line only: no clinical words, no name. For
    /// hand-offs that travel in a web URL.
    pub short_text: String,
    /// The message for desktop `whatsapp://` links: no emoji, cut to fit
    /// [`DESKTOP_URL_MAX`] once URL-encoded with the link's prefix. None when even its fixed
    /// lines don't fit (then desktops copy the message or use `short_text`).
    pub desktop_text: Option<String>,
}

/// The preview's stand-in for a link token: as long as a real one (43 characters), so the
/// preview drops exactly what the real text drops (N5).
pub const PREVIEW_TOKEN: &str = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
/// The preview's stand-in for the PIN, as long as a real one.
pub const PREVIEW_PIN: &str = "XXXXXX";

/// Most characters of a desktop `whatsapp://send?phone=…&text=…` link.
pub const DESKTOP_URL_MAX: usize = 2000;
/// Room kept for `whatsapp://send?phone=<E.164>&text=`.
const DESKTOP_PREFIX: usize = 48;
/// Most recommendations shown before "+N more on your page".
const RECOMMEND_MAX: usize = 2;

/// What a composed text must fit in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Budget {
    /// Characters, for phones and copying.
    Chars(usize),
    /// Characters once URL-encoded as `encodeURIComponent` does, for desktop links.
    Encoded(usize),
}

impl Budget {
    fn measure(self, text: &str) -> usize {
        match self {
            Self::Chars(_) => text.chars().count(),
            Self::Encoded(_) => encoded_len(text),
        }
    }

    const fn limit(self) -> usize {
        match self {
            Self::Chars(max) | Self::Encoded(max) => max,
        }
    }

    const fn desktop(self) -> bool {
        matches!(self, Self::Encoded(_))
    }
}

/// The length of `text` URL-encoded as `encodeURIComponent` does: unreserved ASCII stays one
/// character, everything else is 3 per UTF-8 byte (an emoji 12, Devanagari 9, a space 3).
#[must_use]
pub fn encoded_len(text: &str) -> usize {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "-_.!~*'()".contains(c) {
                1
            } else {
                3 * c.len_utf8()
            }
        })
        .sum()
}

const fn is_emoji(c: char) -> bool {
    matches!(
        c as u32,
        0x1F000..=0x1FAFF
            | 0x2190..=0x21FF
            | 0x2300..=0x23FF
            | 0x25A0..=0x25FF
            | 0x2600..=0x27BF
            | 0x2B00..=0x2BFF
            | 0xFE0F
            | 0x200D
    )
}

/// `text` with every emoji removed, and the space it leaves at a line's start or end.
fn without_emoji(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            let leading = line.chars().next().is_some_and(is_emoji);
            let kept: String = line.chars().filter(|c| !is_emoji(*c)).collect();
            if kept.len() == line.len() {
                kept
            } else if leading {
                kept.trim().to_owned()
            } else {
                kept.trim_end().to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn fill(text: &str, pairs: &[(&str, &str)]) -> String {
    pairs.iter().fold(text.to_owned(), |out, (key, value)| {
        out.replace(&format!("{{{key}}}"), value)
    })
}

fn clip(text: &str, max: usize) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= max {
        return text;
    }
    let cut: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{}…", cut.trim_end())
}

fn first_name(full_name: &str) -> &str {
    full_name.split_whitespace().next().unwrap_or("")
}

/// A day as "3 Dec 2026".
#[must_use]
pub fn day_in_words(day: Date) -> String {
    let month = match day.month() {
        Month::January => "Jan",
        Month::February => "Feb",
        Month::March => "Mar",
        Month::April => "Apr",
        Month::May => "May",
        Month::June => "Jun",
        Month::July => "Jul",
        Month::August => "Aug",
        Month::September => "Sep",
        Month::October => "Oct",
        Month::November => "Nov",
        Month::December => "Dec",
    };
    format!("{} {month} {}", day.day(), day.year())
}

/// An amount in whole rupees with Indian digit grouping, such as "₹1,25,000".
fn rupees(amount: Paise) -> String {
    let whole = (amount.get().max(0) + 50) / 100;
    let digits = whole.to_string();
    let (head, last3) = digits.split_at(digits.len().saturating_sub(3));
    let mut groups: Vec<String> = head
        .as_bytes()
        .rchunks(2)
        .rev()
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect();
    groups.push(last3.to_owned());
    format!(
        "₹{}",
        groups
            .into_iter()
            .filter(|g| !g.is_empty())
            .collect::<Vec<_>>()
            .join(",")
    )
}

/// A phone as people read it: "+91 98765 43210" for an Indian mobile.
fn phone_in_words(phone: &str) -> String {
    match phone.strip_prefix("+91") {
        Some(rest) if rest.len() == 10 && rest.chars().all(|c| c.is_ascii_digit()) => {
            format!("+91 {} {}", &rest[..5], &rest[5..])
        }
        _ => phone.to_owned(),
    }
}

fn medicine_text(t: &Template, line: &MedicineLine) -> String {
    let mut out = format!("• {}", clip(&line.generic, 60));
    if let Some(strength) = line.strength.as_deref().filter(|s| !s.trim().is_empty()) {
        out.push(' ');
        out.push_str(&clip(strength, 20));
    }
    out.push_str(": ");
    out.push_str(&clip(&line.frequency, 20));
    match line.days {
        Some(1) => {
            out.push_str(", ");
            out.push_str(&t.one_day);
        }
        Some(days) => {
            out.push_str(", ");
            out.push_str(&fill(&t.days, &[("count", &days.to_string())]));
        }
        None => {}
    }
    out
}

fn within(t: &Template, months: Option<u8>) -> String {
    match months {
        Some(1) => t.within_one.clone(),
        Some(n) => fill(&t.within, &[("count", &n.to_string())]),
        None => String::new(),
    }
}

/// One line of a section; fixed lines never drop, and tail lines come after "…and N more".
struct Line {
    text: String,
    fixed: bool,
    tail: bool,
}

impl Line {
    const fn free(text: String) -> Self {
        Self {
            text,
            fixed: false,
            tail: false,
        }
    }

    const fn fixed(text: String) -> Self {
        Self {
            text,
            fixed: true,
            tail: false,
        }
    }

    const fn tail(text: String) -> Self {
        Self {
            text,
            fixed: true,
            tail: true,
        }
    }
}

/// One section: a heading, its lines, and how many lines were dropped to fit.
struct Section {
    heading: String,
    lines: Vec<Line>,
    dropped: usize,
    /// Lower drops first.
    keep: u8,
}

impl Section {
    fn render(&self, t: &Template) -> String {
        let mut out = vec![self.heading.clone()];
        out.extend(
            self.lines
                .iter()
                .filter(|l| !l.tail)
                .map(|l| l.text.clone()),
        );
        if self.dropped > 0 {
            out.push(fill(&t.more, &[("count", &self.dropped.to_string())]));
        }
        out.extend(self.lines.iter().filter(|l| l.tail).map(|l| l.text.clone()));
        out.join("\n")
    }

    fn can_drop(&self) -> bool {
        self.lines.iter().any(|l| !l.fixed)
    }

    /// Drops the last line that can drop; true when the section is now empty.
    fn drop_one(&mut self) -> bool {
        if let Some(i) = self.lines.iter().rposition(|l| !l.fixed) {
            self.lines.remove(i);
            self.dropped += 1;
        }
        self.lines.is_empty()
    }
}

fn join(blocks: &[String]) -> String {
    blocks
        .iter()
        .filter(|block| !block.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The treatment's lines: what, on which tooth and sitting, then only the details on record.
fn done_lines(t: &Template, input: &MessageInput<'_>, done: &DoneDetail) -> Vec<String> {
    let name = clip(&done.name, 80);
    let mut first = match done.tooth {
        Some(tooth) => fill(
            &t.done_on,
            &[("name", &name), ("tooth", &tooth_short(tooth))],
        ),
        None => fill(&t.done_plain, &[("name", &name)]),
    };
    if let Some(sitting) = done.sitting {
        first.push_str(&fill(&t.sitting, &[("count", &sitting.to_string())]));
    }
    if done.continuing {
        first.push_str(&t.continuing);
    }
    first.push('.');
    let mut lines = vec![first];
    if !input.sections.has(MessageSection::Detail) {
        return lines;
    }
    let words = treatment_words();
    if let Some(why) = done.why.as_deref().and_then(|key| words?.why.get(key)) {
        lines.push(fill(&t.detail_why, &[("words", why)]));
    }
    if let Some(today) = done
        .material
        .as_deref()
        .and_then(|key| words?.material_today.get(key))
    {
        lines.push(fill(&t.detail_today, &[("words", today)]));
    }
    let booked = match input.next_visit {
        Some(NextVisit::Booked(day)) if done.continuing => Some(day_in_words(day)),
        _ => None,
    };
    match (booked, done.sitting, done.next_planned.as_deref()) {
        (Some(date), Some(sitting), _) => lines.push(fill(
            &t.next_sitting,
            &[
                ("count", &(u16::from(sitting) + 1).to_string()),
                ("date", &date),
            ],
        )),
        (Some(date), None, _) => lines.push(fill(&t.next_sitting_on, &[("date", &date)])),
        (None, _, Some(planned)) => {
            lines.push(fill(&t.next_planned, &[("name", &clip(planned, 40))]));
        }
        (None, _, None) => {}
    }
    lines
}

/// The Done line when nothing was treated: a check-up, a consultation, or at least the visit.
fn fallback_done(t: &Template, input: &MessageInput<'_>, doctor: Option<&str>) -> String {
    let line = match input.charted_teeth {
        0 if !input.found.is_empty() => t.check_up.clone(),
        0 if !input.medicines.is_empty() => t.consultation.clone(),
        0 => doctor.map_or_else(
            || t.consultation.clone(),
            |doctor| fill(&t.consultation_with, &[("doctor", doctor)]),
        ),
        1 => t.exam_tooth.clone(),
        n => fill(&t.exam_teeth, &[("count", &n.to_string())]),
    };
    format!("• {line}")
}

/// Desktop links keep fewer fixed lines (R3, F5).
struct Minimums {
    care: usize,
    recommend: usize,
}

/// The plan's fixed lines: recommendations, most urgent first and capped, then the next visit.
fn plan_lines(
    t: &Template,
    input: &MessageInput<'_>,
    doctor: Option<&str>,
    min: &Minimums,
) -> Vec<Line> {
    let mut recommend: Vec<&RecLine> = input.recommend.iter().collect();
    recommend.sort_by_key(|r| r.within_months.unwrap_or(u8::MAX));
    let mut plan: Vec<Line> = recommend
        .iter()
        .take(min.recommend)
        .map(|rec| {
            let mut item = clip(&rec.name, 40);
            if let Some(tooth) = rec.tooth {
                item.push_str(", ");
                item.push_str(&tooth_short(tooth));
            }
            item.push_str(&within(t, rec.within_months));
            if let Some(estimate) = rec.estimate.filter(|e| e.get() > 0) {
                item.push_str(&fill(&t.estimate, &[("amount", &rupees(estimate))]));
            }
            Line::tail(match doctor {
                Some(doctor) => fill(&t.recommends, &[("doctor", doctor), ("item", &item)]),
                None => fill(&t.we_recommend, &[("item", &item)]),
            })
        })
        .collect();
    if recommend.len() > min.recommend {
        let more = (recommend.len() - min.recommend).to_string();
        plan.push(Line::tail(fill(&t.more_recommended, &[("count", &more)])));
    }
    if let Some(next) = input.next_visit {
        plan.push(Line::tail(match next {
            NextVisit::Booked(day) => fill(&t.booked, &[("date", &day_in_words(day))]),
            NextVisit::Due(day) => fill(&t.follow_up, &[("date", &day_in_words(day))]),
        }));
    }
    plan
}

/// Care at home: today's aftercare, the doctor's advice, then everyday care for the age band.
fn care_lines(input: &MessageInput<'_>, min: &Minimums) -> Vec<Line> {
    // Care at home is always there: today's aftercare, the doctor's advice, then everyday care
    // for the patient's age until there are at least two lines.
    let mut care: Vec<String> = input
        .care_keys
        .first()
        .and_then(|key| aftercare(key))
        .map(|care| care.steps.iter().take(CARE_STEPS).cloned().collect())
        .unwrap_or_default();
    for advice in input.advice {
        if !care.contains(advice) {
            care.push(advice.clone());
        }
    }
    if let Some(general) = aftercare(input.age_band.care_key()) {
        // A child's parent always gets one everyday line; others only to reach the minimum.
        let floor = if input.age_band == AgeBand::Adult {
            CARE_MIN
        } else {
            CARE_MIN.max(care.len() + 1)
        };
        for step in &general.steps {
            if care.len() >= floor {
                break;
            }
            if !care.contains(step) {
                care.push(step.clone());
            }
        }
    }
    care.iter()
        .enumerate()
        .map(|(i, step)| {
            let text = format!("• {}", clip(step, LINE_MAX));
            if i < min.care {
                Line::fixed(text)
            } else {
                Line::free(text)
            }
        })
        .collect()
}

/// The sections the visit has, before any are cut to fit.
fn sections_of(
    t: &Template,
    input: &MessageInput<'_>,
    why: &str,
    doctor: Option<&str>,
    min: &Minimums,
) -> Vec<Section> {
    let mut sections = Vec::new();
    if !input.complaints.is_empty() {
        let labels: Vec<&str> = input
            .complaints
            .iter()
            .take(3)
            .map(String::as_str)
            .collect();
        sections.push(Section {
            heading: why.to_owned(),
            lines: vec![Line::free(format!("• {}", clip(&labels.join(", "), 120)))],
            dropped: 0,
            keep: 1,
        });
    }

    // Done is never empty, and its first line never drops.
    // Unticked, it keeps only the visit itself.
    let mut done: Vec<Line> = Vec::new();
    let ticked = input.sections.has(MessageSection::Done);
    if !ticked {
        let visit = doctor.map_or_else(
            || t.visit_only.clone(),
            |doctor| fill(&t.visit_only_with, &[("doctor", doctor)]),
        );
        done.push(Line::fixed(format!("• {visit}")));
    } else if input.done.is_empty() {
        done.push(Line::fixed(fallback_done(t, input, doctor)));
    }
    for (i, work) in input.done.iter().enumerate().filter(|_| ticked) {
        for (j, text) in done_lines(t, input, work).into_iter().enumerate() {
            done.push(if i == 0 && j == 0 {
                Line::fixed(text)
            } else {
                Line::free(text)
            });
        }
    }
    if let Some(url) = input.learn_url {
        done.push(Line::tail(fill(&t.learn, &[("url", url)])));
    }
    sections.push(Section {
        heading: t.done.clone(),
        lines: done,
        dropped: 0,
        keep: 5,
    });

    if !input.found.is_empty() && input.sections.has(MessageSection::Found) {
        let lines = input
            .found
            .iter()
            .take(3)
            .map(|found| {
                let teeth: Vec<String> = found.teeth.iter().map(|t| tooth_short(*t)).collect();
                let words = clip(&found.words, 60);
                let what = if teeth.is_empty() {
                    words
                } else {
                    format!("{words}: {}", teeth.join(", "))
                };
                Line::free(format!("• {what}{}", within(t, found.within_months)))
            })
            .collect();
        sections.push(Section {
            heading: t.found.clone(),
            lines,
            dropped: 0,
            keep: 3,
        });
    }

    let plan = plan_lines(t, input, doctor, min);
    if !plan.is_empty() && input.sections.has(MessageSection::Plan) {
        sections.push(Section {
            heading: t.plan.clone(),
            lines: plan,
            dropped: 0,
            keep: 3,
        });
    }

    if input.sections.has(MessageSection::Care) {
        sections.push(Section {
            heading: t.care.clone(),
            lines: care_lines(input, min),
            dropped: 0,
            keep: 2,
        });
    }

    if !input.medicines.is_empty() && input.sections.has(MessageSection::Medicines) {
        sections.push(Section {
            heading: t.medicines.clone(),
            lines: input
                .medicines
                .iter()
                .map(|line| Line::free(medicine_text(t, line)))
                .collect(),
            dropped: 0,
            keep: 4,
        });
    }

    sections
}

/// The message against one budget. Lines that don't fit go least important section first
/// ("…and 2 more on the page"); fixed lines, the greeting, booking line, link, PIN and warning
/// always stay. Desktop texts lose every emoji and keep fewer fixed lines.
fn build(t: &Template, input: &MessageInput<'_>, budget: Budget) -> String {
    let desktop = budget.desktop();
    let first = clip(first_name(input.patient_name), 40);
    let clinic = clip(input.clinic_name, if desktop { 40 } else { 80 });
    let doctor = input.doctor_name.map(|doctor| clip(doctor, 60));
    let with_doctor = doctor
        .as_deref()
        .map(|doctor| fill(&t.with_doctor, &[("doctor", doctor)]))
        .unwrap_or_default();
    let names = [
        ("first_name", first.as_str()),
        ("clinic", clinic.as_str()),
        ("with_doctor", with_doctor.as_str()),
    ];
    let (greeting, intro, why, link, warning) = if input.minor {
        (
            &t.greeting_minor,
            &t.intro_minor,
            &t.why_minor,
            &t.link_minor,
            &t.warning_minor,
        )
    } else {
        (&t.greeting, &t.intro, &t.why, &t.link, &t.warning)
    };
    let head = format!("{}\n{}", fill(greeting, &names), fill(intro, &names));
    let book = input
        .clinic_phone
        .filter(|phone| !phone.trim().is_empty())
        .map_or_else(
            || t.book_reply.clone(),
            |phone| fill(&t.book, &[("phone", &phone_in_words(phone))]),
        );
    let tail = [
        book,
        fill(link, &[("first_name", first.as_str()), ("url", input.url)]),
        fill(&t.pin, &[("pin", input.pin)]),
        fill(warning, &names),
    ]
    .join("\n");

    let min = if desktop {
        Minimums {
            care: 1,
            recommend: 1,
        }
    } else {
        Minimums {
            care: CARE_MIN,
            recommend: RECOMMEND_MAX,
        }
    };
    let mut sections = sections_of(t, input, &fill(why, &names), doctor.as_deref(), &min);
    let render = |sections: &[Section]| {
        let mut blocks = vec![head.clone()];
        blocks.extend(sections.iter().map(|s| s.render(t)));
        blocks.push(tail.clone());
        let text = join(&blocks);
        if desktop { without_emoji(&text) } else { text }
    };
    let mut text = render(&sections);
    while budget.measure(&text) > budget.limit() {
        // The least important section that still has a line to give.
        let Some(index) = sections
            .iter()
            .enumerate()
            .filter(|(_, s)| s.can_drop())
            .min_by_key(|(_, s)| s.keep)
            .map(|(i, _)| i)
        else {
            break;
        };
        if sections.get_mut(index).is_some_and(Section::drop_one) {
            sections.remove(index);
        }
        text = render(&sections);
    }
    text
}

/// Builds the summary from the visit: the full text for phones and copying, the short text for
/// web hand-offs, and the desktop text for `whatsapp://` links (English only; Devanagari
/// encodes too long, so those desktops copy the message).
#[must_use]
pub fn compose(input: &MessageInput<'_>) -> Composed {
    let Some(t) = template() else {
        let bare = format!("{}\n{}", input.url, input.pin);
        return Composed {
            text: bare.clone(),
            short_text: bare,
            desktop_text: None,
        };
    };
    let text = build(t, input, Budget::Chars(t.max_chars));
    let desktop_budget = DESKTOP_URL_MAX - DESKTOP_PREFIX;
    let desktop_text = (t.language == "en")
        .then(|| build(t, input, Budget::Encoded(desktop_budget)))
        .filter(|desktop| encoded_len(desktop) <= desktop_budget);
    let short_text = join(&[
        fill(
            &t.short.greeting,
            &[("clinic", clip(input.clinic_name, 80).as_str())],
        ),
        [
            fill(&t.short.link, &[("url", input.url)]),
            fill(&t.pin, &[("pin", input.pin)]),
            t.warning.clone(),
        ]
        .join("\n"),
    ]);
    Composed {
        text,
        short_text,
        desktop_text,
    }
}

/// The patient's answer to their plan on the visit page (C5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanChoice {
    /// "Yes, I want to go ahead": the clinic calls to book.
    GoAhead,
    /// "I have a question": the clinic gets back to them.
    Question,
}

impl PlanChoice {
    /// The value stored and sent over the API.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::GoAhead => "go_ahead",
            Self::Question => "question",
        }
    }

    /// Parses the stored or sent value.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "go_ahead" => Some(Self::GoAhead),
            "question" => Some(Self::Question),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn tooth(n: i64) -> Tooth {
        Tooth::new(n).unwrap()
    }

    #[test]
    fn the_data_files_parse_and_every_aftercare_key_is_there() {
        assert!(template().is_some());
        for key in AFTERCARE_ORDER {
            let care = aftercare(key);
            assert!(care.is_some(), "{key} missing");
            let steps = care.map_or(0, |c| c.steps.len());
            assert!((3..=6).contains(&steps), "{key} has {steps} steps");
        }
        assert_eq!(aftercare_all().len(), AFTERCARE_ORDER.len() + 4);
    }

    #[test]
    fn every_tooth_has_words_and_the_examples_read_right() {
        assert_eq!(
            tooth_in_words(tooth(46)),
            "lower right back tooth (first molar)"
        );
        assert_eq!(
            tooth_in_words(tooth(11)),
            "upper right front tooth (central incisor)"
        );
        assert_eq!(tooth_in_words(tooth(23)), "upper left front tooth (canine)");
        assert_eq!(
            tooth_in_words(tooth(34)),
            "lower left back tooth (first premolar)"
        );
        assert_eq!(
            tooth_in_words(tooth(38)),
            "lower left back tooth (wisdom tooth)"
        );
        assert_eq!(
            tooth_in_words(tooth(27)),
            "upper left back tooth (second molar)"
        );
        assert_eq!(
            tooth_in_words(tooth(54)),
            "upper right back milk tooth (first molar)"
        );
        assert_eq!(
            tooth_in_words(tooth(75)),
            "lower left back milk tooth (second molar)"
        );
        assert_eq!(
            tooth_in_words(tooth(82)),
            "lower right front milk tooth (lateral incisor)"
        );
        // Every valid number maps, and no two teeth read the same.
        let mut all: Vec<String> = Tooth::all().map(tooth_in_words).collect();
        assert_eq!(all.len(), 52);
        all.sort();
        all.dedup();
        assert_eq!(all.len(), 52);
    }

    #[test]
    fn minors_go_by_date_of_birth_and_unknown_counts_as_adult() {
        let today = date!(2026 - 11 - 19);
        assert!(is_minor(Some(date!(2010 - 01 - 01)), today));
        assert!(is_minor(Some(date!(2008 - 11 - 20)), today));
        assert!(!is_minor(Some(date!(2008 - 11 - 19)), today));
        assert!(!is_minor(None, today));
    }

    #[test]
    fn treatments_map_to_aftercare() {
        let work = |code, name, n: Option<i64>| Work {
            code,
            name,
            tooth: n.map(tooth),
            in_progress: false,
        };
        let rct = work(Some("rct"), "Root canal treatment", Some(36));
        assert_eq!(aftercare_key(&rct, &[]), Some("root_canal"));
        assert_eq!(
            aftercare_key(&rct, &[work(None, "RCT sitting 2", Some(36))]),
            Some("root_canal_between_sittings")
        );
        assert_eq!(
            aftercare_key(&rct, &[work(None, "RCT sitting 2", Some(46))]),
            Some("root_canal")
        );
        assert_eq!(
            aftercare_key(&work(None, "Extraction", Some(48)), &[]),
            Some("wisdom_extraction")
        );
        assert_eq!(
            aftercare_key(&work(None, "Extraction", Some(46)), &[]),
            Some("extraction")
        );
        assert_eq!(
            aftercare_key(&work(None, "Scaling and polishing", None), &[]),
            Some("scaling")
        );
        assert_eq!(
            aftercare_key(&work(None, "IOPA X-ray", Some(46)), &[]),
            None
        );
        let keys = aftercare_keys(
            &[
                work(None, "Scaling", None),
                work(Some("extraction"), "Extraction", Some(46)),
                work(None, "Composite filling", Some(26)),
            ],
            &[],
        );
        assert_eq!(keys, ["extraction", "filling", "scaling"]);
    }

    #[test]
    fn a_root_canal_in_progress_gets_care_between_sittings() {
        let rct = |in_progress| Work {
            code: Some("root_canal"),
            name: "Root canal treatment",
            tooth: Some(tooth(21)),
            in_progress,
        };
        assert_eq!(
            aftercare_key(&rct(true), &[]),
            Some("root_canal_between_sittings")
        );
        assert_eq!(aftercare_key(&rct(false), &[]), Some("root_canal"));
        assert_eq!(
            continuing_name("Root canal treatment", Some(4)),
            "Root canal treatment (sitting 4, continuing)"
        );
    }

    #[test]
    fn the_same_treatment_matches_by_code_or_kind_on_the_same_tooth() {
        let work = |code, name, n: i64| Work {
            code,
            name,
            tooth: Some(tooth(n)),
            in_progress: false,
        };
        let chart = work(Some("root_canal"), "Root canal treatment", 21);
        assert!(same_treatment(&chart, &work(None, "RCT", 21)));
        assert!(same_treatment(
            &chart,
            &work(Some("root_canal"), "Endo", 21)
        ));
        assert!(!same_treatment(&chart, &work(None, "RCT", 11)));
        assert!(!same_treatment(&chart, &work(None, "Filling", 21)));
    }

    const TOKEN_URL: &str =
        "https://smile.aarogyam.example/shared/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

    fn medicine(generic: &str, days: u16) -> MedicineLine {
        MedicineLine {
            generic: generic.into(),
            strength: Some("250 mg".into()),
            frequency: "1-0-1".into(),
            days: Some(days),
        }
    }

    fn sample<'a>(
        done: &'a [DoneDetail],
        medicines: &'a [MedicineLine],
        keys: &'a [&'a str],
    ) -> MessageInput<'a> {
        MessageInput {
            clinic_name: "Sunrise Dental",
            doctor_name: Some("Dr. Asha Rao"),
            patient_name: "Meera Shah",
            minor: false,
            age_band: AgeBand::Adult,
            complaints: &[],
            done,
            charted_teeth: 0,
            found: &[],
            recommend: &[],
            next_visit: Some(NextVisit::Due(date!(2026 - 12 - 03))),
            care_keys: keys,
            advice: &[],
            medicines,
            clinic_phone: Some("+919876500010"),
            learn_url: None,
            url: "https://sunrise.example/shared/tok3n",
            pin: "482913",
            sections: SectionSet::ALL,
        }
    }

    fn extraction() -> Vec<DoneDetail> {
        vec![DoneDetail {
            name: "Extraction".into(),
            tooth: Some(tooth(46)),
            ..DoneDetail::default()
        }]
    }

    /// The founder's real case (spec 1.2): a child, a root canal on 21 at sitting 4, continuing,
    /// calcium hydroxide placed, 2 medicines, next visit booked for 26 Nov.
    fn worked<'a>(
        done: &'a [DoneDetail],
        medicines: &'a [MedicineLine],
        keys: &'a [&'a str],
    ) -> MessageInput<'a> {
        MessageInput {
            clinic_name: "Smile Dental",
            doctor_name: Some("Dr Mehta"),
            patient_name: "Aarav Shah",
            minor: true,
            age_band: AgeBand::SixToTwelve,
            next_visit: Some(NextVisit::Booked(date!(2026 - 11 - 26))),
            clinic_phone: Some("+919800000010"),
            url: TOKEN_URL,
            ..sample(done, medicines, keys)
        }
    }

    fn root_canal() -> Vec<DoneDetail> {
        vec![DoneDetail {
            name: "Root canal treatment".into(),
            tooth: Some(tooth(21)),
            sitting: Some(4),
            continuing: true,
            material: Some("calcium_hydroxide".into()),
            ..DoneDetail::default()
        }]
    }

    fn crown_and_filling() -> Vec<RecLine> {
        vec![
            RecLine {
                name: "Filling".into(),
                tooth: Some(tooth(75)),
                within_months: None,
                estimate: Some(Paise::new(150_000)),
            },
            RecLine {
                name: "Crown".into(),
                tooth: Some(tooth(21)),
                within_months: Some(3),
                estimate: Some(Paise::new(600_000)),
            },
        ]
    }

    #[test]
    fn the_message_has_every_section_and_the_short_text_no_clinical_words() {
        let done = extraction();
        let medicines = [MedicineLine {
            generic: "Amoxicillin".into(),
            strength: Some("500 mg".into()),
            frequency: "1-0-1".into(),
            days: Some(5),
        }];
        let keys = ["extraction"];
        let complaints = ["Toothache".to_owned()];
        let mut input = sample(&done, &medicines, &keys);
        input.complaints = &complaints;
        let made = compose(&input);
        for part in [
            "Hello Meera",
            "*Sunrise Dental*",
            "Dr. Asha Rao",
            "*Why you came*\n• Toothache",
            "• Extraction on the lower right back tooth (46).",
            "Next visit due: 3 Dec 2026",
            "Keep biting on the gauze",
            "Amoxicillin 500 mg: 1-0-1, 5 days",
            "To book, reply here or call +91 98765 00010.",
            "https://sunrise.example/shared/tok3n",
            "482913",
            "Please don't forward it.",
        ] {
            assert!(made.text.contains(part), "missing {part}: {}", made.text);
        }
        assert!(made.text.chars().count() <= 1600);
        for word in [
            "Meera",
            "Shah",
            "Asha",
            "Toothache",
            "Extraction",
            "tooth",
            "molar",
            "Amoxicillin",
            "1-0-1",
            "gauze",
            "Next visit",
            "learn",
        ] {
            assert!(
                !made.short_text.contains(word),
                "short text has {word}: {}",
                made.short_text
            );
        }
        for part in ["*Sunrise Dental*", "tok3n", "482913", "don't forward"] {
            assert!(made.short_text.contains(part), "short text lacks {part}");
        }
    }

    #[test]
    fn the_worked_example_reads_as_designed_and_fits_a_desktop_link() {
        let done = root_canal();
        let medicines = [medicine("Amoxicillin", 5), medicine("Paracetamol", 3)];
        let keys = ["root_canal_between_sittings"];
        let made = compose(&worked(&done, &medicines, &keys));
        let text = &made.text;
        eprintln!(
            "{text}\n--- {} chars, {} encoded",
            text.chars().count(),
            encoded_len(text)
        );
        for part in [
            "Hello, thank you for bringing Aarav to *Smile Dental* today with Dr Mehta.",
            "• Root canal treatment on the upper left front tooth (21), sitting 4, continuing.",
            "  Today: a medicine (calcium hydroxide) was placed inside the tooth.",
            "  Next: sitting 5 on 26 Nov 2026.",
            "Next visit booked: 26 Nov 2026",
            "Paracetamol 250 mg: 1-0-1, 3 days",
            "To book, reply here or call +91 98000 00010.",
            "This link opens Aarav's health record.",
        ] {
            assert!(text.contains(part), "missing {part}: {text}");
        }
        assert!(
            text.contains("• Help your child brush twice a day"),
            "{text}"
        );
        // No Why: nothing was recorded on 21 before the treatment; no temporary filling either.
        assert!(
            !text.contains("Why:") && !text.contains("temporary"),
            "{text}"
        );
        assert!(text.chars().count() <= 1600);
        let desktop = made.desktop_text.expect("fits");
        assert!(encoded_len(&desktop) + DESKTOP_PREFIX <= DESKTOP_URL_MAX);
        assert!(
            !desktop.contains('✅') && !desktop.contains('🙏'),
            "{desktop}"
        );
        assert!(desktop.contains("Done today*") && desktop.starts_with("Hello,"));
    }

    #[test]
    fn every_fallback_gives_a_done_line() {
        let medicines = [medicine("Paracetamol", 3)];
        let found = [FoundLine {
            words: "Decay".into(),
            teeth: vec![tooth(36)],
            within_months: None,
        }];
        let mut input = sample(&[], &[], &[]);
        let done_of = |input: &MessageInput<'_>| {
            let text = compose(input).text;
            let after = text.split("*Done today*\n").nth(1).unwrap_or("").to_owned();
            after.lines().next().unwrap_or("").to_owned()
        };
        assert_eq!(done_of(&input), "• Consultation with Dr. Asha Rao");
        input.doctor_name = None;
        assert_eq!(done_of(&input), "• Consultation");
        input.medicines = &medicines;
        assert_eq!(done_of(&input), "• Consultation");
        input.found = &found;
        assert_eq!(done_of(&input), "• Check-up of your teeth and gums");
        input.charted_teeth = 1;
        assert_eq!(done_of(&input), "• Check-up and examination of 1 tooth");
        input.charted_teeth = 28;
        assert_eq!(done_of(&input), "• Check-up and examination of 28 teeth");
        assert!(
            compose(&input)
                .text
                .contains("*What we found*\n• Decay: lower left back tooth (36)")
        );
    }

    #[test]
    fn care_has_at_least_two_lines_for_every_age_band_with_parent_wording_for_children() {
        for band in [
            AgeBand::UnderSix,
            AgeBand::SixToTwelve,
            AgeBand::Teen,
            AgeBand::Adult,
        ] {
            let mut input = sample(&[], &[], &[]);
            input.age_band = band;
            let text = compose(&input).text;
            let care = text.split("*Care at home*\n").nth(1).unwrap_or("");
            let lines = care.lines().take_while(|l| l.starts_with("• ")).count();
            assert!(lines >= 2, "{band:?}: {text}");
            assert_eq!(
                care.contains("your child"),
                band != AgeBand::Adult,
                "{band:?}: {care}"
            );
        }
        let today = date!(2026 - 11 - 19);
        assert_eq!(
            age_band(Some(date!(2021 - 11 - 20)), today),
            AgeBand::UnderSix
        );
        assert_eq!(
            age_band(Some(date!(2020 - 11 - 19)), today),
            AgeBand::SixToTwelve
        );
        assert_eq!(age_band(Some(date!(2013 - 11 - 19)), today), AgeBand::Teen);
        assert_eq!(age_band(Some(date!(2008 - 11 - 19)), today), AgeBand::Adult);
        assert_eq!(age_band(None, today), AgeBand::Adult);
        for band in [
            AgeBand::UnderSix,
            AgeBand::SixToTwelve,
            AgeBand::Teen,
            AgeBand::Adult,
        ] {
            assert!(aftercare(band.care_key()).is_some_and(|c| c.steps.len() >= 2));
        }
    }

    #[test]
    fn advice_chips_join_care_and_note_text_never_appears() {
        let picks = crate::quick_picks::dental();
        let subjective = "k/c/o diabetes\nComplains of toothache\ncomplains OF SWELLING ";
        let complaints: Vec<String> = chip_lines(subjective, &picks.complaints)
            .map(|p| p.label.clone())
            .collect();
        assert_eq!(complaints, ["Toothache", "Swelling"]);
        let advice: Vec<String> =
            chip_lines("Soft, cold diet for 24 hours.\nno sugar", &picks.advice)
                .map(|p| p.text.clone())
                .collect();
        let mut input = sample(&[], &[], &[]);
        input.complaints = &complaints;
        input.advice = &advice;
        let text = compose(&input).text;
        assert!(text.contains("• Toothache, Swelling"), "{text}");
        assert!(text.contains("• Soft, cold diet for 24 hours."), "{text}");
        assert!(
            !text.contains("diabetes") && !text.contains("no sugar"),
            "{text}"
        );
    }

    #[test]
    fn no_detail_line_without_its_source() {
        let medicines = [];
        let keys = [];
        let bare = vec![DoneDetail {
            name: "Filling".into(),
            tooth: Some(tooth(36)),
            ..DoneDetail::default()
        }];
        let text = compose(&sample(&bare, &medicines, &keys)).text;
        for word in [
            "Why:",
            "Today:",
            "Next:",
            "temporary",
            "decay",
            "nerve",
            "canal",
        ] {
            assert!(!text.contains(word), "{word}: {text}");
        }
        let full = vec![DoneDetail {
            why: Some("caries".into()),
            material: Some("temporary".into()),
            next_planned: Some("Crown".into()),
            ..bare[0].clone()
        }];
        let text = compose(&sample(&full, &medicines, &keys)).text;
        for part in [
            "  Why: decay was found on this tooth.",
            "  Today: a temporary filling was placed.",
            "  Next: Crown.",
        ] {
            assert!(text.contains(part), "missing {part}: {text}");
        }
        // Why comes from a finding on that tooth, or a chip only when one tooth was touched.
        assert_eq!(why_key(&["caries"], &[], 3), Some("caries"));
        assert_eq!(why_key(&["watch", "root_canal"], &[], 1), None);
        assert_eq!(why_key(&[], &["deep_caries"], 1), Some("deep_caries"));
        assert_eq!(why_key(&[], &["deep_caries"], 2), None);
        assert_eq!(why_key(&[], &["calculus"], 1), None);
    }

    #[test]
    fn found_words_come_from_the_data_files_only() {
        assert_eq!(chart_finding_words("caries"), Some("Decay"));
        assert_eq!(chart_finding_words("filled"), None);
        assert_eq!(diagnosis_words("icd10", "K02.1"), Some("Decay"));
        assert_eq!(
            diagnosis_words("icd10", "k03.6"),
            Some("Tartar (hard deposits) on the teeth")
        );
        assert_eq!(diagnosis_words("icd10", "K03.1"), None);
        assert_eq!(diagnosis_words("icd10", "K021"), None);
        assert_eq!(diagnosis_words("icd11", "DA08.0"), Some("Decay"));
        assert_eq!(diagnosis_words("snomed", "K02"), None);
        assert_eq!(procedure_words("root_canal"), Some("Root canal treatment"));
        assert!(needs_treatment_words().is_some());
        assert_eq!(tooth_short(tooth(75)), "lower left back milk tooth (75)");
    }

    #[test]
    fn recommendations_are_fixed_capped_at_two_and_most_urgent_first() {
        let done = root_canal();
        let keys = ["root_canal_between_sittings"];
        let mut recs = crown_and_filling();
        recs.push(RecLine {
            name: "Scaling".into(),
            tooth: None,
            within_months: Some(6),
            estimate: None,
        });
        let mut input = worked(&done, &[], &keys);
        input.recommend = &recs;
        let text = compose(&input).text;
        let crown = "• Dr Mehta recommends: Crown, upper left front tooth (21), within 3 months (about ₹6,000)";
        assert!(text.contains(crown), "{text}");
        assert!(
            text.contains("• Dr Mehta recommends: Scaling, within 6 months"),
            "{text}"
        );
        assert!(text.contains("+1 more on your page"), "{text}");
        assert!(!text.contains("Filling"), "{text}");
        assert!(text.find(crown) < text.find("Scaling"));
        assert_eq!(rupees(Paise::new(12_500_000)), "₹1,25,000");
        assert_eq!(rupees(Paise::new(99)), "₹1");
    }

    /// Clinic 80, doctor 60, names at their clips, many medicines and recommendations.
    fn worst<'a>(
        done: &'a [DoneDetail],
        medicines: &'a [MedicineLine],
        recs: &'a [RecLine],
        keys: &'a [&'a str],
    ) -> MessageInput<'a> {
        MessageInput {
            clinic_name: "Sunrise Multispeciality Dental Care and Implant Centre, Koramangala Bengaluru 5600",
            doctor_name: Some("Dr Venkatanarasimharajuvaripeta Subrahmanya Lakshminarayana"),
            patient_name: "Aaravkrishnamurthyswaminathanramachandran Shah",
            recommend: recs,
            learn_url: Some("https://learn.aarogyam.example/l/q7m2xk"),
            ..worked(done, medicines, keys)
        }
    }

    #[test]
    fn a_long_visit_is_cut_to_fit_and_keeps_every_fixed_line() {
        let done: Vec<DoneDetail> = (0..30)
            .map(|i| DoneDetail {
                name: format!("Composite filling number {i} with a long description"),
                tooth: Some(tooth(46)),
                why: Some("caries".into()),
                material: Some("composite".into()),
                ..DoneDetail::default()
            })
            .collect();
        let medicines: Vec<MedicineLine> = (0..60)
            .map(|i| medicine(&format!("Medicine {i}"), 5))
            .collect();
        let recs: Vec<RecLine> = (0..5)
            .map(|i| RecLine {
                name: format!("Ceramic crown with a very long clinic name {i}"),
                tooth: Some(tooth(26)),
                within_months: Some(3),
                estimate: Some(Paise::new(1_250_000)),
            })
            .collect();
        let keys = ["filling"];
        let advice = ["Soft, cold diet for 24 hours.".to_owned()];
        let complaints = ["Toothache".to_owned()];
        let mut input = worst(&done, &medicines, &recs, &keys);
        input.advice = &advice;
        input.complaints = &complaints;
        let made = compose(&input);
        let text = &made.text;
        let length = text.chars().count();
        assert!(length <= 1600, "{length}: {text}");
        for part in [
            "more on the page",
            "Composite filling number 0",
            "recommends: Ceramic crown",
            "+3 more on your page",
            "To book, reply here",
            "https://learn.aarogyam.example/l/q7m2xk",
            TOKEN_URL,
            "*482913*",
            "Please don't forward it.",
        ] {
            assert!(text.contains(part), "missing {part}: {text}");
        }
        // The learn link is the first URL; the private link comes last.
        assert_eq!(text.find("https://"), text.find("https://learn."));
        assert_eq!(text.rfind("https://"), text.find(TOKEN_URL));
        assert!(!made.short_text.contains("learn") && !made.short_text.contains("crown"));

        // F5: the phone text keeps 2 care lines, the desktop text 1 and one recommendation.
        let care_lines = |text: &str| {
            text.split("Care at home*\n")
                .nth(1)
                .unwrap_or("")
                .lines()
                .take_while(|l| l.starts_with("• "))
                .count()
        };
        assert_eq!(care_lines(text), 2, "{text}");
        let desktop = made.desktop_text.expect("the bound holds");
        assert_eq!(care_lines(&desktop), 1, "{desktop}");
        assert!(desktop.contains("+4 more on your page"), "{desktop}");
        for part in ["learn.aarogyam", TOKEN_URL, "*482913*", "To book"] {
            assert!(desktop.contains(part), "desktop lacks {part}: {desktop}");
        }
    }

    #[test]
    fn the_desktop_text_of_the_worst_case_fits_in_every_language() {
        // English is the only language today; Hindi and Marathi will not try (copy instead).
        let done = root_canal();
        let medicines = [medicine("Amoxicillin", 5), medicine("Paracetamol", 3)];
        let recs = crown_and_filling();
        let keys = ["root_canal_between_sittings"];
        let input = worst(&done, &medicines, &recs, &keys);
        assert_eq!(template().map(|t| t.language.as_str()), Some("en"));
        let made = compose(&input);
        let desktop = made.desktop_text.expect("fits");
        let length = encoded_len(&desktop) + DESKTOP_PREFIX;
        assert!(length <= DESKTOP_URL_MAX, "{length}: {desktop}");
        for part in [
            "https://learn.aarogyam.example/l/q7m2xk",
            "recommends: Crown",
            "+1 more on your page",
            "*482913*",
        ] {
            assert!(desktop.contains(part), "missing {part}: {desktop}");
        }
        assert!(desktop.chars().all(|c| !is_emoji(c)), "{desktop}");
        assert_eq!(encoded_len("a b✅"), 1 + 3 + 1 + 9);
        assert_eq!(encoded_len("🙏"), 12);
    }

    #[test]
    fn minors_get_parent_wording() {
        let mut input = sample(&[], &[], &[]);
        let complaints = ["Toothache".to_owned()];
        input.minor = true;
        input.complaints = &complaints;
        input.patient_name = "Aarav Shah";
        let made = compose(&input);
        assert!(made.text.contains("bringing Aarav"), "{}", made.text);
        assert!(made.text.contains("your child Aarav's visit"));
        assert!(made.text.contains("*Why Aarav came*"));
        assert!(made.text.contains("Aarav's plan and care at home"));
        assert!(!made.short_text.contains("Aarav"));
    }

    #[test]
    fn plan_choices_round_trip() {
        for choice in [PlanChoice::GoAhead, PlanChoice::Question] {
            assert_eq!(PlanChoice::parse(choice.as_str()), Some(choice));
        }
        assert_eq!(PlanChoice::parse("yes"), None);
    }

    #[test]
    fn section_names_round_trip_and_unknown_names_are_refused() {
        let set = SectionSet::parse(&["care", "done"]).unwrap();
        assert_eq!(set.names(), ["done", "care"]);
        assert_eq!(
            SectionSet::parse(&["care", "jokes"]),
            Err("jokes".to_owned())
        );
        assert_eq!(SectionSet::parse::<&str>(&[]), Ok(SectionSet::NONE));
        assert_eq!(SectionSet::ALL.names().len(), MessageSection::ALL.len());
        assert_eq!(SectionSet::default(), SectionSet::ALL);
    }

    #[test]
    fn an_unticked_section_is_absent() {
        let done = root_canal();
        let medicines = [medicine("Amoxicillin", 5)];
        let keys = ["root_canal"];
        let found = [FoundLine {
            words: "Decay".into(),
            teeth: vec![tooth(75)],
            within_months: None,
        }];
        let recs = crown_and_filling();
        let mut input = worked(&done, &medicines, &keys);
        input.found = &found;
        input.recommend = &recs;
        let all = compose(&input).text;
        for part in [
            "*What we found*",
            "*Your plan*",
            "*Medicines*",
            "*Care at home*",
            "  Today: ",
        ] {
            assert!(all.contains(part), "missing {part}: {all}");
        }
        for (section, gone) in [
            (MessageSection::Found, "*What we found*"),
            (MessageSection::Plan, "*Your plan*"),
            (MessageSection::Medicines, "*Medicines*"),
            (MessageSection::Care, "*Care at home*"),
            (MessageSection::Detail, "  Today: "),
        ] {
            input.sections = SectionSet::ALL.with(section, false);
            let made = compose(&input);
            assert!(!made.text.contains(gone), "{section:?}: {}", made.text);
            if let Some(desktop) = made.desktop_text {
                assert!(!desktop.contains(gone.trim_start_matches(['*', ' '])));
            }
        }
        // Without Detail the treatment line itself stays.
        input.sections = SectionSet::ALL.with(MessageSection::Detail, false);
        assert!(compose(&input).text.contains("Root canal treatment"));
    }

    #[test]
    fn unticking_done_keeps_only_the_visit() {
        let done = root_canal();
        let keys = ["root_canal"];
        let mut input = worked(&done, &[], &keys);
        input.sections = SectionSet::ALL.with(MessageSection::Done, false);
        let text = compose(&input).text;
        assert!(text.contains("• Visit with Dr Mehta today"), "{text}");
        assert!(!text.contains("Root canal treatment"), "{text}");
        input.doctor_name = None;
        assert!(compose(&input).text.contains("• Visit today"));
    }

    #[test]
    fn the_preview_placeholder_is_as_long_as_a_real_link() {
        assert_eq!(PREVIEW_TOKEN.len(), 43);
        assert!(PREVIEW_TOKEN.bytes().all(|b| b == b'x'));
        assert_eq!(PREVIEW_PIN.len(), 6);
        let real = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
        assert_eq!(real.len(), PREVIEW_TOKEN.len());
    }
}
