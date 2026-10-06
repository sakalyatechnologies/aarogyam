//! Reading rows a query returned as JSON (`json_agg`), so that one statement can return several
//! lists. Postgres writes timestamps as RFC 3339, dates as `YYYY-MM-DD` and times of day as
//! `HH:MM:SS`; these formats read them into `time` values.
#![expect(
    missing_docs,
    reason = "time's format_description! generates undocumented modules and functions"
)]

use time::{Date, OffsetDateTime};

pub use time::serde::rfc3339 as timestamp;

time::serde::format_description!(pub date, Date, "[year]-[month]-[day]");

time::serde::format_description!(
    pub time_of_day,
    Time,
    "[hour]:[minute]:[second][optional [.[subsecond]]]"
);

/// An optional date. Unlike `date::option`, it reads `null` inside a `#[serde(flatten)]` struct.
///
/// # Errors
/// The deserializer's error for a value that is not a `YYYY-MM-DD` date or `null`.
pub fn optional_date<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Date>, D::Error> {
    #[derive(serde::Deserialize)]
    struct Day(#[serde(with = "date")] Date);
    let day: Option<Day> = serde::Deserialize::deserialize(deserializer)?;
    Ok(day.map(|day| day.0))
}

/// An optional timestamp. Unlike `timestamp::option`, it reads `null` inside a
/// `#[serde(flatten)]` struct.
///
/// # Errors
/// The deserializer's error for a value that is not an RFC 3339 timestamp or `null`.
pub fn optional_timestamp<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<OffsetDateTime>, D::Error> {
    #[derive(serde::Deserialize)]
    struct At(#[serde(with = "timestamp")] OffsetDateTime);
    let at: Option<At> = serde::Deserialize::deserialize(deserializer)?;
    Ok(at.map(|at| at.0))
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use time::macros::{date, datetime, time};
    use time::{Date, OffsetDateTime, Time};

    #[derive(Debug, Deserialize)]
    struct Row {
        #[serde(with = "super::timestamp")]
        at: OffsetDateTime,
        #[serde(with = "super::timestamp::option")]
        maybe: Option<OffsetDateTime>,
        #[serde(with = "super::date")]
        day: Date,
        #[serde(with = "super::date::option")]
        birthday: Option<Date>,
        #[serde(with = "super::time_of_day")]
        starts: Time,
    }

    #[test]
    fn reads_what_postgres_writes() {
        let row: Row = serde_json::from_str(
            r#"{"at": "2030-01-07T04:30:00.123456+00:00", "maybe": null, "day": "2030-01-07",
                "birthday": "1990-02-03", "starts": "09:30:00"}"#,
        )
        .unwrap();
        assert_eq!(row.at, datetime!(2030-01-07 04:30:00.123456 UTC));
        assert_eq!(row.maybe, None);
        assert_eq!(
            (row.day, row.birthday),
            (date!(2030 - 01 - 07), Some(date!(1990 - 02 - 03)))
        );
        assert_eq!(row.starts, time!(09:30));
    }
}
