//! The Today board's layout (docs/decisions.md, "Dashboard layout"): which widgets show, where,
//! how big, and with which options. A layout is versioned JSON, v2:
//!
//! ```json
//! { "v": 2, "tpl": "medsync", "density": "cozy", "card": "soft",
//!   "rail": { "side": "right", "width": "medium" },
//!   "items": [{ "key": "kpis", "zone": "top", "size": "full",
//!               "opts": { "metrics": ["appointments", "completed", "waiting", "collected"] } }] }
//! ```
//!
//! The widget registry below is the one place that knows the widget keys, where each may sit,
//! its sizes, the permission it needs and its options. [`validate`] checks a layout against it;
//! the API serves the same registry as the catalogue, so the portal renders from one source.
//! Nothing here touches a database.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::permission::Permission;

/// The layout version this code reads and writes.
pub const VERSION: u8 = 2;

text_value! {
    /// A starting layout a clinic or a member can pick.
    Template ("tpl") {
        /// The default: KPIs on top, the day's work in the middle, the next patients on the side.
        Medsync => "medsync",
        /// Money first: KPIs, collections, revenue mix and what is still unpaid.
        Executive => "executive",
        /// Patient first: the queue, recent patients and the day's timeline.
        Care => "care",
        /// Almost nothing but the next patient and the queue.
        Focus => "focus",
        /// Dense and flat, everything on one screen.
        Compact => "compact",
        /// What the front desk needs: queue, bookings, payments to collect.
        FrontDesk => "front_desk",
    }
}

text_value! {
    /// How much space the board leaves around things.
    Density ("density") {
        /// Tight rows and small gaps.
        Compact => "compact",
        /// Roomy.
        Cozy => "cozy",
    }
}

text_value! {
    /// How a widget's card is drawn.
    CardStyle ("card") {
        /// No border or shadow.
        Flat => "flat",
        /// A soft shadow.
        Soft => "soft",
        /// A border only.
        Outline => "outline",
    }
}

text_value! {
    /// Which side the rail is on.
    Side ("rail.side") {
        /// Left of the main area.
        Left => "left",
        /// Right of the main area.
        Right => "right",
    }
}

text_value! {
    /// How wide the rail is.
    RailWidth ("rail.width") {
        /// About a fifth of the board.
        Narrow => "narrow",
        /// About a quarter.
        Medium => "medium",
        /// About a third.
        Wide => "wide",
    }
}

text_value! {
    /// A part of the board. `top` is a full-width strip above the rest; `main` is a 12-column
    /// grid; `rail` is a column to the side, where an item's size is ignored.
    Zone ("zone") {
        /// The strip above the board.
        Top => "top",
        /// The grid.
        Main => "main",
        /// The side column.
        Rail => "rail",
    }
}

text_value! {
    /// A widget a layout can hold.
    Widget ("key") {
        /// A row of headline numbers.
        Kpis => "kpis",
        /// The next patients to be seen.
        Nextup => "nextup",
        /// The chairs and who is in them.
        Chairs => "chairs",
        /// The day's appointments.
        Appointments => "appointments",
        /// Things that need a person: unconfirmed requests, late labs.
        Attention => "attention",
        /// Open lab orders and the late ones.
        Labs => "labs",
        /// A small calendar; picking a day fills the board with that day.
        Calendar => "calendar",
        /// Who is waiting, and for how long.
        Queue => "queue",
        /// Money collected per week.
        Collections => "collections",
        /// The day hour by hour.
        Timeline => "timeline",
        /// Patients seen lately.
        RecentPatients => "recent_patients",
        /// Who is working today.
        TeamToday => "team_today",
        /// Where the money came from.
        RevenueMix => "revenue_mix",
        /// Bills with money still due.
        PendingPayments => "pending_payments",
        /// The hours of the day that fill up.
        BusyHours => "busy_hours",
    }
}

text_value! {
    /// A headline number the KPI widget can show.
    Metric ("metrics") {
        /// Appointments on the day.
        Appointments => "appointments",
        /// Visits completed.
        Completed => "completed",
        /// Patients waiting now.
        Waiting => "waiting",
        /// Patients registered on the day.
        NewPatients => "new_patients",
        /// Money collected.
        Collected => "collected",
        /// Money still due.
        Outstanding => "outstanding",
        /// Chairs in use now.
        ChairsBusy => "chairs_busy",
        /// Lab orders due on the day.
        LabDue => "lab_due",
    }
}

impl Metric {
    /// The name staff read.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Appointments => "Appointments",
            Self::Completed => "Completed",
            Self::Waiting => "Waiting",
            Self::NewPatients => "New patients",
            Self::Collected => "Collected",
            Self::Outstanding => "Outstanding",
            Self::ChairsBusy => "Chairs busy",
            Self::LabDue => "Lab work due",
        }
    }

    /// The permission needed to see the number; the board hides what the caller may not see.
    #[must_use]
    pub const fn requires(self) -> Option<Permission> {
        match self {
            Self::Appointments | Self::Completed | Self::Waiting | Self::ChairsBusy => {
                Some(Permission::AppointmentsRead)
            }
            Self::NewPatients => Some(Permission::PatientsRead),
            Self::Collected | Self::Outstanding => Some(Permission::FinanceView),
            Self::LabDue => Some(Permission::LabsRead),
        }
    }
}

/// How big an item is: columns of the 12-column grid, 4, 6, 8 or 12. Ignored in the rail.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Size {
    /// A third of the width.
    #[serde(rename = "S")]
    S,
    /// Half.
    #[serde(rename = "M")]
    M,
    /// Two thirds.
    #[serde(rename = "L")]
    L,
    /// The whole width.
    #[serde(rename = "full")]
    Full,
}

impl std::fmt::Display for Size {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Size {
    /// Every size.
    pub const ALL: &'static [Self] = &[Self::S, Self::M, Self::L, Self::Full];

    /// The value stored and sent.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::S => "S",
            Self::M => "M",
            Self::L => "L",
            Self::Full => "full",
        }
    }

    /// Parses the stored value.
    ///
    /// # Errors
    /// [`crate::UnknownValue`] for anything else.
    pub fn parse(text: &str) -> Result<Self, crate::UnknownValue> {
        match text.trim() {
            "S" => Ok(Self::S),
            "M" => Ok(Self::M),
            "L" => Ok(Self::L),
            "full" => Ok(Self::Full),
            _ => Err(crate::UnknownValue { field: "size" }),
        }
    }
}

/// What kind of value a widget option holds, with its limits and default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptKind {
    /// One of some words.
    Choice {
        /// The allowed words.
        choices: &'static [&'static str],
        /// Used when the option is left out.
        default: &'static str,
    },
    /// One of some whole numbers.
    IntChoice {
        /// The allowed numbers.
        choices: &'static [i64],
        /// Used when the option is left out.
        default: i64,
    },
    /// A whole number from `min` to `max`.
    IntRange {
        /// Smallest.
        min: i64,
        /// Largest.
        max: i64,
        /// Used when the option is left out.
        default: i64,
    },
    /// Yes or no.
    Bool {
        /// Used when the option is left out.
        default: bool,
    },
    /// An ordered list of distinct metrics.
    Metrics {
        /// Fewest.
        min: usize,
        /// Most.
        max: usize,
        /// Used when the option is left out.
        default: &'static [Metric],
    },
}

/// One option of a widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OptSpec {
    /// The key in an item's `opts`.
    pub key: &'static str,
    /// The name staff read.
    pub label: &'static str,
    /// The kind of value.
    pub kind: OptKind,
}

impl OptSpec {
    /// The default as JSON.
    #[must_use]
    pub fn default_value(&self) -> Value {
        match self.kind {
            OptKind::Choice { default, .. } => json!(default),
            OptKind::IntChoice { default, .. } | OptKind::IntRange { default, .. } => {
                json!(default)
            }
            OptKind::Bool { default } => json!(default),
            OptKind::Metrics { default, .. } => {
                Value::Array(default.iter().map(|m| json!(m.as_str())).collect())
            }
        }
    }

    fn check(&self, value: &Value) -> Result<Value, &'static str> {
        match self.kind {
            OptKind::Choice { choices, .. } => value
                .as_str()
                .filter(|text| choices.contains(text))
                .map(|_| value.clone())
                .ok_or("not one of the allowed values"),
            OptKind::IntChoice { choices, .. } => value
                .as_i64()
                .filter(|n| choices.contains(n))
                .map(|_| value.clone())
                .ok_or("not one of the allowed numbers"),
            OptKind::IntRange { min, max, .. } => value
                .as_i64()
                .filter(|n| (min..=max).contains(n))
                .map(|_| value.clone())
                .ok_or("a whole number outside the allowed range"),
            OptKind::Bool { .. } => value
                .as_bool()
                .map(|_| value.clone())
                .ok_or("must be true or false"),
            OptKind::Metrics { min, max, .. } => {
                let list = value.as_array().ok_or("must be a list")?;
                if !(min..=max).contains(&list.len()) {
                    return Err("wrong number of metrics");
                }
                let mut seen = Vec::with_capacity(list.len());
                for entry in list {
                    let metric = entry
                        .as_str()
                        .and_then(|text| Metric::parse(text).ok())
                        .ok_or("unknown metric")?;
                    if seen.contains(&metric) {
                        return Err("a metric is listed twice");
                    }
                    seen.push(metric);
                }
                Ok(value.clone())
            }
        }
    }
}

/// What the registry knows about a widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WidgetSpec {
    /// The widget.
    pub key: Widget,
    /// The name staff read.
    pub label: &'static str,
    /// What it shows.
    pub description: &'static str,
    /// Where it may sit.
    pub zones: &'static [Zone],
    /// The sizes it may have.
    pub sizes: &'static [Size],
    /// The size a newly added widget gets.
    pub default_size: Size,
    /// The zone a newly added widget goes to.
    pub default_zone: Zone,
    /// The permission needed to see it; the board hides it without. Saving a layout does not
    /// check it: a clinic's default may hold widgets some roles never see.
    pub requires: Option<Permission>,
    /// Its options.
    pub options: &'static [OptSpec],
}

use Size::{Full, L, M, S};
use Zone::{Main, Rail as SideColumn, Top};

const NO_OPTIONS: &[OptSpec] = &[];
const S_M_L: &[Size] = &[S, M, L];
const M_L_FULL: &[Size] = &[M, L, Full];
const S_M: &[Size] = &[S, M];
const MAIN_RAIL: &[Zone] = &[Main, SideColumn];

const KPIS: WidgetSpec = WidgetSpec {
    key: Widget::Kpis,
    label: "Key numbers",
    description: "A row of headline numbers for the day.",
    zones: &[Top, Main],
    sizes: &[L, Full],
    default_size: Full,
    default_zone: Top,
    requires: None,
    options: &[OptSpec {
        key: "metrics",
        label: "Numbers to show",
        kind: OptKind::Metrics {
            min: 4,
            max: 6,
            default: &[
                Metric::Appointments,
                Metric::Completed,
                Metric::Waiting,
                Metric::NewPatients,
            ],
        },
    }],
};
const NEXTUP: WidgetSpec = WidgetSpec {
    key: Widget::Nextup,
    label: "Next up",
    description: "The next patients to be seen.",
    zones: &[Top, Main, SideColumn],
    sizes: &[S, M, L, Full],
    default_size: S,
    default_zone: SideColumn,
    requires: Some(Permission::AppointmentsRead),
    options: &[OptSpec {
        key: "count",
        label: "Patients to show",
        kind: OptKind::IntRange {
            min: 1,
            max: 5,
            default: 3,
        },
    }],
};
const CHAIRS: WidgetSpec = WidgetSpec {
    key: Widget::Chairs,
    label: "Chairs",
    description: "Each chair, who is in it and how busy it is.",
    zones: &[Main],
    sizes: M_L_FULL,
    default_size: M,
    default_zone: Main,
    requires: Some(Permission::AppointmentsRead),
    options: &[OptSpec {
        key: "show_chart",
        label: "Show the use chart",
        kind: OptKind::Bool { default: true },
    }],
};
const APPOINTMENTS: WidgetSpec = WidgetSpec {
    key: Widget::Appointments,
    label: "Appointments",
    description: "The day's appointments, as a table or a list.",
    zones: &[Main],
    sizes: &[L, Full],
    default_size: L,
    default_zone: Main,
    requires: Some(Permission::AppointmentsRead),
    options: &[OptSpec {
        key: "view",
        label: "Show as",
        kind: OptKind::Choice {
            choices: &["table", "list"],
            default: "table",
        },
    }],
};
const ATTENTION: WidgetSpec = WidgetSpec {
    key: Widget::Attention,
    label: "Needs attention",
    description: "Booking requests to confirm and other things waiting on a person.",
    zones: MAIN_RAIL,
    sizes: S_M_L,
    default_size: S,
    default_zone: Main,
    requires: Some(Permission::AppointmentsRead),
    options: NO_OPTIONS,
};
const LABS: WidgetSpec = WidgetSpec {
    key: Widget::Labs,
    label: "Lab work",
    description: "Open lab orders by stage, with the late ones marked.",
    zones: MAIN_RAIL,
    sizes: S_M_L,
    default_size: S,
    default_zone: Main,
    requires: Some(Permission::LabsRead),
    options: NO_OPTIONS,
};
const CALENDAR: WidgetSpec = WidgetSpec {
    key: Widget::Calendar,
    label: "Calendar",
    description: "A small month calendar; picking a day shows that day on the board.",
    zones: MAIN_RAIL,
    sizes: S_M,
    default_size: S,
    default_zone: SideColumn,
    requires: Some(Permission::AppointmentsRead),
    options: NO_OPTIONS,
};
const QUEUE: WidgetSpec = WidgetSpec {
    key: Widget::Queue,
    label: "Queue",
    description: "Who is waiting and for how long.",
    zones: MAIN_RAIL,
    sizes: S_M_L,
    default_size: M,
    default_zone: Main,
    requires: Some(Permission::AppointmentsRead),
    options: NO_OPTIONS,
};
const COLLECTIONS: WidgetSpec = WidgetSpec {
    key: Widget::Collections,
    label: "Collections",
    description: "Money collected, week by week.",
    zones: &[Main],
    sizes: M_L_FULL,
    default_size: L,
    default_zone: Main,
    requires: Some(Permission::FinanceView),
    options: &[OptSpec {
        key: "weeks",
        label: "Weeks to show",
        kind: OptKind::IntChoice {
            choices: &[4, 8, 12],
            default: 8,
        },
    }],
};
const TIMELINE: WidgetSpec = WidgetSpec {
    key: Widget::Timeline,
    label: "Timeline",
    description: "The day hour by hour.",
    zones: MAIN_RAIL,
    sizes: S_M_L,
    default_size: M,
    default_zone: Main,
    requires: Some(Permission::AppointmentsRead),
    options: NO_OPTIONS,
};
const RECENT_PATIENTS: WidgetSpec = WidgetSpec {
    key: Widget::RecentPatients,
    label: "Recent patients",
    description: "Patients seen lately.",
    zones: MAIN_RAIL,
    sizes: S_M_L,
    default_size: S,
    default_zone: SideColumn,
    requires: Some(Permission::PatientsRead),
    options: NO_OPTIONS,
};
const TEAM_TODAY: WidgetSpec = WidgetSpec {
    key: Widget::TeamToday,
    label: "Team today",
    description: "Who is working today.",
    zones: MAIN_RAIL,
    sizes: S_M,
    default_size: S,
    default_zone: SideColumn,
    requires: Some(Permission::AppointmentsRead),
    options: NO_OPTIONS,
};
const REVENUE_MIX: WidgetSpec = WidgetSpec {
    key: Widget::RevenueMix,
    label: "Revenue mix",
    description: "Where the money came from: procedures, consults, products.",
    zones: MAIN_RAIL,
    sizes: S_M,
    default_size: S,
    default_zone: Main,
    requires: Some(Permission::FinanceView),
    options: NO_OPTIONS,
};
const PENDING_PAYMENTS: WidgetSpec = WidgetSpec {
    key: Widget::PendingPayments,
    label: "Pending payments",
    description: "Bills with money still due.",
    zones: MAIN_RAIL,
    sizes: S_M_L,
    default_size: M,
    default_zone: Main,
    requires: Some(Permission::BillingRead),
    options: NO_OPTIONS,
};
const BUSY_HOURS: WidgetSpec = WidgetSpec {
    key: Widget::BusyHours,
    label: "Busy hours",
    description: "The hours of the day that fill up.",
    zones: &[Main],
    sizes: &[M, L],
    default_size: M,
    default_zone: Main,
    requires: Some(Permission::AppointmentsRead),
    options: NO_OPTIONS,
};

impl Widget {
    /// The registry's entry for this widget.
    #[must_use]
    pub const fn spec(self) -> &'static WidgetSpec {
        match self {
            Self::Kpis => &KPIS,
            Self::Nextup => &NEXTUP,
            Self::Chairs => &CHAIRS,
            Self::Appointments => &APPOINTMENTS,
            Self::Attention => &ATTENTION,
            Self::Labs => &LABS,
            Self::Calendar => &CALENDAR,
            Self::Queue => &QUEUE,
            Self::Collections => &COLLECTIONS,
            Self::Timeline => &TIMELINE,
            Self::RecentPatients => &RECENT_PATIENTS,
            Self::TeamToday => &TEAM_TODAY,
            Self::RevenueMix => &REVENUE_MIX,
            Self::PendingPayments => &PENDING_PAYMENTS,
            Self::BusyHours => &BUSY_HOURS,
        }
    }
}

impl Template {
    /// The name staff read.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Medsync => "MedSync",
            Self::Executive => "Executive",
            Self::Care => "Care",
            Self::Focus => "Focus",
            Self::Compact => "Compact",
            Self::FrontDesk => "Front desk",
        }
    }

    /// One line on what the template is for.
    #[must_use]
    pub const fn description(self) -> &'static str {
        match self {
            Self::Medsync => {
                "Key numbers, the day's appointments and chairs, next patients on the side."
            }
            Self::Executive => "Money first: collections, revenue mix, what is still unpaid.",
            Self::Care => "Patients first: the queue, recent patients and the day's timeline.",
            Self::Focus => "Only the next patient and the queue, with room to breathe.",
            Self::Compact => "Dense and flat, so everything fits on one screen.",
            Self::FrontDesk => "Queue, bookings and payments to collect, for the desk.",
        }
    }

    /// The template's layout: what Reset goes back to, and what a clinic with no saved default
    /// shows (`medsync`).
    #[must_use]
    #[expect(
        clippy::too_many_lines,
        reason = "one table of six layouts, clearest read top to bottom"
    )]
    pub fn layout(self) -> Layout {
        use Metric::{
            Appointments as Appts, ChairsBusy, Collected, Completed, NewPatients, Outstanding,
            Waiting,
        };
        let (density, card, side, width) = match self {
            Self::Medsync => (
                Density::Cozy,
                CardStyle::Soft,
                Side::Right,
                RailWidth::Medium,
            ),
            Self::Executive => (
                Density::Cozy,
                CardStyle::Outline,
                Side::Right,
                RailWidth::Narrow,
            ),
            Self::Care => (
                Density::Cozy,
                CardStyle::Soft,
                Side::Left,
                RailWidth::Medium,
            ),
            Self::Focus => (
                Density::Cozy,
                CardStyle::Flat,
                Side::Right,
                RailWidth::Narrow,
            ),
            Self::Compact => (
                Density::Compact,
                CardStyle::Flat,
                Side::Right,
                RailWidth::Narrow,
            ),
            Self::FrontDesk => (
                Density::Compact,
                CardStyle::Outline,
                Side::Right,
                RailWidth::Medium,
            ),
        };
        let items = match self {
            Self::Medsync => vec![
                kpis(&[Appts, Completed, Waiting, Collected]),
                item(Widget::Appointments, Main, L),
                item(Widget::Attention, Main, S),
                item(Widget::Chairs, Main, M),
                item(Widget::Labs, Main, M),
                with(item(Widget::Collections, Main, Full), "weeks", json!(8)),
                with(item(Widget::Nextup, SideColumn, S), "count", json!(3)),
                item(Widget::Calendar, SideColumn, S),
                item(Widget::Queue, SideColumn, S),
            ],
            Self::Executive => vec![
                kpis(&[
                    Appts,
                    Completed,
                    Collected,
                    Outstanding,
                    NewPatients,
                    ChairsBusy,
                ]),
                with(item(Widget::Collections, Main, L), "weeks", json!(12)),
                item(Widget::RevenueMix, Main, S),
                item(Widget::BusyHours, Main, M),
                item(Widget::PendingPayments, Main, M),
                item(Widget::Chairs, Main, M),
                item(Widget::TeamToday, SideColumn, S),
                item(Widget::Attention, SideColumn, S),
                item(Widget::Labs, SideColumn, S),
            ],
            Self::Care => vec![
                kpis(&[Appts, Completed, Waiting, NewPatients]),
                item(Widget::Queue, Main, L),
                with(item(Widget::Appointments, Main, L), "view", json!("list")),
                item(Widget::RecentPatients, Main, M),
                item(Widget::Timeline, Main, M),
                item(Widget::Attention, Main, M),
                item(Widget::Calendar, SideColumn, S),
                with(item(Widget::Nextup, SideColumn, S), "count", json!(3)),
                item(Widget::Labs, SideColumn, S),
            ],
            Self::Focus => vec![
                with(item(Widget::Nextup, Top, Full), "count", json!(1)),
                item(Widget::Queue, Main, M),
                with(item(Widget::Appointments, Main, L), "view", json!("list")),
                item(Widget::Attention, Main, M),
                item(Widget::Calendar, SideColumn, S),
            ],
            Self::Compact => vec![
                kpis(&[
                    Appts,
                    Completed,
                    Waiting,
                    NewPatients,
                    Collected,
                    ChairsBusy,
                ]),
                item(Widget::Appointments, Main, Full),
                item(Widget::Queue, Main, M),
                with(item(Widget::Chairs, Main, M), "show_chart", json!(false)),
                item(Widget::Attention, Main, M),
                item(Widget::Labs, Main, M),
                item(Widget::BusyHours, Main, M),
                item(Widget::Calendar, SideColumn, S),
                item(Widget::TeamToday, SideColumn, S),
                with(item(Widget::Nextup, SideColumn, S), "count", json!(2)),
            ],
            Self::FrontDesk => vec![
                kpis(&[Appts, Completed, Waiting, NewPatients]),
                item(Widget::Queue, Main, L),
                item(Widget::Appointments, Main, L),
                item(Widget::PendingPayments, Main, M),
                item(Widget::Attention, Main, M),
                item(Widget::Calendar, SideColumn, S),
                with(item(Widget::Nextup, SideColumn, S), "count", json!(5)),
                item(Widget::RecentPatients, SideColumn, S),
                item(Widget::Labs, SideColumn, S),
            ],
        };
        Layout {
            v: VERSION,
            tpl: self,
            density,
            card,
            rail: Rail { side, width },
            items: items.into_iter().map(complete).collect(),
        }
    }
}

fn item(key: Widget, zone: Zone, size: Size) -> Item {
    Item {
        key,
        zone,
        size,
        opts: Map::new(),
    }
}

fn with(mut item: Item, key: &str, value: Value) -> Item {
    item.opts.insert(key.to_owned(), value);
    item
}

fn kpis(metrics: &[Metric]) -> Item {
    with(
        item(Widget::Kpis, Top, Full),
        "metrics",
        Value::Array(metrics.iter().map(|m| json!(m.as_str())).collect()),
    )
}

/// Fills in every option the item leaves out with its default.
fn complete(mut item: Item) -> Item {
    for option in item.key.spec().options {
        item.opts
            .entry(option.key.to_owned())
            .or_insert_with(|| option.default_value());
    }
    item
}

/// Where the rail is and how wide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rail {
    /// Left or right of the main area.
    pub side: Side,
    /// How wide.
    pub width: RailWidth,
}

/// One widget placed on the board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Item {
    /// Which widget; each appears at most once.
    pub key: Widget,
    /// Where it sits.
    pub zone: Zone,
    /// How big.
    pub size: Size,
    /// Its options, every one filled in.
    pub opts: Map<String, Value>,
}

/// A checked layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    /// Always [`VERSION`].
    pub v: u8,
    /// The template it started from.
    pub tpl: Template,
    /// Spacing.
    pub density: Density,
    /// Card style.
    pub card: CardStyle,
    /// The side column.
    pub rail: Rail,
    /// The widgets, in order within each zone.
    pub items: Vec<Item>,
}

/// A layout as a client sends it, before it is checked: every value is text.
#[derive(Debug, Clone, PartialEq)]
pub struct RawLayout {
    /// The version; may be left out, otherwise it must be [`VERSION`].
    pub v: Option<u8>,
    /// Template key.
    pub tpl: String,
    /// Density.
    pub density: String,
    /// Card style.
    pub card: String,
    /// Rail side.
    pub rail_side: String,
    /// Rail width.
    pub rail_width: String,
    /// The items.
    pub items: Vec<RawItem>,
}

/// An item as a client sends it.
#[derive(Debug, Clone, PartialEq)]
pub struct RawItem {
    /// Widget key.
    pub key: String,
    /// Zone.
    pub zone: String,
    /// Size.
    pub size: String,
    /// Options; any left out get their default.
    pub opts: Map<String, Value>,
}

/// Why a layout was refused. It names the place, never echoes the value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{field}: {message}")]
pub struct LayoutError {
    /// Where, such as `items[2].opts.weeks`.
    pub field: String,
    /// What is wrong.
    pub message: &'static str,
}

fn refuse<T>(field: impl Into<String>, message: &'static str) -> Result<T, LayoutError> {
    Err(LayoutError {
        field: field.into(),
        message,
    })
}

/// Checks a client's layout against the registry and returns it with every option filled in.
///
/// # Errors
/// [`LayoutError`] for the first thing wrong: an unknown or repeated widget, a zone or size the
/// widget does not allow, an unknown option or an option out of range.
pub fn validate(raw: &RawLayout) -> Result<Layout, LayoutError> {
    if raw.v.is_some_and(|v| v != VERSION) {
        return refuse("v", "only version 2 is supported");
    }
    let tpl = Template::parse(&raw.tpl).or_else(|_| refuse("tpl", "unknown template"))?;
    let density =
        Density::parse(&raw.density).or_else(|_| refuse("density", "must be compact or cozy"))?;
    let card =
        CardStyle::parse(&raw.card).or_else(|_| refuse("card", "must be flat, soft or outline"))?;
    let rail_side =
        Side::parse(&raw.rail_side).or_else(|_| refuse("rail.side", "must be left or right"))?;
    let rail_width = RailWidth::parse(&raw.rail_width)
        .or_else(|_| refuse("rail.width", "must be narrow, medium or wide"))?;
    if raw.items.len() > Widget::ALL.len() {
        return refuse("items", "more items than there are widgets");
    }
    let mut items: Vec<Item> = Vec::with_capacity(raw.items.len());
    for (index, raw_item) in raw.items.iter().enumerate() {
        let at = |what: &str| format!("items[{index}].{what}");
        let key = Widget::parse(&raw_item.key).or_else(|_| refuse(at("key"), "unknown widget"))?;
        if items.iter().any(|seen| seen.key == key) {
            return refuse(at("key"), "this widget is listed twice");
        }
        let spec = key.spec();
        let zone = Zone::parse(&raw_item.zone)
            .or_else(|_| refuse(at("zone"), "must be top, main or rail"))?;
        if !spec.zones.contains(&zone) {
            return refuse(at("zone"), "this widget cannot go in that zone");
        }
        let size = Size::parse(&raw_item.size)
            .or_else(|_| refuse(at("size"), "must be S, M, L or full"))?;
        if !spec.sizes.contains(&size) {
            return refuse(at("size"), "this widget does not come in that size");
        }
        let mut opts = Map::new();
        for name in raw_item.opts.keys() {
            if !spec.options.iter().any(|option| option.key == name) {
                return refuse(
                    at(&format!("opts.{name}")),
                    "this widget has no such option",
                );
            }
        }
        for option in spec.options {
            let value = match raw_item.opts.get(option.key) {
                None => option.default_value(),
                Some(given) => option
                    .check(given)
                    .or_else(|message| refuse(at(&format!("opts.{}", option.key)), message))?,
            };
            opts.insert(option.key.to_owned(), value);
        }
        items.push(Item {
            key,
            zone,
            size,
            opts,
        });
    }
    Ok(Layout {
        v: VERSION,
        tpl,
        density,
        card,
        rail: Rail {
            side: rail_side,
            width: rail_width,
        },
        items,
    })
}

impl Layout {
    /// A layout read back from storage, or `None` when it no longer passes the registry (a widget
    /// was retired, say). The caller then falls back to the next level instead of failing.
    #[must_use]
    pub fn from_stored(value: &Value) -> Option<Self> {
        let layout: Self = serde_json::from_value(value.clone()).ok()?;
        let raw = RawLayout {
            v: Some(layout.v),
            tpl: layout.tpl.as_str().to_owned(),
            density: layout.density.as_str().to_owned(),
            card: layout.card.as_str().to_owned(),
            rail_side: layout.rail.side.as_str().to_owned(),
            rail_width: layout.rail.width.as_str().to_owned(),
            items: layout
                .items
                .iter()
                .map(|item| RawItem {
                    key: item.key.as_str().to_owned(),
                    zone: item.zone.as_str().to_owned(),
                    size: item.size.as_str().to_owned(),
                    opts: item.opts.clone(),
                })
                .collect(),
        };
        validate(&raw).ok()
    }

    /// The layout as the JSON that is stored.
    #[must_use]
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_of(layout: &Layout) -> RawLayout {
        RawLayout {
            v: Some(layout.v),
            tpl: layout.tpl.to_string(),
            density: layout.density.to_string(),
            card: layout.card.to_string(),
            rail_side: layout.rail.side.to_string(),
            rail_width: layout.rail.width.to_string(),
            items: layout
                .items
                .iter()
                .map(|item| RawItem {
                    key: item.key.to_string(),
                    zone: item.zone.to_string(),
                    size: item.size.to_string(),
                    opts: item.opts.clone(),
                })
                .collect(),
        }
    }

    #[test]
    fn every_template_passes_the_registry_and_round_trips() {
        assert_eq!(Template::ALL.len(), 6);
        for template in Template::ALL {
            let layout = template.layout();
            assert_eq!(layout.tpl, *template);
            assert_eq!(validate(&raw_of(&layout)).unwrap(), layout, "{template}");
            assert_eq!(Layout::from_stored(&layout.to_json()), Some(layout));
        }
    }

    #[test]
    fn every_widget_default_is_valid_and_its_size_and_zone_allowed() {
        assert_eq!(Widget::ALL.len(), 15);
        for widget in Widget::ALL {
            let spec = widget.spec();
            assert_eq!(spec.key, *widget);
            assert!(spec.sizes.contains(&spec.default_size), "{widget}");
            assert!(spec.zones.contains(&spec.default_zone), "{widget}");
            for option in spec.options {
                assert!(option.check(&option.default_value()).is_ok(), "{widget}");
            }
        }
    }

    fn base() -> RawLayout {
        raw_of(&Template::Medsync.layout())
    }

    #[test]
    fn missing_options_get_their_defaults() {
        let mut raw = base();
        raw.items = vec![RawItem {
            key: "collections".into(),
            zone: "main".into(),
            size: "L".into(),
            opts: Map::new(),
        }];
        let layout = validate(&raw).unwrap();
        assert_eq!(layout.items[0].opts["weeks"], json!(8));
    }

    fn refused(edit: impl FnOnce(&mut RawLayout)) -> LayoutError {
        let mut raw = base();
        edit(&mut raw);
        validate(&raw).unwrap_err()
    }

    #[test]
    fn bad_layouts_name_the_place() {
        assert_eq!(refused(|r| r.v = Some(1)).field, "v");
        assert_eq!(refused(|r| r.tpl = "x".into()).field, "tpl");
        assert_eq!(refused(|r| r.density = "x".into()).field, "density");
        assert_eq!(refused(|r| r.card = "x".into()).field, "card");
        assert_eq!(refused(|r| r.rail_side = "up".into()).field, "rail.side");
        assert_eq!(refused(|r| r.rail_width = "x".into()).field, "rail.width");
        assert_eq!(
            refused(|r| r.items[1].key = "nope".into()).field,
            "items[1].key"
        );
        assert_eq!(
            refused(|r| r.items[1].key = "kpis".into()).field,
            "items[1].key"
        );
        // Collections only go in the main area; KPIs not in the rail; chairs not size S.
        assert_eq!(
            refused(|r| r.items[5].zone = "rail".into()).field,
            "items[5].zone"
        );
        assert_eq!(
            refused(|r| r.items[0].zone = "rail".into()).field,
            "items[0].zone"
        );
        assert_eq!(
            refused(|r| r.items[3].size = "S".into()).field,
            "items[3].size"
        );
        assert_eq!(
            refused(|r| r.items[2].size = "XL".into()).field,
            "items[2].size"
        );
        assert_eq!(
            refused(|r| r.items[0].zone = "side".into()).field,
            "items[0].zone"
        );
    }

    #[test]
    fn options_are_checked_against_their_kind() {
        let bad = |index: usize, key: &str, value: Value| {
            refused(|r| {
                r.items[index].opts.insert(key.into(), value);
            })
            .field
        };
        // kpis (0): 4 to 6 distinct known metrics.
        assert_eq!(
            bad(0, "metrics", json!(["appointments"])),
            "items[0].opts.metrics"
        );
        assert_eq!(
            bad(
                0,
                "metrics",
                json!(["appointments", "completed", "waiting", "nope"])
            ),
            "items[0].opts.metrics"
        );
        assert_eq!(
            bad(
                0,
                "metrics",
                json!(["waiting", "waiting", "completed", "appointments"])
            ),
            "items[0].opts.metrics"
        );
        assert_eq!(
            bad(
                0,
                "metrics",
                json!([
                    "appointments",
                    "completed",
                    "waiting",
                    "new_patients",
                    "collected",
                    "outstanding",
                    "chairs_busy"
                ])
            ),
            "items[0].opts.metrics"
        );
        assert_eq!(
            bad(0, "metrics", json!("appointments")),
            "items[0].opts.metrics"
        );
        assert_eq!(bad(0, "colour", json!("red")), "items[0].opts.colour");
        // appointments (1): view; collections (5): weeks; chairs (3): show_chart; nextup (6).
        assert_eq!(bad(1, "view", json!("grid")), "items[1].opts.view");
        assert_eq!(bad(5, "weeks", json!(6)), "items[5].opts.weeks");
        assert_eq!(bad(5, "weeks", json!("8")), "items[5].opts.weeks");
        assert_eq!(
            bad(3, "show_chart", json!("yes")),
            "items[3].opts.show_chart"
        );
        assert_eq!(bad(6, "count", json!(0)), "items[6].opts.count");
        assert_eq!(bad(6, "count", json!(6)), "items[6].opts.count");
        assert_eq!(bad(6, "count", json!(2.5)), "items[6].opts.count");
        assert_eq!(bad(6, "count", json!(null)), "items[6].opts.count");
    }

    #[test]
    fn valid_options_pass() {
        let mut raw = base();
        raw.items[0].opts.insert(
            "metrics".into(),
            json!([
                "lab_due",
                "outstanding",
                "chairs_busy",
                "new_patients",
                "waiting"
            ]),
        );
        raw.items[6].opts.insert("count".into(), json!(5));
        raw.items[5].opts.insert("weeks".into(), json!(12));
        let layout = validate(&raw).unwrap();
        assert_eq!(layout.items[0].opts["metrics"].as_array().unwrap().len(), 5);
    }

    #[test]
    fn a_retired_widget_in_storage_is_not_used() {
        let mut stored = Template::Care.layout().to_json();
        stored["items"][0]["key"] = json!("retired");
        assert_eq!(Layout::from_stored(&stored), None);
        assert_eq!(Layout::from_stored(&json!({"tpl": "care"})), None);
    }

    #[test]
    fn metrics_need_the_permission_that_shows_them() {
        assert_eq!(Metric::Collected.requires(), Some(Permission::FinanceView));
        assert_eq!(Metric::LabDue.requires(), Some(Permission::LabsRead));
        for metric in Metric::ALL {
            assert_ne!(metric.label(), "");
        }
    }
}
