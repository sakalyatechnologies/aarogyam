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

use crate::dental::Tooth;
use crate::patient::BirthDate;

const MESSAGE_SOURCE: &str = include_str!("../../../specialties/dental/visit-message.json");
const AFTERCARE_SOURCE: &str = include_str!("../../../specialties/dental/aftercare.json");

/// The age from which a patient gets their own summary.
pub const ADULT_AGE: u16 = 18;
/// Most care-at-home steps the message carries; the page shows them all.
pub const CARE_STEPS: usize = 3;
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

/// The aftercare key for one treatment done today; `planned` tells a root canal that continues
/// (another root canal sitting planned on the same tooth) from a finished one.
#[must_use]
pub fn aftercare_key(work: &Work<'_>, planned: &[Work<'_>]) -> Option<&'static str> {
    Some(match kind_of(work)? {
        Kind::Extraction => "extraction",
        Kind::Wisdom => "wisdom_extraction",
        Kind::RootCanal => {
            let continues = planned
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

#[derive(Debug, Deserialize)]
struct Short {
    greeting: String,
}

#[derive(Debug, Deserialize)]
struct Template {
    max_chars: usize,
    greeting: String,
    greeting_minor: String,
    with_doctor: String,
    intro: String,
    intro_minor: String,
    why: String,
    why_minor: String,
    done: String,
    plan: String,
    care: String,
    medicines: String,
    booked: String,
    follow_up: String,
    more: String,
    days: String,
    one_day: String,
    link: String,
    pin: String,
    warning: String,
    short: Short,
}

fn template() -> Option<&'static Template> {
    static TEMPLATE: OnceLock<Option<Template>> = OnceLock::new();
    TEMPLATE
        .get_or_init(|| serde_json::from_str(MESSAGE_SOURCE).ok())
        .as_ref()
}

/// A treatment line: what, and on which tooth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkLine {
    /// The treatment's name.
    pub name: String,
    /// The tooth, when it concerns one.
    pub tooth: Option<Tooth>,
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

/// What the summary is made of.
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
    /// Why they came.
    pub chief_complaint: Option<&'a str>,
    /// Treatments done today.
    pub done: &'a [WorkLine],
    /// Treatments planned.
    pub plan: &'a [WorkLine],
    /// When the plan continues.
    pub next_visit: Option<NextVisit>,
    /// Aftercare keys, most important first ([`aftercare_keys`]).
    pub care_keys: &'a [&'a str],
    /// Medicines prescribed.
    pub medicines: &'a [MedicineLine],
    /// The link to the visit page.
    pub url: &'a str,
    /// The link's PIN.
    pub pin: &'a str,
}

/// The finished summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composed {
    /// The full message: `WhatsApp` formatting, at most about 1,200 characters.
    pub text: String,
    /// Greeting, link, PIN and the don't-forward line only: no clinical words, no name. For
    /// hand-offs that travel in a web URL.
    pub short_text: String,
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

fn work_text(line: &WorkLine) -> String {
    let name = clip(&line.name, 80);
    match line.tooth {
        Some(tooth) => format!("• {name}, {}", tooth_in_words(tooth)),
        None => format!("• {name}"),
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

/// One section: a heading, its lines, and how many lines were dropped to fit.
struct Section {
    heading: String,
    lines: Vec<String>,
    /// Lines that can't be dropped (the plan's next visit).
    fixed: Vec<String>,
    dropped: usize,
    /// Lower drops first.
    keep: u8,
}

impl Section {
    fn render(&self, t: &Template) -> String {
        let mut out = vec![self.heading.clone()];
        out.extend(self.lines.iter().cloned());
        if self.dropped > 0 {
            out.push(fill(&t.more, &[("count", &self.dropped.to_string())]));
        }
        out.extend(self.fixed.iter().cloned());
        out.join("\n")
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

/// The sections the visit has, before any are cut to fit.
fn sections_of(t: &Template, input: &MessageInput<'_>, why: &str) -> Vec<Section> {
    let mut sections = Vec::new();
    if let Some(complaint) = input.chief_complaint.filter(|c| !c.trim().is_empty()) {
        sections.push(Section {
            heading: why.to_owned(),
            lines: vec![clip(complaint, 120)],
            fixed: Vec::new(),
            dropped: 0,
            keep: 1,
        });
    }
    if !input.done.is_empty() {
        sections.push(Section {
            heading: t.done.clone(),
            lines: input.done.iter().map(work_text).collect(),
            fixed: Vec::new(),
            dropped: 0,
            keep: 5,
        });
    }
    let next = input.next_visit.map(|next| match next {
        NextVisit::Booked(day) => fill(&t.booked, &[("date", &day_in_words(day))]),
        NextVisit::Due(day) => fill(&t.follow_up, &[("date", &day_in_words(day))]),
    });
    if !input.plan.is_empty() || next.is_some() {
        sections.push(Section {
            heading: t.plan.clone(),
            lines: input.plan.iter().map(work_text).collect(),
            fixed: next.into_iter().collect(),
            dropped: 0,
            keep: 3,
        });
    }
    let steps: Vec<String> = input
        .care_keys
        .first()
        .and_then(|key| aftercare(key))
        .map(|care| {
            care.steps
                .iter()
                .take(CARE_STEPS)
                .map(|step| format!("• {}", clip(step, LINE_MAX)))
                .collect()
        })
        .unwrap_or_default();
    if !steps.is_empty() {
        sections.push(Section {
            heading: t.care.clone(),
            lines: steps,
            fixed: Vec::new(),
            dropped: 0,
            keep: 2,
        });
    }
    if !input.medicines.is_empty() {
        sections.push(Section {
            heading: t.medicines.clone(),
            lines: input
                .medicines
                .iter()
                .map(|line| medicine_text(t, line))
                .collect(),
            fixed: Vec::new(),
            dropped: 0,
            keep: 4,
        });
    }

    sections
}

/// Builds the summary from the visit. Sections that don't fit in the template's limit lose their
/// last lines first ("…and 2 more on the page"), least important section first; the greeting,
/// link, PIN and warning always stay.
#[must_use]
pub fn compose(input: &MessageInput<'_>) -> Composed {
    let Some(t) = template() else {
        return Composed {
            text: format!("{}\n{}", input.url, input.pin),
            short_text: format!("{}\n{}", input.url, input.pin),
        };
    };
    let first = clip(first_name(input.patient_name), 40);
    let clinic = clip(input.clinic_name, 80);
    let with_doctor = input
        .doctor_name
        .map(|doctor| fill(&t.with_doctor, &[("doctor", &clip(doctor, 60))]))
        .unwrap_or_default();
    let names = [
        ("first_name", first.as_str()),
        ("clinic", clinic.as_str()),
        ("with_doctor", with_doctor.as_str()),
    ];
    let (greeting, intro, why) = if input.minor {
        (&t.greeting_minor, &t.intro_minor, &t.why_minor)
    } else {
        (&t.greeting, &t.intro, &t.why)
    };
    let head = format!("{}\n{}", fill(greeting, &names), fill(intro, &names));
    let tail = [
        fill(&t.link, &[("url", input.url)]),
        fill(&t.pin, &[("pin", input.pin)]),
        t.warning.clone(),
    ]
    .join("\n");

    let mut sections = sections_of(t, input, &fill(why, &names));
    let render = |sections: &[Section]| {
        let mut blocks = vec![head.clone()];
        blocks.extend(sections.iter().map(|s| s.render(t)));
        blocks.push(tail.clone());
        join(&blocks)
    };
    let mut text = render(&sections);
    while text.chars().count() > t.max_chars && !sections.is_empty() {
        // The least important section that still has something to give.
        let Some(index) = sections
            .iter()
            .enumerate()
            .min_by_key(|(_, s)| s.keep)
            .map(|(i, _)| i)
        else {
            break;
        };
        let section = sections.get_mut(index);
        match section {
            Some(section) if section.lines.len() > 1 => {
                section.lines.pop();
                section.dropped += 1;
            }
            _ => {
                sections.remove(index);
            }
        }
        text = render(&sections);
    }
    let short_text = join(&[
        fill(&t.short.greeting, &[("clinic", clinic.as_str())]),
        tail,
    ]);
    Composed { text, short_text }
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
        assert_eq!(aftercare_all().len(), AFTERCARE_ORDER.len());
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

    fn sample<'a>(
        done: &'a [WorkLine],
        medicines: &'a [MedicineLine],
        keys: &'a [&'a str],
    ) -> MessageInput<'a> {
        MessageInput {
            clinic_name: "Sunrise Dental",
            doctor_name: Some("Dr. Asha Rao"),
            patient_name: "Meera Shah",
            minor: false,
            chief_complaint: Some("Pain lower right"),
            done,
            plan: &[],
            next_visit: Some(NextVisit::Due(date!(2026 - 12 - 03))),
            care_keys: keys,
            medicines,
            url: "https://sunrise.example/shared/tok3n",
            pin: "482913",
        }
    }

    #[test]
    fn the_message_has_every_section_and_the_short_text_no_clinical_words() {
        let done = [WorkLine {
            name: "Extraction".into(),
            tooth: Some(tooth(46)),
        }];
        let medicines = [MedicineLine {
            generic: "Amoxicillin".into(),
            strength: Some("500 mg".into()),
            frequency: "1-0-1".into(),
            days: Some(5),
        }];
        let keys = ["extraction"];
        let made = compose(&sample(&done, &medicines, &keys));
        for part in [
            "Hello Meera",
            "*Sunrise Dental*",
            "Dr. Asha Rao",
            "Pain lower right",
            "Extraction, lower right back tooth (first molar)",
            "Next visit due: 3 Dec 2026",
            "Keep biting on the gauze",
            "Amoxicillin 500 mg: 1-0-1, 5 days",
            "https://sunrise.example/shared/tok3n",
            "482913",
            "Please don't forward it.",
        ] {
            assert!(made.text.contains(part), "missing {part}: {}", made.text);
        }
        assert!(made.text.chars().count() <= 1200);
        for word in [
            "Meera",
            "Shah",
            "Asha",
            "Pain",
            "Extraction",
            "tooth",
            "molar",
            "Amoxicillin",
            "1-0-1",
            "gauze",
            "Next visit",
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
    fn minors_get_parent_wording() {
        let mut input = sample(&[], &[], &[]);
        input.minor = true;
        input.patient_name = "Aarav Shah";
        let made = compose(&input);
        assert!(made.text.contains("bringing Aarav"), "{}", made.text);
        assert!(made.text.contains("your child Aarav's visit"));
        assert!(made.text.contains("*Why Aarav came*"));
    }

    #[test]
    fn a_long_visit_is_cut_to_fit_and_keeps_the_link_and_pin() {
        let done: Vec<WorkLine> = (0..30)
            .map(|i| WorkLine {
                name: format!("Composite filling number {i} with a long description"),
                tooth: Some(tooth(46)),
            })
            .collect();
        let medicines: Vec<MedicineLine> = (0..12)
            .map(|i| MedicineLine {
                generic: format!("Medicine {i}"),
                strength: Some("500 mg".into()),
                frequency: "1-0-1".into(),
                days: Some(5),
            })
            .collect();
        let keys = ["filling"];
        let mut input = sample(&done, &medicines, &keys);
        let long = "x".repeat(500);
        input.chief_complaint = Some(&long);
        let made = compose(&input);
        let length = made.text.chars().count();
        assert!(length <= 1200, "{length}: {}", made.text);
        assert!(made.text.contains("more on the page"), "{}", made.text);
        assert!(made.text.contains("482913"));
        assert!(made.text.contains("tok3n"));
        assert!(made.text.contains("Please don't forward it."));
        // Today's treatments are the last to go.
        assert!(made.text.contains("Composite filling number 0"));
    }

    #[test]
    fn plan_choices_round_trip() {
        for choice in [PlanChoice::GoAhead, PlanChoice::Question] {
            assert_eq!(PlanChoice::parse(choice.as_str()), Some(choice));
        }
        assert_eq!(PlanChoice::parse("yes"), None);
    }
}
