//! Cloud Run's own metrics, read from Cloud Monitoring for the console's Insights page
//! (docs/plans/console-insights-design.md, 1a).
//!
//! The in-memory collector in the API sees one instance, and Cloud Run scales to zero, so its
//! numbers reset. Cloud Monitoring keeps Cloud Run's request, latency, instance, CPU and memory
//! metrics for the service and the drain job, and reading them is free within the quota. The
//! token and project id come from the metadata server, so this works only on Google Cloud; a
//! deployment elsewhere (local runs, tests) never builds a [`CloudMonitoring`] and the console
//! falls back to the instance's own numbers.
//!
//! Answers are cached per window for five minutes, so the console costs a few hundred reads a
//! day. Nothing runs in the background: a request that misses the cache makes the calls.
//! There is no clinic concept here, so this moves to `sakalya-backend` once a second product
//! needs it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const METADATA: &str = "http://metadata.google.internal/computeMetadata/v1";
const MONITORING: &str = "https://monitoring.googleapis.com/v3";
const CACHE_FOR: Duration = Duration::from_mins(5);
const TIMEOUT: Duration = Duration::from_secs(10);
/// Pages read per query at most; aggregated answers fit in one.
const MAX_PAGES: usize = 5;

/// Why Cloud Monitoring could not be read. Messages carry status codes, never a token.
#[derive(Debug, Clone, thiserror::Error)]
pub enum CloudError {
    /// The HTTP client could not be built.
    #[error("could not build the HTTP client")]
    Client,
    /// The metadata server did not answer (not on Google Cloud) or refused.
    #[error("metadata server: {0}")]
    Metadata(String),
    /// Cloud Monitoring answered with an error, such as 403 without `roles/monitoring.viewer`.
    #[error("Cloud Monitoring: {0}")]
    Monitoring(String),
}

/// The window to read: its length and the width of each point.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    /// The cache key, such as `24h`.
    pub key: &'static str,
    /// Seconds the window covers, ending now.
    pub seconds: u64,
    /// Seconds per point (Cloud Monitoring's alignment period, at least 60).
    pub step_seconds: u64,
}

/// One point: when its interval starts, and the value over that interval.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Point {
    /// Start of the interval, RFC 3339 in UTC.
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    /// The value.
    pub value: f64,
}

/// Points for one value of a label, such as response class `2xx`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LabelledSeries {
    /// The label's value.
    pub label: String,
    /// Oldest first.
    pub points: Vec<Point>,
}

/// The API service on Cloud Run, all instances and revisions together.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ServiceSeries {
    /// Requests per point by response class (`2xx`, `3xx`, `4xx`, `5xx`).
    pub requests: Vec<LabelledSeries>,
    /// Median latency, ms.
    pub latency_p50_ms: Vec<Point>,
    /// 95th percentile latency, ms.
    pub latency_p95_ms: Vec<Point>,
    /// 99th percentile latency, ms.
    pub latency_p99_ms: Vec<Point>,
    /// Most instances running in the interval.
    pub instances: Vec<Point>,
    /// Instances started (cold starts) in the interval.
    pub cold_starts: Vec<Point>,
    /// 95th percentile CPU utilisation, 0 to 1.
    pub cpu_p95: Vec<Point>,
    /// 95th percentile memory utilisation, 0 to 1.
    pub memory_p95: Vec<Point>,
}

/// The outbox drain job on Cloud Run.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct JobSeries {
    /// Executions finished per point, by result (`succeeded`, `failed`).
    pub executions: Vec<LabelledSeries>,
    /// Billable instance seconds per point.
    pub billable_seconds: Vec<Point>,
    /// vCPU seconds allocated per point.
    pub cpu_seconds: Vec<Point>,
    /// GiB seconds of memory allocated per point.
    pub memory_gib_seconds: Vec<Point>,
}

/// Everything read for one window.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CloudSnapshot {
    /// Seconds per point.
    pub interval_seconds: u64,
    /// The API service.
    pub service: ServiceSeries,
    /// The drain job.
    pub job: JobSeries,
}

/// Reads Cloud Run metrics for one service and one job, with a five-minute cache per window.
pub struct CloudMonitoring {
    client: reqwest::Client,
    service: String,
    job: String,
    token: Mutex<Option<(String, Instant)>>,
    project: Mutex<Option<String>>,
    cache: Mutex<HashMap<&'static str, (Instant, Arc<CloudSnapshot>)>>,
}

impl std::fmt::Debug for CloudMonitoring {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CloudMonitoring")
            .field("service", &self.service)
            .field("job", &self.job)
            .finish_non_exhaustive()
    }
}

impl CloudMonitoring {
    /// Whether this process runs on Cloud Run, where the metadata server answers.
    #[must_use]
    pub fn on_cloud_run() -> bool {
        std::env::var_os("K_SERVICE").is_some() || std::env::var_os("CLOUD_RUN_JOB").is_some()
    }

    /// Reads metrics for the Cloud Run `service` and `job`.
    ///
    /// # Errors
    /// [`CloudError::Client`] when the HTTP client cannot be built.
    pub fn new(service: &str, job: &str) -> Result<Self, CloudError> {
        let client = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| CloudError::Client)?;
        Ok(Self {
            client,
            service: service.to_owned(),
            job: job.to_owned(),
            token: Mutex::new(None),
            project: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
        })
    }

    /// The metrics for `window` ending at `now`, from the cache when it is under five minutes old.
    ///
    /// # Errors
    /// [`CloudError`] when the metadata server or Cloud Monitoring fails.
    pub async fn snapshot(
        &self,
        window: Window,
        now: OffsetDateTime,
    ) -> Result<Arc<CloudSnapshot>, CloudError> {
        if let Some((at, snapshot)) = lock(&self.cache).get(window.key)
            && at.elapsed() < CACHE_FOR
        {
            return Ok(Arc::clone(snapshot));
        }
        let token = self.token().await?;
        let project = self.project().await?;
        let snapshot = Arc::new(self.read(&token, &project, window, now).await?);
        lock(&self.cache).insert(window.key, (Instant::now(), Arc::clone(&snapshot)));
        Ok(snapshot)
    }

    async fn read(
        &self,
        token: &str,
        project: &str,
        window: Window,
        now: OffsetDateTime,
    ) -> Result<CloudSnapshot, CloudError> {
        let step = window.step_seconds.max(60);
        let end_unix = now.unix_timestamp() - now.unix_timestamp().rem_euclid(to_i64(step));
        let end = OffsetDateTime::from_unix_timestamp(end_unix).unwrap_or(now);
        let start = end - Duration::from_secs(window.seconds);
        let queries = queries(&self.service, &self.job);
        let mut tasks = Vec::with_capacity(queries.len());
        for query in queries {
            let request = Request {
                client: self.client.clone(),
                url: format!("{MONITORING}/projects/{project}/timeSeries"),
                token: token.to_owned(),
                start,
                end,
                step,
                query,
            };
            tasks.push(tokio::spawn(request.send()));
        }
        let mut answers = Vec::with_capacity(tasks.len());
        for task in tasks {
            let answer = task
                .await
                .map_err(|_| CloudError::Monitoring("a read was cancelled".into()))??;
            answers.push(answer);
        }
        Ok(assemble(step, answers))
    }

    async fn token(&self) -> Result<String, CloudError> {
        if let Some((token, until)) = lock(&self.token).as_ref()
            && Instant::now() < *until
        {
            return Ok(token.clone());
        }
        let response = self
            .client
            .get(format!(
                "{METADATA}/instance/service-accounts/default/token"
            ))
            .header("Metadata-Flavor", "Google")
            .send()
            .await
            .map_err(|_| CloudError::Metadata("unreachable".into()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(CloudError::Metadata(status.as_u16().to_string()));
        }
        let token: MetadataToken = response
            .json()
            .await
            .map_err(|_| CloudError::Metadata("unreadable token".into()))?;
        let until = Instant::now() + Duration::from_secs(token.expires_in.saturating_sub(60));
        *lock(&self.token) = Some((token.access_token.clone(), until));
        Ok(token.access_token)
    }

    async fn project(&self) -> Result<String, CloudError> {
        if let Some(project) = lock(&self.project).as_ref() {
            return Ok(project.clone());
        }
        let response = self
            .client
            .get(format!("{METADATA}/project/project-id"))
            .header("Metadata-Flavor", "Google")
            .send()
            .await
            .map_err(|_| CloudError::Metadata("unreachable".into()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(CloudError::Metadata(status.as_u16().to_string()));
        }
        let project = response
            .text()
            .await
            .map_err(|_| CloudError::Metadata("unreadable project id".into()))?;
        let project = project.trim().to_owned();
        if project.is_empty()
            || !project
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b':')
        {
            return Err(CloudError::Metadata("unexpected project id".into()));
        }
        *lock(&self.project) = Some(project.clone());
        Ok(project)
    }
}

/// The metadata server's access token.
#[derive(Deserialize)]
struct MetadataToken {
    access_token: String,
    expires_in: u64,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

/// Which field of the snapshot a query fills.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Target {
    Requests,
    LatencyP50,
    LatencyP95,
    LatencyP99,
    Instances,
    ColdStarts,
    Cpu,
    Memory,
    Executions,
    Billable,
    CpuSeconds,
    MemorySeconds,
}

/// One Cloud Monitoring query: a filter and how to aggregate it.
#[derive(Debug, Clone)]
struct Query {
    target: Target,
    filter: String,
    aligner: &'static str,
    reducer: &'static str,
    group_by: Option<&'static str>,
}

/// What each query reads: the target, whether it is the job's, the metric, the aligner, the
/// reducer and the label to group by.
type QuerySpec = (
    Target,
    bool,
    &'static str,
    &'static str,
    &'static str,
    Option<&'static str>,
);
const QUERIES: [QuerySpec; 12] = [
    (
        Target::Requests,
        false,
        "request_count",
        "ALIGN_DELTA",
        "REDUCE_SUM",
        Some("metric.label.response_code_class"),
    ),
    (
        Target::LatencyP50,
        false,
        "request_latencies",
        "ALIGN_DELTA",
        "REDUCE_PERCENTILE_50",
        None,
    ),
    (
        Target::LatencyP95,
        false,
        "request_latencies",
        "ALIGN_DELTA",
        "REDUCE_PERCENTILE_95",
        None,
    ),
    (
        Target::LatencyP99,
        false,
        "request_latencies",
        "ALIGN_DELTA",
        "REDUCE_PERCENTILE_99",
        None,
    ),
    (
        Target::Instances,
        false,
        "container/instance_count",
        "ALIGN_MAX",
        "REDUCE_SUM",
        None,
    ),
    (
        Target::ColdStarts,
        false,
        "container/startup_latencies",
        "ALIGN_DELTA",
        "REDUCE_SUM",
        None,
    ),
    (
        Target::Cpu,
        false,
        "container/cpu/utilizations",
        "ALIGN_DELTA",
        "REDUCE_PERCENTILE_95",
        None,
    ),
    (
        Target::Memory,
        false,
        "container/memory/utilizations",
        "ALIGN_DELTA",
        "REDUCE_PERCENTILE_95",
        None,
    ),
    (
        Target::Executions,
        true,
        "job/completed_execution_count",
        "ALIGN_DELTA",
        "REDUCE_SUM",
        Some("metric.label.result"),
    ),
    (
        Target::Billable,
        true,
        "container/billable_instance_time",
        "ALIGN_DELTA",
        "REDUCE_SUM",
        None,
    ),
    (
        Target::CpuSeconds,
        true,
        "container/cpu/allocation_time",
        "ALIGN_DELTA",
        "REDUCE_SUM",
        None,
    ),
    (
        Target::MemorySeconds,
        true,
        "container/memory/allocation_time",
        "ALIGN_DELTA",
        "REDUCE_SUM",
        None,
    ),
];

/// The queries for the service and the job. Request and latency metrics exist only for services;
/// the job is described by executions and allocated resources.
fn queries(service: &str, job: &str) -> Vec<Query> {
    QUERIES
        .iter()
        .map(|&(target, of_job, metric, aligner, reducer, group_by)| {
            let (resource, label, name) = if of_job {
                ("cloud_run_job", "job_name", job)
            } else {
                ("cloud_run_revision", "service_name", service)
            };
            Query {
                target,
                filter: format!(
                    "metric.type=\"run.googleapis.com/{metric}\" AND resource.type=\"{resource}\" \
                     AND resource.labels.{label}=\"{name}\""
                ),
                aligner,
                reducer,
                group_by,
            }
        })
        .collect()
}

/// One query, ready to send from its own task.
struct Request {
    client: reqwest::Client,
    url: String,
    token: String,
    start: OffsetDateTime,
    end: OffsetDateTime,
    step: u64,
    query: Query,
}

impl Request {
    async fn send(self) -> Result<(Target, Vec<LabelledSeries>), CloudError> {
        let format = |time: OffsetDateTime| time.format(&Rfc3339).unwrap_or_default();
        let period = format!("{}s", self.step);
        let mut params: Vec<(&str, String)> = vec![
            ("filter", self.query.filter.clone()),
            ("interval.startTime", format(self.start)),
            ("interval.endTime", format(self.end)),
            ("aggregation.alignmentPeriod", period),
            (
                "aggregation.perSeriesAligner",
                self.query.aligner.to_owned(),
            ),
            (
                "aggregation.crossSeriesReducer",
                self.query.reducer.to_owned(),
            ),
            ("view", "FULL".to_owned()),
        ];
        if let Some(group_by) = self.query.group_by {
            params.push(("aggregation.groupByFields", group_by.to_owned()));
        }
        let mut series = Vec::new();
        let mut page_token = String::new();
        for _ in 0..MAX_PAGES {
            let mut request = self
                .client
                .get(&self.url)
                .bearer_auth(&self.token)
                .query(&params);
            if !page_token.is_empty() {
                request = request.query(&[("pageToken", &page_token)]);
            }
            let response = request
                .send()
                .await
                .map_err(|_| CloudError::Monitoring("unreachable".into()))?;
            let status = response.status();
            if !status.is_success() {
                return Err(CloudError::Monitoring(status.as_u16().to_string()));
            }
            let page: ListResponse = response
                .json()
                .await
                .map_err(|_| CloudError::Monitoring("unreadable answer".into()))?;
            series.extend(parse(&page, self.query.group_by, self.step));
            page_token = page.next_page_token;
            if page_token.is_empty() {
                break;
            }
        }
        Ok((self.query.target, series))
    }
}

/// `projects.timeSeries.list`'s answer, as much of it as is read.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
    #[serde(default)]
    time_series: Vec<TimeSeries>,
    #[serde(default)]
    next_page_token: String,
}

#[derive(Debug, Deserialize)]
struct TimeSeries {
    #[serde(default)]
    metric: Metric,
    #[serde(default)]
    points: Vec<RawPoint>,
}

#[derive(Debug, Default, Deserialize)]
struct Metric {
    #[serde(default)]
    labels: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct RawPoint {
    interval: Interval,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Interval {
    end_time: String,
}

/// A typed value. Integers come as strings in JSON; a distribution is read as its count.
#[derive(Debug, Deserialize)]
struct Value {
    #[serde(rename = "doubleValue")]
    double: Option<f64>,
    #[serde(rename = "int64Value")]
    int64: Option<String>,
    #[serde(rename = "distributionValue")]
    distribution: Option<Distribution>,
}

#[derive(Debug, Deserialize)]
struct Distribution {
    #[serde(default)]
    count: Option<String>,
}

impl Value {
    fn number(&self) -> Option<f64> {
        let value = if let Some(value) = self.double {
            value
        } else if let Some(value) = &self.int64 {
            value.parse().ok()?
        } else {
            let count = self.distribution.as_ref()?.count.as_deref().unwrap_or("0");
            count.parse().ok()?
        };
        value.is_finite().then_some(value)
    }
}

/// The series in one page, labelled by the grouping label (or `all`), points oldest first and
/// placed at the start of their interval.
fn parse(page: &ListResponse, group_by: Option<&str>, step: u64) -> Vec<LabelledSeries> {
    let label_key = group_by.and_then(|field| field.strip_prefix("metric.label."));
    page.time_series
        .iter()
        .map(|series| {
            let label = label_key
                .and_then(|key| series.metric.labels.get(key).cloned())
                .unwrap_or_else(|| "all".to_owned());
            let mut points: Vec<Point> = series
                .points
                .iter()
                .filter_map(|point| {
                    let end = OffsetDateTime::parse(&point.interval.end_time, &Rfc3339).ok()?;
                    Some(Point {
                        at: end - Duration::from_secs(step),
                        value: point.value.number()?,
                    })
                })
                .collect();
            points.sort_by_key(|point| point.at);
            LabelledSeries { label, points }
        })
        .collect()
}

/// Puts each query's series in its place. An ungrouped query has one series (or none when
/// nothing ran in the window).
fn assemble(step: u64, answers: Vec<(Target, Vec<LabelledSeries>)>) -> CloudSnapshot {
    let mut service = ServiceSeries::default();
    let mut job = JobSeries::default();
    for (target, mut series) in answers {
        series.sort_by(|a, b| a.label.cmp(&b.label));
        let single = || {
            series
                .first()
                .map(|series| series.points.clone())
                .unwrap_or_default()
        };
        match target {
            Target::Requests => service.requests = series,
            Target::Executions => job.executions = series,
            Target::LatencyP50 => service.latency_p50_ms = single(),
            Target::LatencyP95 => service.latency_p95_ms = single(),
            Target::LatencyP99 => service.latency_p99_ms = single(),
            Target::Instances => service.instances = single(),
            Target::ColdStarts => service.cold_starts = single(),
            Target::Cpu => service.cpu_p95 = single(),
            Target::Memory => service.memory_p95 = single(),
            Target::Billable => job.billable_seconds = single(),
            Target::CpuSeconds => job.cpu_seconds = single(),
            Target::MemorySeconds => job.memory_gib_seconds = single(),
        }
    }
    CloudSnapshot {
        interval_seconds: step,
        service,
        job,
    }
}

#[cfg(test)]
mod tests {
    use time::macros::datetime;

    use super::*;

    const REQUESTS: &str = r#"{
      "timeSeries": [
        {
          "metric": { "labels": { "response_code_class": "5xx" }, "type": "run.googleapis.com/request_count" },
          "resource": { "type": "cloud_run_revision", "labels": { "service_name": "aarogyam-api" } },
          "metricKind": "DELTA",
          "valueType": "INT64",
          "points": [
            { "interval": { "startTime": "2026-11-19T09:01:00Z", "endTime": "2026-11-19T09:02:00Z" }, "value": { "int64Value": "2" } }
          ]
        },
        {
          "metric": { "labels": { "response_code_class": "2xx" } },
          "points": [
            { "interval": { "startTime": "2026-11-19T09:01:00Z", "endTime": "2026-11-19T09:02:00Z" }, "value": { "int64Value": "41" } },
            { "interval": { "startTime": "2026-11-19T09:00:00Z", "endTime": "2026-11-19T09:01:00Z" }, "value": { "int64Value": "30" } }
          ]
        }
      ],
      "unit": "1"
    }"#;

    const LATENCY: &str = r#"{
      "timeSeries": [
        {
          "metric": { "type": "run.googleapis.com/request_latencies" },
          "metricKind": "GAUGE",
          "valueType": "DOUBLE",
          "points": [
            { "interval": { "startTime": "2026-11-19T09:02:00Z", "endTime": "2026-11-19T09:02:00Z" }, "value": { "doubleValue": 212.5 } },
            { "interval": { "startTime": "2026-11-19T09:01:00Z", "endTime": "2026-11-19T09:01:00Z" }, "value": { "doubleValue": 180 } }
          ]
        }
      ]
    }"#;

    const COLD_STARTS: &str = r#"{
      "timeSeries": [
        {
          "points": [
            { "interval": { "startTime": "2026-11-19T09:01:00Z", "endTime": "2026-11-19T09:02:00Z" },
              "value": { "distributionValue": { "count": "3", "mean": 1450.2, "bucketCounts": ["0", "3"] } } },
            { "interval": { "startTime": "2026-11-19T09:00:00Z", "endTime": "2026-11-19T09:01:00Z" },
              "value": { "distributionValue": { "mean": 0 } } }
          ]
        }
      ],
      "nextPageToken": ""
    }"#;

    fn page(json: &str) -> ListResponse {
        serde_json::from_str(json).expect("fixture parses")
    }

    #[test]
    fn grouped_series_are_labelled_and_ordered_oldest_first() {
        let series = parse(
            &page(REQUESTS),
            Some("metric.label.response_code_class"),
            60,
        );
        let snapshot = assemble(60, vec![(Target::Requests, series)]);
        let requests = &snapshot.service.requests;
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].label, "2xx");
        assert_eq!(
            requests[0].points,
            [
                Point {
                    at: datetime!(2026-11-19 09:00 UTC),
                    value: 30.0
                },
                Point {
                    at: datetime!(2026-11-19 09:01 UTC),
                    value: 41.0
                },
            ]
        );
        assert_eq!(requests[1].label, "5xx");
        assert_eq!(requests[1].points[0].value, 2.0);
    }

    #[test]
    fn doubles_and_distribution_counts_are_read() {
        let latency = parse(&page(LATENCY), None, 60);
        let cold = parse(&page(COLD_STARTS), None, 60);
        let snapshot = assemble(
            60,
            vec![(Target::LatencyP95, latency), (Target::ColdStarts, cold)],
        );
        let values = |points: &[Point]| points.iter().map(|p| p.value).collect::<Vec<_>>();
        assert_eq!(values(&snapshot.service.latency_p95_ms), [180.0, 212.5]);
        // A distribution without a count had no starts.
        assert_eq!(values(&snapshot.service.cold_starts), [0.0, 3.0]);
        assert_eq!(snapshot.interval_seconds, 60);
    }

    #[test]
    fn an_empty_answer_is_empty_series() {
        let empty = parse(&page("{}"), None, 300);
        let snapshot = assemble(300, vec![(Target::Instances, empty)]);
        assert_eq!(snapshot.service.instances, []);
        assert_eq!(snapshot.job.executions, []);
    }

    #[test]
    fn queries_name_the_service_and_the_job() {
        let queries = queries("aarogyam-api", "aarogyam-outbox");
        assert_eq!(queries.len(), 12);
        let requests = &queries[0];
        assert!(requests.filter.contains("service_name=\"aarogyam-api\""));
        assert!(requests.filter.contains("run.googleapis.com/request_count"));
        assert!(
            queries
                .iter()
                .filter(|query| query.filter.contains("cloud_run_job"))
                .all(|query| query.filter.contains("job_name=\"aarogyam-outbox\""))
        );
    }
}
