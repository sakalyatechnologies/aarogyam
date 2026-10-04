//! The console's Quality dashboard: recorded suite runs written by `scripts/quality-run.sh` to
//! disk (`quality.dir`, default `var/quality`), one JSON file per run. This store sits outside
//! the patient database on purpose (a GCS bucket or `BigQuery` dataset once deployed) and never
//! holds patient data: only test names and failure messages.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// One test that failed within a suite.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QualityFailure {
    /// The test's name, as the suite's runner reports it.
    pub test: String,
    /// Why it failed. Never patient data.
    pub message: String,
}

/// One suite's result within a run.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QualitySuite {
    /// The suite's name, such as `aarogyam-dal (db)` or `portal e2e`.
    pub name: String,
    /// `unit`, `db`, `web` or `e2e`.
    pub kind: String,
    /// Tests that passed.
    pub passed: u32,
    /// Tests that failed.
    pub failed: u32,
    /// Tests skipped (no Postgres locally, UI not built yet, and so on).
    pub skipped: u32,
    /// How long the suite took.
    pub duration_ms: u64,
    /// Which tests failed, if any.
    #[serde(default)]
    pub failures: Vec<QualityFailure>,
}

impl QualitySuite {
    /// Passed over (passed + failed), ignoring skips; `1.0` when nothing ran.
    #[must_use]
    pub fn pass_rate(&self) -> f64 {
        let graded = self.passed + self.failed;
        if graded == 0 {
            1.0
        } else {
            f64::from(self.passed) / f64::from(graded)
        }
    }
}

/// One recorded run of `scripts/quality-run.sh`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct QualityRun {
    /// Identifies the run; also its file name's stem (a timestamp).
    pub run_id: String,
    /// RFC 3339.
    pub started_at: String,
    /// RFC 3339.
    pub finished_at: String,
    /// `local`, `staging` or another environment name the run was recorded against.
    pub environment: String,
    /// The git commit the suites ran at.
    pub commit: String,
    /// Each suite's result.
    pub suites: Vec<QualitySuite>,
}

/// A point on a suite's pass-rate trend.
#[derive(Debug, Clone, Serialize)]
pub struct TrendPoint {
    /// The run this point is from.
    pub run_id: String,
    /// RFC 3339.
    pub started_at: String,
    /// Passed over (passed + failed); `1.0` when nothing was graded.
    pub pass_rate: f64,
}

/// A suite's pass-rate history across the returned runs, oldest first.
#[derive(Debug, Clone, Serialize)]
pub struct SuiteTrend {
    /// The suite's name.
    pub name: String,
    /// `unit`, `db`, `web` or `e2e`.
    pub kind: String,
    /// Oldest first.
    pub points: Vec<TrendPoint>,
}

/// A test failing in the newest run that recorded it.
#[derive(Debug, Clone, Serialize)]
pub struct FailingTest {
    /// The suite it failed in.
    pub suite: String,
    /// The test's name.
    pub test: String,
    /// Why it failed. Never patient data.
    pub message: String,
    /// The run it failed in.
    pub run_id: String,
}

/// The dashboard: recent runs (newest first), each suite's pass-rate trend across them, and the
/// newest run's failing tests.
#[derive(Debug, Clone, Serialize)]
pub struct QualityReport {
    /// Newest first.
    pub runs: Vec<QualityRun>,
    /// Each suite seen across `runs`.
    pub trend: Vec<SuiteTrend>,
    /// Tests failing in the newest run.
    pub failing: Vec<FailingTest>,
}

/// Builds the report from parsed runs (any order).
#[must_use]
pub fn report(mut runs: Vec<QualityRun>) -> QualityReport {
    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    let mut trend: Vec<SuiteTrend> = Vec::new();
    for run in runs.iter().rev() {
        for suite in &run.suites {
            let point = TrendPoint {
                run_id: run.run_id.clone(),
                started_at: run.started_at.clone(),
                pass_rate: suite.pass_rate(),
            };
            match trend.iter_mut().find(|t| t.name == suite.name) {
                Some(existing) => existing.points.push(point),
                None => trend.push(SuiteTrend {
                    name: suite.name.clone(),
                    kind: suite.kind.clone(),
                    points: vec![point],
                }),
            }
        }
    }

    let failing = runs.first().map_or_else(Vec::new, |run| {
        run.suites
            .iter()
            .flat_map(|suite| {
                suite.failures.iter().map(move |failure| FailingTest {
                    suite: suite.name.clone(),
                    test: failure.test.clone(),
                    message: failure.message.clone(),
                    run_id: run.run_id.clone(),
                })
            })
            .collect()
    });

    QualityReport {
        runs,
        trend,
        failing,
    }
}

/// Reads every run file in `dir`, keeping the newest `limit` by `started_at`. A missing
/// directory is an empty dashboard (nothing recorded yet), not an error. A file that isn't
/// `.json`, or whose JSON doesn't match [`QualityRun`], is skipped, so one bad write never takes
/// the dashboard down.
///
/// # Errors
/// [`AppError::Internal`] if the directory exists but can't be listed.
pub async fn list_runs(dir: &Path, limit: usize) -> Result<QualityReport, AppError> {
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(report(Vec::new()));
        }
        Err(_) => return Err(AppError::Internal("could not read the quality directory")),
    };

    let mut runs = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|_| AppError::Internal("could not read the quality directory"))?
    {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        // A file that can't be read or doesn't match `QualityRun` is skipped, not fatal: one bad
        // write (a partial file, an old format) must never take the dashboard down.
        let Ok(bytes) = tokio::fs::read(&path).await else {
            continue;
        };
        if let Ok(run) = serde_json::from_slice::<QualityRun>(&bytes) {
            runs.push(run);
        }
    }

    runs.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    runs.truncate(limit);
    Ok(report(runs))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suite(name: &str, passed: u32, failed: u32) -> QualitySuite {
        QualitySuite {
            name: name.to_owned(),
            kind: "unit".to_owned(),
            passed,
            failed,
            skipped: 0,
            duration_ms: 1000,
            failures: if failed == 0 {
                vec![]
            } else {
                vec![QualityFailure {
                    test: format!("{name}::broken"),
                    message: "assertion failed".to_owned(),
                }]
            },
        }
    }

    fn run(id: &str, started_at: &str, suites: Vec<QualitySuite>) -> QualityRun {
        QualityRun {
            run_id: id.to_owned(),
            started_at: started_at.to_owned(),
            finished_at: started_at.to_owned(),
            environment: "local".to_owned(),
            commit: "abc123".to_owned(),
            suites,
        }
    }

    #[test]
    fn pass_rate_ignores_skips_and_defaults_to_whole_when_nothing_graded() {
        assert_eq!(suite("a", 9, 1).pass_rate(), 0.9);
        let untested = QualitySuite {
            skipped: 3,
            ..suite("a", 0, 0)
        };
        assert_eq!(untested.pass_rate(), 1.0);
    }

    #[test]
    fn trend_follows_run_order_oldest_first_per_suite() {
        let runs = vec![
            run("2", "2024-01-02T00:00:00Z", vec![suite("unit", 10, 0)]),
            run("1", "2024-01-01T00:00:00Z", vec![suite("unit", 9, 1)]),
        ];
        let built = report(runs);
        assert_eq!(built.runs[0].run_id, "2", "newest run first");
        let trend = &built.trend[0];
        assert_eq!(trend.name, "unit");
        assert_eq!(
            trend
                .points
                .iter()
                .map(|p| p.run_id.as_str())
                .collect::<Vec<_>>(),
            ["1", "2"],
            "oldest point first"
        );
        assert_eq!(trend.points[0].pass_rate, 0.9);
        assert_eq!(trend.points[1].pass_rate, 1.0);
    }

    #[test]
    fn failing_tests_come_from_the_newest_run_only() {
        let runs = vec![
            run("2", "2024-01-02T00:00:00Z", vec![suite("unit", 9, 1)]),
            run("1", "2024-01-01T00:00:00Z", vec![suite("unit", 8, 2)]),
        ];
        let built = report(runs);
        assert_eq!(built.failing.len(), 1);
        assert_eq!(built.failing[0].run_id, "2");
        assert_eq!(built.failing[0].test, "unit::broken");
    }
}
