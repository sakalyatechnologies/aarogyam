//! Campaigns (docs/decisions.md, "Campaigns"): the audience filters a clinic may use, a
//! campaign's states, and its settings. Pure rules; the database evaluates the filter
//! (`app.audience_patients`, migration 0382) and expands a due campaign (0383).

use serde_json::{Value, json};
use time::{Date, Duration, Month, OffsetDateTime};

text_value! {
    /// Where a campaign is in its life.
    CampaignStatus ("status") {
        /// Being written; nothing is sent.
        Draft => "draft",
        /// Approved with a count token; waiting for its time.
        Scheduled => "scheduled",
        /// Its recipients are being queued.
        Sending => "sending",
        /// Every recipient is queued (sending goes on message by message).
        Sent => "sent",
        /// Stopped; queued messages were skipped.
        Cancelled => "cancelled",
    }
}

text_value! {
    /// A patient's sex, as an audience filter names it.
    FilterSex ("sex") {
        /// Female.
        Female => "female",
        /// Male.
        Male => "male",
        /// Another value.
        Other => "other",
        /// Not recorded.
        Unknown => "unknown",
    }
}

/// How long a preview's count token lasts.
pub const COUNT_TOKEN_TTL: Duration = Duration::minutes(15);
/// Most characters of an offer text, a campaign name or a tag.
pub const MAX_OFFER_CHARS: usize = 300;
/// Most characters of a campaign name.
pub const MAX_NAME_CHARS: usize = 120;
/// Patients one fan-out call expands.
pub const FAN_OUT_BATCH: i32 = 500;
/// How far in the past a campaign's time may be when it is scheduled, so a stale draft
/// can't fire at once by accident.
pub const MAX_PAST: Duration = Duration::hours(1);

/// Why an audience filter or campaign text is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CampaignError {
    /// A filter kind that isn't allowed (balance, treatment and visit-kind filters never are).
    #[error("unknown filter kind")]
    Kind,
    /// A field the kind needs is missing or out of range.
    #[error("{0}: missing or out of range")]
    Field(&'static str),
    /// A field the kind doesn't take.
    #[error("{0}: not a field of this filter")]
    Extra(&'static str),
    /// Text that is empty, too long or spans lines.
    #[error("must be one line of 1 to {0} characters")]
    Text(usize),
}

/// The parts of a filter as the API carries them: `kind` plus the fields it takes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FilterParts {
    /// The kind.
    pub kind: String,
    /// `last_visit`: visits before this date (`YYYY-MM-DD`).
    pub before: Option<String>,
    /// `last_visit`: visits on or after this date.
    pub after: Option<String>,
    /// `birthday_month`: 1 to 12.
    pub month: Option<i32>,
    /// `age_band`: youngest age in years.
    pub min: Option<i32>,
    /// `age_band`: oldest age in years.
    pub max: Option<i32>,
    /// `sex`: a [`FilterSex`].
    pub sex: Option<String>,
    /// `tag`: a patient tag.
    pub tag: Option<String>,
}

/// An audience filter, checked: the only ways a clinic may pick patients to market to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AudienceFilter {
    /// Every active patient.
    AllActive,
    /// Last visit before and/or on or after a date.
    LastVisit {
        /// Earlier than this date.
        before: Option<Date>,
        /// On or after this date.
        after: Option<Date>,
    },
    /// Born in a month.
    BirthdayMonth(u8),
    /// Aged within a band, in whole years, both ends included.
    AgeBand {
        /// Youngest.
        min: u8,
        /// Oldest.
        max: u8,
    },
    /// Of one sex.
    Sex(FilterSex),
    /// Carrying a tag.
    Tag(String),
}

fn date(field: &'static str, text: &str) -> Result<Date, CampaignError> {
    let mut parts = text.split('-');
    let (Some(y), Some(m), Some(d), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(CampaignError::Field(field));
    };
    let year = y.parse::<i32>().map_err(|_| CampaignError::Field(field))?;
    let month = m
        .parse::<u8>()
        .ok()
        .and_then(|m| Month::try_from(m).ok())
        .ok_or(CampaignError::Field(field))?;
    let day = d.parse::<u8>().map_err(|_| CampaignError::Field(field))?;
    if y.len() != 4 || !(1900..=2200).contains(&year) {
        return Err(CampaignError::Field(field));
    }
    Date::from_calendar_date(year, month, day).map_err(|_| CampaignError::Field(field))
}

fn age(field: &'static str, value: i32) -> Result<u8, CampaignError> {
    u8::try_from(value)
        .ok()
        .filter(|years| *years <= 120)
        .ok_or(CampaignError::Field(field))
}

impl AudienceFilter {
    /// Checks the parts of a filter: its kind, the fields it needs and no others.
    ///
    /// # Errors
    /// [`CampaignError`] for an unknown kind, a missing or out-of-range field, or an extra one.
    pub fn from_parts(parts: &FilterParts) -> Result<Self, CampaignError> {
        let fields: &[&str] = match parts.kind.as_str() {
            "all_active" => &[],
            "last_visit" => &["before", "after"],
            "birthday_month" => &["month"],
            "age_band" => &["min", "max"],
            "sex" => &["sex"],
            "tag" => &["tag"],
            _ => return Err(CampaignError::Kind),
        };
        let given = [
            ("before", parts.before.is_some()),
            ("after", parts.after.is_some()),
            ("month", parts.month.is_some()),
            ("min", parts.min.is_some()),
            ("max", parts.max.is_some()),
            ("sex", parts.sex.is_some()),
            ("tag", parts.tag.is_some()),
        ];
        if let Some((name, _)) = given
            .iter()
            .find(|(name, set)| *set && !fields.contains(name))
        {
            return Err(CampaignError::Extra(name));
        }
        match parts.kind.as_str() {
            "last_visit" => {
                let before = parts
                    .before
                    .as_deref()
                    .map(|t| date("before", t))
                    .transpose()?;
                let after = parts
                    .after
                    .as_deref()
                    .map(|t| date("after", t))
                    .transpose()?;
                if before.is_none() && after.is_none() {
                    return Err(CampaignError::Field("before"));
                }
                Ok(Self::LastVisit { before, after })
            }
            "birthday_month" => {
                let month = parts.month.ok_or(CampaignError::Field("month"))?;
                u8::try_from(month)
                    .ok()
                    .filter(|m| (1..=12).contains(m))
                    .map(Self::BirthdayMonth)
                    .ok_or(CampaignError::Field("month"))
            }
            "age_band" => {
                let min = age("min", parts.min.ok_or(CampaignError::Field("min"))?)?;
                let max = age("max", parts.max.ok_or(CampaignError::Field("max"))?)?;
                if min > max {
                    return Err(CampaignError::Field("max"));
                }
                Ok(Self::AgeBand { min, max })
            }
            "sex" => {
                let sex = parts.sex.as_deref().ok_or(CampaignError::Field("sex"))?;
                FilterSex::parse(sex)
                    .map(Self::Sex)
                    .map_err(|_| CampaignError::Field("sex"))
            }
            "tag" => {
                let tag = parts
                    .tag
                    .as_deref()
                    .ok_or(CampaignError::Field("tag"))?
                    .trim();
                if tag.is_empty() || tag.chars().count() > 40 || tag.chars().any(char::is_control) {
                    return Err(CampaignError::Field("tag"));
                }
                Ok(Self::Tag(tag.to_owned()))
            }
            _ => Ok(Self::AllActive),
        }
    }

    /// Reads a stored filter back (the database only holds what [`Self::to_json`] wrote).
    ///
    /// # Errors
    /// [`CampaignError`] when the value isn't a filter.
    pub fn from_json(value: &Value) -> Result<Self, CampaignError> {
        let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);
        let number = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_i64)
                .and_then(|n| i32::try_from(n).ok())
        };
        Self::from_parts(&FilterParts {
            kind: text("kind").unwrap_or_default(),
            before: text("before"),
            after: text("after"),
            month: number("month"),
            min: number("min"),
            max: number("max"),
            sex: text("sex"),
            tag: text("tag"),
        })
    }

    /// The stored form, the same for the same filter (it is hashed into count tokens).
    #[must_use]
    pub fn to_json(&self) -> Value {
        match self {
            Self::AllActive => json!({ "kind": "all_active" }),
            Self::LastVisit { before, after } => {
                let mut value = json!({ "kind": "last_visit" });
                if let Some(day) = before {
                    value["before"] = json!(day.to_string());
                }
                if let Some(day) = after {
                    value["after"] = json!(day.to_string());
                }
                value
            }
            Self::BirthdayMonth(month) => json!({ "kind": "birthday_month", "month": month }),
            Self::AgeBand { min, max } => json!({ "kind": "age_band", "min": min, "max": max }),
            Self::Sex(sex) => json!({ "kind": "sex", "sex": sex.as_str() }),
            Self::Tag(tag) => json!({ "kind": "tag", "tag": tag }),
        }
    }
}

/// A name, offer text or similar: one line of 1 to `max` characters, trimmed.
///
/// # Errors
/// [`CampaignError::Text`] when it is empty, too long or spans lines.
pub fn one_line(text: &str, max: usize) -> Result<String, CampaignError> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > max || text.contains(['\n', '\r']) {
        return Err(CampaignError::Text(max));
    }
    Ok(text.to_owned())
}

/// Whether a campaign due at `at` may still be scheduled at `now`.
#[must_use]
pub fn schedulable(at: OffsetDateTime, now: OffsetDateTime) -> bool {
    at >= now - MAX_PAST
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(kind: &str) -> FilterParts {
        FilterParts {
            kind: kind.to_owned(),
            ..FilterParts::default()
        }
    }

    #[test]
    fn filters_round_trip_and_refuse_what_they_do_not_take() {
        let band = FilterParts {
            min: Some(18),
            max: Some(40),
            ..parts("age_band")
        };
        let filter = AudienceFilter::from_parts(&band).unwrap();
        assert_eq!(
            filter.to_json(),
            json!({ "kind": "age_band", "min": 18, "max": 40 })
        );
        assert_eq!(
            AudienceFilter::from_json(&filter.to_json()).unwrap(),
            filter
        );
        let visit = FilterParts {
            before: Some("2026-01-31".into()),
            ..parts("last_visit")
        };
        let filter = AudienceFilter::from_parts(&visit).unwrap();
        assert_eq!(
            AudienceFilter::from_json(&filter.to_json()).unwrap(),
            filter
        );

        for kind in ["has_balance", "treatment", "visit_kind", ""] {
            assert_eq!(
                AudienceFilter::from_parts(&parts(kind)),
                Err(CampaignError::Kind)
            );
        }
        assert!(
            AudienceFilter::from_parts(&FilterParts {
                tag: Some("x".into()),
                ..parts("all_active")
            })
            .is_err()
        );
        assert!(
            AudienceFilter::from_parts(&FilterParts {
                min: Some(50),
                max: Some(40),
                ..parts("age_band")
            })
            .is_err()
        );
        assert!(
            AudienceFilter::from_parts(&FilterParts {
                month: Some(13),
                ..parts("birthday_month")
            })
            .is_err()
        );
        assert!(
            AudienceFilter::from_parts(&FilterParts {
                before: Some("2026-02-30".into()),
                ..parts("last_visit")
            })
            .is_err()
        );
        assert!(AudienceFilter::from_parts(&parts("last_visit")).is_err());
        assert!(
            AudienceFilter::from_parts(&FilterParts {
                sex: Some("robot".into()),
                ..parts("sex")
            })
            .is_err()
        );
    }

    #[test]
    fn text_is_one_line() {
        assert_eq!(one_line("  Diwali offer ", 120).unwrap(), "Diwali offer");
        assert!(one_line("a\nb", 120).is_err());
        assert!(one_line("   ", 120).is_err());
        assert!(one_line(&"x".repeat(121), 120).is_err());
    }
}
