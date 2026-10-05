//! Request counts, error rates and latency percentiles for the console's Service health page.
//!
//! [`ServiceMetrics`] keeps a latency histogram and status counts in memory, per minute for the
//! last 60 minutes and per hour for the last 168 hours, for the whole API and for each method
//! and route. [`track`] is the middleware that feeds it, and [`ServiceMetrics::snapshot`] reads
//! a [`Range`] back as an [`ApiSnapshot`]. Each instance sees only its own requests, so in
//! production the console reads Cloud Monitoring; this collector serves local runs and tests.
//!
//! # Wiring
//!
//! Add [`track`] after the standard layers. It then runs outermost, so it also counts their
//! timeout and panic responses, yet still after routing, so the matched route is known:
//!
//! ```
//! use std::sync::Arc;
//!
//! use aarogyam_api::metrics::{ServiceMetrics, track};
//! use axum::{Router, middleware, routing::get};
//! use sakalya_http::HttpConfig;
//!
//! let metrics = Arc::new(ServiceMetrics::new());
//! let routes = Router::new().route("/api/v1/patients/{id}", get(|| async { "patient" }));
//! let app: Router = sakalya_http::with_standard_layers(routes, &HttpConfig::default())
//!     .layer(middleware::from_fn_with_state(Arc::clone(&metrics), track));
//! ```
//!
//! # Rules
//!
//! - **Routes are templates** from [`MatchedPath`], such as `/api/v1/patients/{id}`, never raw
//!   paths, so no IDs or names reach the metrics. Requests that matched no route are counted
//!   as [`UNMATCHED`]. At most [`MAX_ROUTES`] method and route pairs are kept apart;
//!   later pairs are counted under the route [`OTHER`]. Methods other than the nine standard
//!   ones are counted as the method `OTHER`, so invented methods cannot add rows.
//! - **Success** is any status below 500 except 429 Too Many Requests: a client's mistake is
//!   not a failure of the service, but turning callers away is. Errors are the rest: 5xx and
//!   429.
//! - **Latency buckets** end at 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000 and 10 000 ms.
//!   Each holds requests slower than the previous bound and no slower than its own; an open
//!   bucket holds the rest.
//! - **Percentiles** are estimated as Prometheus's `histogram_quantile` does: take the bucket
//!   holding the request at rank `q × requests`, then interpolate linearly between its bounds,
//!   as if its requests were spread evenly. A percentile in the open bucket reports 10 000 ms.
//! - **Slots** are whole UTC minutes and hours. A slot is emptied when the clock comes round to
//!   it again, so old counts never leak into a new period.

use std::collections::HashMap;
use std::fmt;
use std::ops::RangeInclusive;
use std::str::FromStr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{MatchedPath, Request, State};
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use serde::Serialize;
use time::OffsetDateTime;

/// Most method and route pairs counted separately, which bounds memory (about 15 KB a pair).
/// Requests for later pairs are counted under the route [`OTHER`].
pub const MAX_ROUTES: usize = 200;

/// The route that pairs past [`MAX_ROUTES`] are counted under.
pub const OTHER: &str = "other";

/// The route [`track`] records for requests that matched no route.
pub const UNMATCHED: &str = "unmatched";

/// Middleware that times each request and records it in [`ServiceMetrics`] under its matched
/// route template, or [`UNMATCHED`]. See the module docs for where to add it.
///
/// Latency runs until the response head is ready, so a streamed body is not timed. A request
/// dropped before it is answered, because the client went away, is not counted.
pub async fn track(
    State(metrics): State<Arc<ServiceMetrics>>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let route = request.extensions().get::<MatchedPath>().cloned();
    let started = Instant::now();
    let response = next.run(request).await;
    let route = route.as_ref().map_or(UNMATCHED, MatchedPath::as_str);
    metrics.record(&method, route, response.status(), started.elapsed());
    response
}

/// Upper bounds of the latency buckets in milliseconds; an open bucket follows the last.
const BOUNDS_MS: [u32; 11] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000];
const BUCKETS: usize = BOUNDS_MS.len() + 1;
const MINUTE: u64 = 60;
const HOUR: u64 = 3600;
/// Minute slots kept for each route: six hours.
const ROUTE_MINUTE_SLOTS: u32 = 360;
/// Minute slots kept for the whole API: one day, so the timeline can show a day per minute.
const OVERALL_MINUTE_SLOTS: u32 = 1440;
/// Hour slots kept: one week.
const HOUR_SLOTS: u32 = 168;
/// 9999-12-31T23:59:59Z, the last second RFC 3339 can write. Later clocks are clamped to it.
const LAST_SECOND: u64 = 253_402_300_799;

/// Request metrics for the whole API and for each route, kept in memory.
///
/// Share one as `Arc<ServiceMetrics>`. Recording takes a short lock and allocates nothing once
/// the route has been seen.
pub struct ServiceMetrics {
    inner: Mutex<Inner>,
}

impl ServiceMetrics {
    /// Creates an empty collector.
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner::new()),
        }
    }

    /// Records one answered request under its method and matched route template (such as
    /// `/api/v1/patients/{id}`, never the raw path).
    pub fn record(&self, method: &Method, route: &str, status: StatusCode, latency: Duration) {
        let now = unix_seconds(SystemTime::now());
        self.record_at(now, method, route, status, latency);
    }

    /// [`Self::record`] for a request answered `unix_seconds` after the epoch.
    fn record_at(
        &self,
        unix_seconds: u64,
        method: &Method,
        route: &str,
        status: StatusCode,
        latency: Duration,
    ) {
        let sample = Sample::new(unix_seconds, status, latency);
        self.lock().record(method_index(method), route, &sample);
    }

    /// Summarises `range`, ending with the minute or hour that holds `now`.
    #[must_use]
    pub fn snapshot(&self, range: Range, now: SystemTime) -> ApiSnapshot {
        let (seconds, slots) = range.slots();
        let last = period(unix_seconds(now), seconds);
        let periods = last.saturating_sub(slots - 1)..=last;
        // Only sum under the lock; percentiles and sorting happen after it is released.
        let (timeline_seconds, timeline_steps, _) = range.timeline();
        let (overall, points, timeline, routes) = {
            let inner = self.lock();
            let ring = inner.overall.ring(range);
            let points: Vec<_> = periods.clone().map(|p| (p, ring.totals(p..=p))).collect();
            let timeline = inner.overall.timeline(range, unix_seconds(now));
            let mut routes = Vec::new();
            for (method, by_route) in inner.routes.iter().enumerate() {
                for (route, series) in by_route {
                    let totals = series.ring(range).totals(periods.clone());
                    if totals.requests() > 0 {
                        routes.push((method, route.clone(), totals));
                    }
                }
            }
            (ring.totals(periods), points, timeline, routes)
        };
        let mut routes: Vec<RouteStats> = routes
            .into_iter()
            .map(|(method, route, totals)| RouteStats {
                method: method_name(method),
                route,
                requests: totals.requests(),
                error_rate: ratio(totals.errors(), totals.requests()),
                p95_ms: totals.percentile(0.95),
                p99_ms: totals.percentile(0.99),
            })
            .collect();
        routes.sort_unstable_by(|a, b| {
            (b.requests.cmp(&a.requests))
                .then_with(|| a.route.cmp(&b.route))
                .then_with(|| a.method.cmp(b.method))
        });
        let requests = overall.requests();
        ApiSnapshot {
            requests,
            success_rate: ratio(requests.saturating_sub(overall.errors()), requests),
            rate_4xx: ratio(overall.client_errors, requests),
            rate_5xx: ratio(overall.server_errors, requests),
            p50_ms: overall.percentile(0.50),
            p95_ms: overall.percentile(0.95),
            p99_ms: overall.percentile(0.99),
            series: points
                .iter()
                .map(|(period, totals)| SeriesPoint {
                    at: start_of(*period, seconds),
                    requests: totals.requests(),
                    errors: totals.errors(),
                    p95_ms: totals.percentile(0.95),
                })
                .collect(),
            timeline_interval_seconds: timeline_seconds * timeline_steps,
            timeline: timeline
                .iter()
                .map(|(period, totals)| TimelinePoint {
                    at: start_of(*period, timeline_seconds),
                    requests: totals.requests(),
                    errors_4xx: totals.client_errors.saturating_sub(totals.throttled),
                    errors_429: totals.throttled,
                    errors_5xx: totals.server_errors,
                    p50_ms: totals.percentile(0.50),
                    p95_ms: totals.percentile(0.95),
                    p99_ms: totals.percentile(0.99),
                })
                .collect(),
            routes: routes.into(),
        }
    }

    /// Locks the counters. A panic elsewhere cannot leave plain counters half-written in a way
    /// that matters, so a poisoned lock is taken over.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Default for ServiceMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for ServiceMetrics {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServiceMetrics").finish_non_exhaustive()
    }
}

/// The window a [`ServiceMetrics::snapshot`] covers, and its resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Range {
    /// `1h`: the current minute and the 59 before it, one point per minute.
    LastHour,
    /// `6h`: the current minute and the 359 before it, one point per minute.
    LastSixHours,
    /// `24h`: the current hour and the 23 before it, one point per hour.
    LastDay,
    /// `7d`: the current hour and the 167 before it, one point per hour.
    LastWeek,
}

impl Range {
    /// The text [`str::parse`] accepts for this range: `1h`, `6h`, `24h` or `7d`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LastHour => "1h",
            Self::LastSixHours => "6h",
            Self::LastDay => "24h",
            Self::LastWeek => "7d",
        }
    }

    /// The timeline's resolution: seconds per stored slot, slots merged into each point, and
    /// points. A day is shown at five minutes a point to keep the response small.
    const fn timeline(self) -> (u64, u64, u64) {
        match self {
            Self::LastHour => (MINUTE, 1, 60),
            Self::LastSixHours => (MINUTE, 1, 360),
            Self::LastDay => (MINUTE, 5, 288),
            Self::LastWeek => (HOUR, 1, 168),
        }
    }

    /// Seconds per slot, and slots in the window.
    const fn slots(self) -> (u64, u32) {
        match self {
            Self::LastHour => (MINUTE, 60),
            Self::LastSixHours => (MINUTE, 360),
            Self::LastDay => (HOUR, 24),
            Self::LastWeek => (HOUR, HOUR_SLOTS),
        }
    }
}

impl FromStr for Range {
    type Err = UnknownRange;

    fn from_str(text: &str) -> Result<Self, Self::Err> {
        match text {
            "1h" => Ok(Self::LastHour),
            "6h" => Ok(Self::LastSixHours),
            "24h" => Ok(Self::LastDay),
            "7d" => Ok(Self::LastWeek),
            _ => Err(UnknownRange),
        }
    }
}

impl fmt::Display for Range {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The text was not `1h`, `6h`, `24h` or `7d`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("unknown range, expected 1h, 6h, 24h or 7d")]
pub struct UnknownRange;

/// Service health over one [`Range`], as the console's Service health page reads it.
///
/// Rates are fractions from 0.0 to 1.0 and latencies are estimated percentiles in milliseconds
/// (see the module docs); all are 0.0 when there were no requests.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApiSnapshot {
    /// Requests answered in the range.
    pub requests: u64,
    /// Share that succeeded: any status below 500 except 429.
    pub success_rate: f64,
    /// Share answered with a 4xx status, 429 included.
    pub rate_4xx: f64,
    /// Share answered with a 5xx status.
    pub rate_5xx: f64,
    /// Median latency.
    pub p50_ms: f64,
    /// 95th percentile latency.
    pub p95_ms: f64,
    /// 99th percentile latency.
    pub p99_ms: f64,
    /// One point per minute (`1h`) or hour (`24h`, `7d`), oldest first; the last is the
    /// current, unfinished one.
    pub series: Box<[SeriesPoint]>,
    /// Seconds between `timeline` points: 60 for `1h` and `6h`, 300 for `24h`, 3600 for `7d`.
    pub timeline_interval_seconds: u64,
    /// Requests, errors by class and latency percentiles per interval, oldest first; the last
    /// point is the current, unfinished one.
    pub timeline: Box<[TimelinePoint]>,
    /// Each method and route with requests in the range, busiest first.
    pub routes: Box<[RouteStats]>,
}

/// One minute or hour of an [`ApiSnapshot`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SeriesPoint {
    /// When the minute or hour starts, written as RFC 3339 in UTC (`2026-10-03T09:14:00Z`).
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    /// Requests answered.
    pub requests: u64,
    /// Requests that failed: 5xx or 429.
    pub errors: u64,
    /// 95th percentile latency in milliseconds.
    pub p95_ms: f64,
}

/// One interval of an [`ApiSnapshot`]'s timeline.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TimelinePoint {
    /// When the interval starts, as RFC 3339 in UTC.
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    /// Requests answered.
    pub requests: u64,
    /// Answered with a 4xx status other than 429.
    pub errors_4xx: u64,
    /// Answered with 429 Too Many Requests.
    pub errors_429: u64,
    /// Answered with a 5xx status.
    pub errors_5xx: u64,
    /// Median latency in milliseconds.
    pub p50_ms: f64,
    /// 95th percentile latency in milliseconds.
    pub p95_ms: f64,
    /// 99th percentile latency in milliseconds.
    pub p99_ms: f64,
}

/// One method and route of an [`ApiSnapshot`].
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RouteStats {
    /// `GET`, `POST` or another standard method, or `OTHER`.
    pub method: &'static str,
    /// The route template, such as `/api/v1/patients/{id}`, or [`UNMATCHED`] or [`OTHER`].
    pub route: Box<str>,
    /// Requests answered.
    pub requests: u64,
    /// Share that failed: 5xx or 429.
    pub error_rate: f64,
    /// 95th percentile latency in milliseconds.
    pub p95_ms: f64,
    /// 99th percentile latency in milliseconds.
    pub p99_ms: f64,
}

/// Everything behind the lock.
struct Inner {
    overall: Series,
    /// One map per method index (see [`METHODS`]), so lookups borrow the route text.
    routes: [HashMap<Box<str>, Series>; STANDARD_METHODS + 1],
    /// Pairs in `routes`, not counting [`OTHER`].
    tracked: usize,
}

impl Inner {
    fn new() -> Self {
        Self {
            overall: Series::new(OVERALL_MINUTE_SLOTS),
            routes: Default::default(),
            tracked: 0,
        }
    }

    fn record(&mut self, method: usize, route: &str, sample: &Sample) {
        self.overall.add(sample);
        let Some(routes) = self.routes.get_mut(method) else {
            return;
        };
        if let Some(series) = routes.get_mut(route) {
            series.add(sample);
            return;
        }
        let route = if self.tracked < MAX_ROUTES {
            self.tracked += 1;
            route
        } else {
            OTHER
        };
        if let Some(series) = routes.get_mut(route) {
            series.add(sample);
        } else {
            let mut series = Series::new(ROUTE_MINUTE_SLOTS);
            series.add(sample);
            routes.insert(route.into(), series);
        }
    }
}

/// The minute and hour rings of the whole API or one route.
struct Series {
    minutes: Ring,
    hours: Ring,
}

impl Series {
    fn new(minute_slots: u32) -> Self {
        Self {
            minutes: Ring::new(minute_slots),
            hours: Ring::new(HOUR_SLOTS),
        }
    }

    /// The timeline of `range` ending at `now`: the start period and totals of each point,
    /// oldest first. Periods are minutes or hours as [`Range::timeline`] says.
    fn timeline(&self, range: Range, now: u64) -> Vec<(u32, Totals)> {
        let (seconds, step, points) = range.timeline();
        let ring = if seconds == MINUTE {
            &self.minutes
        } else {
            &self.hours
        };
        let last = u64::from(period(now, seconds));
        let mut timeline: Vec<(u32, Totals)> = (0..points)
            .filter_map(|back| {
                let end = last.checked_sub(back * step)?;
                let start = end.saturating_sub(step - 1);
                let (start, end) = (u32::try_from(start).ok()?, u32::try_from(end).ok()?);
                Some((start, ring.totals(start..=end)))
            })
            .collect();
        timeline.reverse();
        timeline
    }

    fn add(&mut self, sample: &Sample) {
        if let Some(slot) = self.minutes.slot_mut(sample.minute) {
            slot.add(sample);
        }
        if let Some(slot) = self.hours.slot_mut(sample.hour) {
            slot.add(sample);
        }
    }

    const fn ring(&self, range: Range) -> &Ring {
        match range {
            Range::LastHour | Range::LastSixHours => &self.minutes,
            Range::LastDay | Range::LastWeek => &self.hours,
        }
    }
}

/// Slots indexed by period (minutes or hours since the epoch) modulo their number.
struct Ring {
    slots: Box<[Slot]>,
}

impl Ring {
    fn new(len: u32) -> Self {
        Self {
            slots: vec![Slot::default(); len as usize].into(),
        }
    }

    /// The slot for `period`, emptied first if it holds an older one. `None` if it already
    /// holds a newer one: the clock stepped back further than the ring reaches.
    fn slot_mut(&mut self, period: u32) -> Option<&mut Slot> {
        let index = (period as usize).checked_rem(self.slots.len())?;
        let slot = self.slots.get_mut(index)?;
        if slot.period < period {
            *slot = Slot {
                period,
                ..Slot::default()
            };
        }
        (slot.period == period).then_some(slot)
    }

    /// The slot for `period`, unless it holds another period.
    fn slot(&self, period: u32) -> Option<&Slot> {
        let index = (period as usize).checked_rem(self.slots.len())?;
        self.slots.get(index).filter(|slot| slot.period == period)
    }

    fn totals(&self, periods: RangeInclusive<u32>) -> Totals {
        let mut totals = Totals::default();
        for slot in periods.filter_map(|period| self.slot(period)) {
            totals.add(slot);
        }
        totals
    }
}

/// One minute or hour: the period it holds, the latency buckets and the status counts. Sixteen
/// `u32`s, one cache line; counts saturate rather than wrap.
#[derive(Debug, Clone, Copy, Default)]
struct Slot {
    period: u32,
    buckets: [u32; BUCKETS],
    client_errors: u32,
    server_errors: u32,
    throttled: u32,
}

impl Slot {
    fn add(&mut self, sample: &Sample) {
        if let Some(count) = self.buckets.get_mut(sample.bucket) {
            *count = count.saturating_add(1);
        }
        self.client_errors = (self.client_errors).saturating_add(sample.client_error.into());
        self.server_errors = (self.server_errors).saturating_add(sample.server_error.into());
        self.throttled = (self.throttled).saturating_add(sample.throttled.into());
    }
}

/// Slots summed in `u64`, so a busy week cannot overflow.
#[derive(Debug, Clone, Copy, Default)]
struct Totals {
    buckets: [u64; BUCKETS],
    client_errors: u64,
    server_errors: u64,
    throttled: u64,
}

impl Totals {
    fn add(&mut self, slot: &Slot) {
        for (total, count) in self.buckets.iter_mut().zip(slot.buckets) {
            *total += u64::from(count);
        }
        self.client_errors += u64::from(slot.client_errors);
        self.server_errors += u64::from(slot.server_errors);
        self.throttled += u64::from(slot.throttled);
    }

    fn requests(&self) -> u64 {
        self.buckets.iter().sum()
    }

    /// Requests that failed: 5xx or 429.
    fn errors(&self) -> u64 {
        self.server_errors + self.throttled
    }

    /// Estimates the latency under which a share `q` of requests finished, in milliseconds,
    /// by linear interpolation inside the bucket that holds rank `q × requests`.
    fn percentile(&self, q: f64) -> f64 {
        let requests = self.requests();
        if requests == 0 {
            return 0.0;
        }
        let rank = q * as_f64(requests);
        let (mut below, mut lower) = (0, 0.0);
        for (&count, &upper) in self.buckets.iter().zip(&BOUNDS_MS) {
            let upper = f64::from(upper);
            if count > 0 && as_f64(below + count) >= rank {
                return lower + (upper - lower) * (rank - as_f64(below)) / as_f64(count);
            }
            below += count;
            lower = upper;
        }
        lower
    }
}

/// One request, classified before the lock is taken.
#[derive(Debug, Clone, Copy)]
struct Sample {
    minute: u32,
    hour: u32,
    bucket: usize,
    client_error: bool,
    server_error: bool,
    throttled: bool,
}

impl Sample {
    fn new(unix_seconds: u64, status: StatusCode, latency: Duration) -> Self {
        let bucket = BOUNDS_MS
            .iter()
            .position(|&ms| latency <= Duration::from_millis(ms.into()))
            .unwrap_or(BOUNDS_MS.len());
        Self {
            minute: period(unix_seconds, MINUTE),
            hour: period(unix_seconds, HOUR),
            bucket,
            client_error: status.is_client_error(),
            server_error: status.as_u16() >= 500,
            throttled: status == StatusCode::TOO_MANY_REQUESTS,
        }
    }
}

/// Methods kept apart, by index. Any other method counts at index `STANDARD_METHODS`, named
/// `OTHER`, so invented methods cannot add rows.
static METHODS: [Method; STANDARD_METHODS] = [
    Method::GET,
    Method::HEAD,
    Method::POST,
    Method::PUT,
    Method::PATCH,
    Method::DELETE,
    Method::OPTIONS,
    Method::TRACE,
    Method::CONNECT,
];
const STANDARD_METHODS: usize = 9;

fn method_index(method: &Method) -> usize {
    METHODS
        .iter()
        .position(|known| known == method)
        .unwrap_or(STANDARD_METHODS)
}

fn method_name(index: usize) -> &'static str {
    METHODS.get(index).map_or("OTHER", Method::as_str)
}

/// Whole seconds since the epoch, from 0 up to [`LAST_SECOND`].
fn unix_seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
        .min(LAST_SECOND)
}

/// The minute or hour (`seconds` long) since the epoch that `unix_seconds` falls in.
fn period(unix_seconds: u64, seconds: u64) -> u32 {
    u32::try_from(unix_seconds / seconds).unwrap_or(u32::MAX)
}

/// When a slot starts. Clamping to [`LAST_SECOND`] keeps the fallback unreachable.
fn start_of(period: u32, seconds: u64) -> OffsetDateTime {
    i64::try_from(u64::from(period) * seconds)
        .ok()
        .and_then(|unix| OffsetDateTime::from_unix_timestamp(unix).ok())
        .unwrap_or(OffsetDateTime::UNIX_EPOCH)
}

/// `part / whole`, or 0.0 when `whole` is zero.
fn ratio(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        as_f64(part) / as_f64(whole)
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "request counts stay far below 2^53, where f64 is exact"
)]
fn as_f64(count: u64) -> f64 {
    count as f64
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    /// 3 October 2026, 09:14:30 UTC.
    fn now() -> u64 {
        u64::try_from(datetime!(2026-10-03 09:14:30 UTC).unix_timestamp()).unwrap()
    }

    fn at(unix_seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(unix_seconds)
    }

    fn get(metrics: &ServiceMetrics, unix_seconds: u64, route: &str, status: u16, millis: u64) {
        let status = StatusCode::from_u16(status).unwrap();
        let latency = Duration::from_millis(millis);
        metrics.record_at(unix_seconds, &Method::GET, route, status, latency);
    }

    fn last_hour(metrics: &ServiceMetrics) -> ApiSnapshot {
        metrics.snapshot(Range::LastHour, at(now()))
    }

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "{actual} is not {expected}"
        );
    }

    #[test]
    fn percentiles_interpolate_inside_the_bucket() {
        // (latency in ms, requests) => [p50, p95, p99]
        type Case = (&'static [(u64, u32)], [f64; 3]);
        let cases: [Case; 5] = [
            (&[], [0.0, 0.0, 0.0]),
            (&[(20, 100)], [17.5, 24.25, 24.85]),
            // Exactly 25 ms belongs to the 10–25 ms bucket.
            (&[(25, 1)], [17.5, 24.25, 24.85]),
            (&[(3, 50), (7, 40), (120, 10)], [5.0, 175.0, 235.0]),
            // The open bucket reports its lower bound.
            (&[(30_000, 10)], [10_000.0, 10_000.0, 10_000.0]),
        ];
        for (requests, [p50, p95, p99]) in cases {
            let metrics = ServiceMetrics::new();
            for &(millis, count) in requests {
                for _ in 0..count {
                    get(&metrics, now(), "/r", 200, millis);
                }
            }
            let snapshot = last_hour(&metrics);
            assert_close(snapshot.p50_ms, p50);
            assert_close(snapshot.p95_ms, p95);
            assert_close(snapshot.p99_ms, p99);
        }
    }

    #[test]
    fn errors_are_5xx_and_429_and_everything_else_succeeds() {
        let metrics = ServiceMetrics::new();
        for status in [200, 302, 404, 429, 500, 503] {
            get(&metrics, now(), "/r", status, 10);
        }
        let snapshot = last_hour(&metrics);
        assert_close(snapshot.success_rate, 0.5);
        assert_close(snapshot.rate_4xx, 2.0 / 6.0);
        assert_close(snapshot.rate_5xx, 2.0 / 6.0);
        assert_close(snapshot.routes[0].error_rate, 0.5);
        assert_eq!(snapshot.series.iter().map(|p| p.errors).sum::<u64>(), 3);
    }

    #[test]
    fn rates_are_zero_without_requests() {
        let snapshot = last_hour(&ServiceMetrics::new());
        assert_eq!(snapshot.requests, 0);
        for rate in [snapshot.success_rate, snapshot.rate_4xx, snapshot.rate_5xx] {
            assert_close(rate, 0.0);
        }
        assert!(snapshot.routes.is_empty());
    }

    #[test]
    fn a_minute_slot_is_reset_when_reused_an_hour_later() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now(), "/r", 200, 10);
        let later = now() + HOUR;
        get(&metrics, later, "/r", 500, 10);
        let snapshot = metrics.snapshot(Range::LastHour, at(later));
        assert_eq!(snapshot.requests, 1);
        assert_close(snapshot.rate_5xx, 1.0);
        assert_eq!(metrics.snapshot(Range::LastDay, at(later)).requests, 2);
    }

    #[test]
    fn an_hour_slot_is_reset_when_reused_a_week_later() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now(), "/r", 200, 10);
        let later = now() + 168 * HOUR;
        get(&metrics, later, "/r", 200, 10);
        assert_eq!(metrics.snapshot(Range::LastWeek, at(later)).requests, 1);
    }

    #[test]
    fn a_late_record_does_not_overwrite_a_newer_slot() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now() + HOUR, "/r", 200, 10);
        get(&metrics, now(), "/r", 200, 10);
        let snapshot = metrics.snapshot(Range::LastHour, at(now() + HOUR));
        assert_eq!(snapshot.requests, 1);
    }

    #[test]
    fn ranges_choose_their_window_and_resolution() {
        let metrics = ServiceMetrics::new();
        for ago in [0, 2 * HOUR, 2 * 24 * HOUR] {
            get(&metrics, now() - ago, "/r", 200, 10);
        }
        let hour = datetime!(2026-10-03 09:00 UTC);
        let cases = [
            (Range::LastHour, 1, 60, datetime!(2026-10-03 09:14 UTC), 60),
            (
                Range::LastSixHours,
                2,
                360,
                datetime!(2026-10-03 09:14 UTC),
                60,
            ),
            (Range::LastDay, 2, 24, hour, 3600),
            (Range::LastWeek, 3, 168, hour, 3600),
        ];
        for (range, requests, points, last, step) in cases {
            let snapshot = metrics.snapshot(range, at(now()));
            assert_eq!(snapshot.requests, requests, "{range}");
            assert_eq!(snapshot.series.len(), points, "{range}");
            assert_eq!(snapshot.series[points - 1].at, last, "{range}");
            let gap = snapshot.series[1].at - snapshot.series[0].at;
            assert_eq!(gap.whole_seconds(), step, "{range}");
        }
    }

    #[test]
    fn ranges_parse_from_their_query_values() {
        for range in [
            Range::LastHour,
            Range::LastSixHours,
            Range::LastDay,
            Range::LastWeek,
        ] {
            assert_eq!(range.as_str().parse(), Ok(range));
        }
        assert_eq!("2h".parse::<Range>(), Err(UnknownRange));
    }

    #[test]
    fn routes_past_the_cap_are_counted_as_other() {
        let metrics = ServiceMetrics::new();
        for index in 0..MAX_ROUTES + 2 {
            get(&metrics, now(), &format!("/r/{index}"), 200, 10);
        }
        get(&metrics, now(), "/r/0", 200, 10);
        let snapshot = last_hour(&metrics);
        let requests = |route: &str| {
            let row = snapshot.routes.iter().find(|row| &*row.route == route);
            row.map(|row| row.requests)
        };
        assert_eq!(snapshot.routes.len(), MAX_ROUTES + 1);
        assert_eq!(requests(OTHER), Some(2));
        assert_eq!(requests("/r/0"), Some(2));
        assert_eq!(requests(&format!("/r/{MAX_ROUTES}")), None);
    }

    #[test]
    fn invented_methods_share_one_row() {
        let metrics = ServiceMetrics::new();
        for method in ["PURGE", "BREW"] {
            let method = Method::from_bytes(method.as_bytes()).unwrap();
            let status = StatusCode::METHOD_NOT_ALLOWED;
            metrics.record_at(now(), &method, "/r", status, Duration::ZERO);
        }
        let snapshot = last_hour(&metrics);
        let rows: Vec<_> = snapshot
            .routes
            .iter()
            .map(|r| (r.method, r.requests))
            .collect();
        assert_eq!(rows, [("OTHER", 2)]);
    }

    #[test]
    fn routes_are_listed_busiest_first() {
        let metrics = ServiceMetrics::new();
        for route in ["/a", "/b", "/b", "/c", "/c", "/c"] {
            get(&metrics, now(), route, 200, 10);
        }
        let snapshot = last_hour(&metrics);
        let order: Vec<&str> = snapshot.routes.iter().map(|r| &*r.route).collect();
        assert_eq!(order, ["/c", "/b", "/a"]);
    }

    #[test]
    fn snapshot_serialises_with_snake_case_names_and_rfc3339_times() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now(), "/api/v1/patients/{id}", 200, 10);
        let json = serde_json::to_value(last_hour(&metrics)).unwrap();
        let keys = |value: &serde_json::Value| {
            let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
            keys.sort();
            keys
        };
        let top = [
            "p50_ms",
            "p95_ms",
            "p99_ms",
            "rate_4xx",
            "rate_5xx",
            "requests",
            "routes",
            "series",
            "success_rate",
            "timeline",
            "timeline_interval_seconds",
        ];
        assert_eq!(keys(&json), top);
        assert_eq!(
            keys(&json["series"][0]),
            ["at", "errors", "p95_ms", "requests"]
        );
        let point = [
            "at",
            "errors_429",
            "errors_4xx",
            "errors_5xx",
            "p50_ms",
            "p95_ms",
            "p99_ms",
            "requests",
        ];
        assert_eq!(keys(&json["timeline"][0]), point);
        let route = [
            "error_rate",
            "method",
            "p95_ms",
            "p99_ms",
            "requests",
            "route",
        ];
        assert_eq!(keys(&json["routes"][0]), route);
        assert_eq!(json["series"][0]["at"], "2026-10-03T08:15:00Z");
        assert_eq!(json["series"][59]["at"], "2026-10-03T09:14:00Z");
    }

    #[test]
    fn the_timeline_splits_errors_by_class_with_percentiles_per_interval() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now(), "/r", 200, 20);
        get(&metrics, now(), "/r", 404, 20);
        get(&metrics, now(), "/r", 429, 20);
        get(&metrics, now(), "/r", 503, 400);
        get(&metrics, now() - 120, "/r", 200, 20);
        let snapshot = last_hour(&metrics);
        assert_eq!(snapshot.timeline_interval_seconds, 60);
        assert_eq!(snapshot.timeline.len(), 60);
        let current = snapshot.timeline.last().unwrap();
        assert_eq!(current.at, datetime!(2026-10-03 09:14 UTC));
        let counts = (
            current.requests,
            current.errors_4xx,
            current.errors_429,
            current.errors_5xx,
        );
        assert_eq!(counts, (4, 1, 1, 1));
        assert!(current.p99_ms > current.p50_ms);
        let earlier = &snapshot.timeline[57];
        assert_eq!((earlier.requests, earlier.errors_4xx), (1, 0));
        assert_eq!(snapshot.timeline[58].requests, 0);
    }

    #[test]
    fn a_day_is_shown_at_five_minutes_a_point_from_minute_counts() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now(), "/r", 200, 10);
        get(&metrics, now() - 23 * HOUR, "/r", 500, 10);
        let snapshot = metrics.snapshot(Range::LastDay, at(now()));
        assert_eq!(snapshot.timeline_interval_seconds, 300);
        assert_eq!(snapshot.timeline.len(), 288);
        let total: u64 = snapshot.timeline.iter().map(|p| p.requests).sum();
        assert_eq!(total, 2);
        assert_eq!(
            snapshot.timeline.iter().map(|p| p.errors_5xx).sum::<u64>(),
            1
        );
        let gap = snapshot.timeline[1].at - snapshot.timeline[0].at;
        assert_eq!(gap.whole_seconds(), 300);
    }

    #[test]
    fn six_hours_keep_per_route_minutes() {
        let metrics = ServiceMetrics::new();
        get(&metrics, now() - 5 * HOUR, "/r", 200, 10);
        let snapshot = metrics.snapshot(Range::LastSixHours, at(now()));
        assert_eq!(snapshot.requests, 1);
        assert_eq!(snapshot.routes.len(), 1);
    }
}
