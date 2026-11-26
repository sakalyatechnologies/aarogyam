//! Page counters, page speed and error classes the portal and the console send to
//! `POST /api/v1/telemetry` (docs/plans/console-insights-design.md, 2b).
//!
//! A batch holds counts only: per route template, page views and visible time; page speed
//! (LCP, INP, CLS, TTFB) as single readings; and front-end error classes. [`Batch::build`]
//! checks it before anything is stored:
//!
//! - **Routes** must be one of the app's templates ([`PORTAL_ROUTES`], [`CONSOLE_ROUTES`], the
//!   router's patterns such as `/patients/:id`); anything else, a real path included, is counted
//!   as [`OTHER_ROUTE`]. So no ID, name or query can be stored.
//! - **Vitals** must be one of [`Vital`]; unknown names and impossible readings are dropped.
//!   Readings are stored as histograms of [`BUCKETS`] buckets with fixed bounds per vital, so the
//!   console estimates percentiles without keeping a single reading.
//! - **Error classes** are [`ErrorClass`]; anything else counts as `other`.
//! - At most [`MAX_ENTRIES`] entries a batch; counts are capped so one tab cannot swamp a day.

use std::collections::BTreeMap;

/// Most entries (pages, vitals and errors together) in one batch.
pub const MAX_ENTRIES: usize = 50;
/// Most views one page entry may add.
pub const MAX_VIEWS: u32 = 1_000;
/// Most visible time one page entry may add: a day.
pub const MAX_VISIBLE_MS: u64 = 86_400_000;
/// Most errors one error entry may add.
pub const MAX_ERRORS: u32 = 100;
/// Buckets in a vital's histogram: one per bound, then an open one.
pub const BUCKETS: usize = 12;
/// The route counted for any page not in the app's list.
pub const OTHER_ROUTE: &str = "other";
/// Fewest readings a percentile or an average is shown for; below it the cell is empty.
pub const MIN_SAMPLES: u64 = 5;

text_value!(
    /// Which web app sent the batch; the API decides it from the host, never from the body.
    UiApp ("app") {
        /// The clinic portal, on a clinic's host.
        Portal => "portal",
        /// Sakalya's console, on the console host.
        Console => "console",
    }
);

impl UiApp {
    /// The app's route templates.
    #[must_use]
    pub const fn routes(self) -> &'static [&'static str] {
        match self {
            Self::Portal => PORTAL_ROUTES,
            Self::Console => CONSOLE_ROUTES,
        }
    }

    /// `template` if it is one of the app's routes, otherwise [`OTHER_ROUTE`].
    #[must_use]
    pub fn route(self, template: &str) -> &'static str {
        self.routes()
            .iter()
            .find(|known| **known == template)
            .copied()
            .unwrap_or(OTHER_ROUTE)
    }
}

/// The portal's route templates, as its router names them (`web/apps/portal/src/routes.tsx`;
/// `telemetry-routes.json` next to it is checked against both).
pub const PORTAL_ROUTES: &[&str] = &[
    "/",
    "/sign-in",
    "/auth/callback",
    "/auth/handoff",
    "/register",
    "/invite",
    "/book",
    "/learn",
    "/learn/:topic",
    "/shared/:token",
    "/unsubscribe",
    "/verify/prescriptions/:token",
    "/today",
    "/setup",
    "/patients",
    "/patients/new",
    "/patients/import",
    "/patients/incomplete",
    "/patients/duplicates",
    "/patients/:id",
    "/patients/:id/edit",
    "/patients/:id/history",
    "/patients/:id/visits/:visitId",
    "/visits/:visitId/mouth",
    "/patients/:patientId/prescriptions",
    "/calendar",
    "/guides",
    "/guides/:id",
    "/queue",
    "/prescriptions",
    "/prescriptions/:id",
    "/prescriptions/:id/print",
    "/billing",
    "/billing/invoices/:id",
    "/billing/invoices/:id/print",
    "/billing/payments/:id/receipt",
    "/billing/pending",
    "/billing/invoices/new",
    "/labs",
    "/stock",
    "/analytics",
    "/arrive",
    "/messages",
    "/staff",
    "/settings",
    "/*",
];

/// The console's route templates (`web/apps/console/src/routes.tsx`).
pub const CONSOLE_ROUTES: &[&str] = &[
    "/",
    "/sign-in",
    "/auth/callback",
    "/auth/handoff",
    "/health",
    "/quality",
    "/applications",
    "/clinics",
    "/clinics/new",
    "/clinics/:id",
    "/support",
    "/*",
];

/// Bucket bounds for the vitals timed in milliseconds. They include every threshold below.
const MS_BOUNDS: [f64; BUCKETS - 1] = [
    50.0, 100.0, 200.0, 300.0, 500.0, 800.0, 1200.0, 1800.0, 2500.0, 4000.0, 6000.0,
];
/// Bucket bounds for layout shift, which has no unit.
const CLS_BOUNDS: [f64; BUCKETS - 1] = [
    0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 1.0,
];

text_value!(
    /// A page-speed measure, as the browser reports it.
    Vital ("vital") {
        /// Largest contentful paint: when the main content showed, in ms.
        Lcp => "lcp",
        /// Interaction to next paint: the slowest response to a tap or key, in ms.
        Inp => "inp",
        /// Cumulative layout shift: how much the page jumped, unitless.
        Cls => "cls",
        /// Time to first byte of the page, in ms.
        Ttfb => "ttfb",
    }
);

impl Vital {
    /// The upper bounds of the first eleven buckets; the twelfth is open.
    #[must_use]
    pub const fn bounds(self) -> &'static [f64; BUCKETS - 1] {
        match self {
            Self::Cls => &CLS_BOUNDS,
            Self::Lcp | Self::Inp | Self::Ttfb => &MS_BOUNDS,
        }
    }

    /// Readings up to the first value are good, above the second poor (web.dev's thresholds).
    #[must_use]
    pub const fn thresholds(self) -> (f64, f64) {
        match self {
            Self::Lcp => (2500.0, 4000.0),
            Self::Inp => (200.0, 500.0),
            Self::Cls => (0.1, 0.25),
            Self::Ttfb => (800.0, 1800.0),
        }
    }

    /// Largest believable reading; anything above is a broken clock, not a slow page.
    const fn max(self) -> f64 {
        match self {
            Self::Cls => 10.0,
            Self::Lcp | Self::Inp | Self::Ttfb => 120_000.0,
        }
    }

    /// The bucket `value` falls in, or `None` when it is not a believable reading.
    #[must_use]
    pub fn bucket(self, value: f64) -> Option<usize> {
        if !value.is_finite() || value < 0.0 || value > self.max() {
            return None;
        }
        Some(
            self.bounds()
                .iter()
                .position(|bound| value <= *bound)
                .unwrap_or(BUCKETS - 1),
        )
    }

    /// The `q` percentile of a histogram, interpolated inside its bucket; the open bucket reports
    /// the last bound. `None` with fewer than [`MIN_SAMPLES`] readings.
    #[must_use]
    pub fn percentile(self, buckets: &[u64; BUCKETS], q: f64) -> Option<f64> {
        let total: u64 = buckets.iter().sum();
        if total < MIN_SAMPLES {
            return None;
        }
        let rank = q * as_f64(total);
        let (mut below, mut lower) = (0_u64, 0.0);
        for (count, upper) in buckets.iter().zip(self.bounds()) {
            if *count > 0 && as_f64(below + count) >= rank {
                return Some(lower + (upper - lower) * (rank - as_f64(below)) / as_f64(*count));
            }
            below += count;
            lower = *upper;
        }
        Some(lower)
    }

    /// Readings that were good, needed work and were poor. The thresholds are bucket bounds, so
    /// the split is exact.
    #[must_use]
    pub fn ratings(self, buckets: &[u64; BUCKETS]) -> (u64, u64, u64) {
        let (good, poor) = self.thresholds();
        let mut split = (0, 0, 0);
        let uppers = self.bounds().iter().copied().chain([f64::INFINITY]);
        for (count, upper) in buckets.iter().zip(uppers) {
            if upper <= good {
                split.0 += count;
            } else if upper <= poor {
                split.1 += count;
            } else {
                split.2 += count;
            }
        }
        split
    }
}

text_value!(
    /// What kind of front-end error happened; the message itself goes only to the log.
    ErrorClass ("class") {
        /// A `TypeError`, such as reading a property of `undefined`.
        TypeError => "type_error",
        /// A `ReferenceError`.
        ReferenceError => "reference_error",
        /// A `RangeError`.
        RangeError => "range_error",
        /// A `SyntaxError`.
        SyntaxError => "syntax_error",
        /// A page's code failed to load, usually after a new release.
        ChunkLoad => "chunk_load",
        /// A request failed on the network.
        Network => "network",
        /// A rejected promise nobody handled, with no error object.
        UnhandledRejection => "unhandled_rejection",
        /// Anything else.
        Other => "other",
    }
);

/// One page entry as the browser sends it.
#[derive(Debug, Clone, Copy)]
pub struct PageInput<'a> {
    /// The route template.
    pub route: &'a str,
    /// Times the page was opened.
    pub views: u32,
    /// Milliseconds it was visible.
    pub visible_ms: u64,
}

/// One page-speed reading as the browser sends it.
#[derive(Debug, Clone, Copy)]
pub struct VitalInput<'a> {
    /// The route template.
    pub route: &'a str,
    /// `lcp`, `inp`, `cls` or `ttfb`.
    pub name: &'a str,
    /// The reading: milliseconds, or the layout-shift score.
    pub value: f64,
}

/// One error entry as the browser sends it.
#[derive(Debug, Clone, Copy)]
pub struct ErrorInput<'a> {
    /// The route template.
    pub route: &'a str,
    /// The error class.
    pub class: &'a str,
    /// How many.
    pub count: u32,
}

/// Views and visible time for one route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageCount {
    /// An allow-listed template or [`OTHER_ROUTE`].
    pub route: &'static str,
    /// Views.
    pub views: i32,
    /// Visible milliseconds.
    pub visible_ms: i64,
}

/// A histogram of one vital on one route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VitalCount {
    /// An allow-listed template or [`OTHER_ROUTE`].
    pub route: &'static str,
    /// Which measure.
    pub vital: Vital,
    /// Readings per bucket.
    pub buckets: [i32; BUCKETS],
}

/// Errors of one class on one route.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorCount {
    /// An allow-listed template or [`OTHER_ROUTE`].
    pub route: &'static str,
    /// The class.
    pub class: ErrorClass,
    /// How many.
    pub count: i32,
}

/// A checked batch, merged per key and sorted by it, ready to add to the counters.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Batch {
    /// Views and visible time per route.
    pub pages: Vec<PageCount>,
    /// Histograms per route and vital.
    pub vitals: Vec<VitalCount>,
    /// Errors per route and class.
    pub errors: Vec<ErrorCount>,
}

/// The batch had more than [`MAX_ENTRIES`] entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a batch holds at most {MAX_ENTRIES} entries")]
pub struct TooManyEntries;

impl Batch {
    /// Checks and merges what a page sent for `app`; see the module docs for the rules.
    ///
    /// # Errors
    /// [`TooManyEntries`] when the three lists hold more than [`MAX_ENTRIES`] together.
    pub fn build(
        app: UiApp,
        pages: &[PageInput<'_>],
        vitals: &[VitalInput<'_>],
        errors: &[ErrorInput<'_>],
    ) -> Result<Self, TooManyEntries> {
        if pages.len() + vitals.len() + errors.len() > MAX_ENTRIES {
            return Err(TooManyEntries);
        }
        let mut page_map: BTreeMap<&'static str, (i32, i64)> = BTreeMap::new();
        for page in pages {
            let views = page.views.min(MAX_VIEWS);
            let visible = page.visible_ms.min(MAX_VISIBLE_MS);
            if views == 0 && visible == 0 {
                continue;
            }
            let entry = page_map.entry(app.route(page.route)).or_default();
            entry.0 += i32::try_from(views).unwrap_or(i32::MAX);
            entry.1 += i64::try_from(visible).unwrap_or(i64::MAX);
        }
        let mut vital_map: BTreeMap<(&'static str, &'static str), (Vital, [i32; BUCKETS])> =
            BTreeMap::new();
        for reading in vitals {
            let Ok(vital) = Vital::parse(reading.name) else {
                continue;
            };
            let Some(bucket) = vital.bucket(reading.value) else {
                continue;
            };
            let entry = vital_map
                .entry((app.route(reading.route), vital.as_str()))
                .or_insert((vital, [0; BUCKETS]));
            if let Some(count) = entry.1.get_mut(bucket) {
                *count += 1;
            }
        }
        let mut error_map: BTreeMap<(&'static str, &'static str), (ErrorClass, i32)> =
            BTreeMap::new();
        for error in errors {
            let count = error.count.min(MAX_ERRORS);
            if count == 0 {
                continue;
            }
            let class = ErrorClass::parse(error.class).unwrap_or(ErrorClass::Other);
            let entry = error_map
                .entry((app.route(error.route), class.as_str()))
                .or_insert((class, 0));
            entry.1 += i32::try_from(count).unwrap_or(i32::MAX);
        }
        Ok(Self {
            pages: page_map
                .into_iter()
                .map(|(route, (views, visible_ms))| PageCount {
                    route,
                    views,
                    visible_ms,
                })
                .collect(),
            vitals: vital_map
                .into_iter()
                .map(|((route, _), (vital, buckets))| VitalCount {
                    route,
                    vital,
                    buckets,
                })
                .collect(),
            errors: error_map
                .into_iter()
                .map(|((route, _), (class, count))| ErrorCount {
                    route,
                    class,
                    count,
                })
                .collect(),
        })
    }

    /// Whether there is nothing to add.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.pages.is_empty() && self.vitals.is_empty() && self.errors.is_empty()
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "reading counts stay far below 2^53, where f64 is exact"
)]
const fn as_f64(count: u64) -> f64 {
    count as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(route: &str, views: u32, visible_ms: u64) -> PageInput<'_> {
        PageInput {
            route,
            views,
            visible_ms,
        }
    }

    #[test]
    fn unknown_routes_and_real_paths_count_as_other() {
        let batch = Batch::build(
            UiApp::Portal,
            &[
                page("/patients/:id", 2, 900),
                page("/patients/0192f1c4-0000-7000-8000-000000000000", 1, 100),
                page("/patients?name=Asha", 1, 100),
                page("/health", 1, 100),
                page("/patients/:id", 1, 100),
            ],
            &[],
            &[],
        )
        .unwrap();
        assert_eq!(
            batch.pages,
            [
                PageCount {
                    route: "/patients/:id",
                    views: 3,
                    visible_ms: 1000
                },
                PageCount {
                    route: OTHER_ROUTE,
                    views: 3,
                    visible_ms: 300
                },
            ]
        );
        // The console's pages are the console's.
        assert_eq!(UiApp::Console.route("/health"), "/health");
        assert_eq!(UiApp::Console.route("/today"), OTHER_ROUTE);
    }

    #[test]
    fn counts_are_capped_and_empty_entries_dropped() {
        let batch = Batch::build(
            UiApp::Portal,
            &[page("/today", 50_000, u64::MAX), page("/queue", 0, 0)],
            &[],
            &[ErrorInput {
                route: "/today",
                class: "type_error",
                count: 9_999,
            }],
        )
        .unwrap();
        assert_eq!(batch.pages.len(), 1);
        assert_eq!(batch.pages[0].views, 1_000);
        assert_eq!(batch.pages[0].visible_ms, 86_400_000);
        assert_eq!(batch.errors[0].count, 100);
    }

    #[test]
    fn vitals_and_error_classes_come_from_fixed_lists() {
        let reading = |name, value| VitalInput {
            route: "/today",
            name,
            value,
        };
        let batch = Batch::build(
            UiApp::Portal,
            &[],
            &[
                reading("lcp", 1_000.0),
                reading("lcp", 3_000.0),
                reading("cls", 0.3),
                reading("fid", 10.0),
                reading("inp", f64::NAN),
                reading("ttfb", -1.0),
                reading("inp", 1e9),
            ],
            &[
                ErrorInput {
                    route: "/today",
                    class: "TypeError: Asha",
                    count: 1,
                },
                ErrorInput {
                    route: "/today",
                    class: "chunk_load",
                    count: 2,
                },
            ],
        )
        .unwrap();
        assert_eq!(batch.vitals.len(), 2, "{batch:?}");
        let lcp = batch.vitals.iter().find(|v| v.vital == Vital::Lcp).unwrap();
        assert_eq!(lcp.buckets[6], 1, "1000 ms is in the 1200 bucket");
        assert_eq!(lcp.buckets[9], 1, "3000 ms is in the 4000 bucket");
        let cls = batch.vitals.iter().find(|v| v.vital == Vital::Cls).unwrap();
        assert_eq!(cls.buckets[8], 1);
        let classes: Vec<_> = batch.errors.iter().map(|e| (e.class, e.count)).collect();
        assert_eq!(
            classes,
            [(ErrorClass::ChunkLoad, 2), (ErrorClass::Other, 1)]
        );
    }

    #[test]
    fn a_batch_holds_at_most_fifty_entries() {
        let pages = vec![page("/today", 1, 1); 30];
        let errors = vec![
            ErrorInput {
                route: "/today",
                class: "other",
                count: 1
            };
            20
        ];
        assert!(Batch::build(UiApp::Portal, &pages, &[], &errors).is_ok());
        let pages = vec![page("/today", 1, 1); 51];
        assert_eq!(
            Batch::build(UiApp::Portal, &pages, &[], &[]),
            Err(TooManyEntries)
        );
    }

    #[test]
    fn percentiles_need_five_readings_and_ratings_split_on_thresholds() {
        let mut buckets = [0_u64; BUCKETS];
        buckets[2] = 4;
        assert_eq!(Vital::Inp.percentile(&buckets, 0.75), None);
        buckets[2] = 3; // 100-200 ms
        buckets[4] = 1; // 300-500 ms
        buckets[11] = 1; // over 6 s
        let p75 = Vital::Inp.percentile(&buckets, 0.75).unwrap();
        assert!((300.0..=500.0).contains(&p75), "{p75}");
        assert_eq!(Vital::Inp.ratings(&buckets), (3, 1, 1));
        let mut slow = [0_u64; BUCKETS];
        slow[11] = 5;
        assert_eq!(Vital::Lcp.percentile(&slow, 0.75), Some(6000.0));
    }

    /// The web apps keep a copy of their templates next to their routers, and their tests
    /// check the routers against it; this checks the copy against the lists here.
    #[test]
    fn route_lists_match_the_web_apps() {
        for (app, json) in [
            (
                UiApp::Portal,
                include_str!("../../../web/apps/portal/src/telemetry-routes.json"),
            ),
            (
                UiApp::Console,
                include_str!("../../../web/apps/console/src/telemetry-routes.json"),
            ),
        ] {
            let mut web: Vec<String> = serde_json::from_str(json).unwrap();
            let mut ours: Vec<String> = app.routes().iter().map(|r| (*r).to_owned()).collect();
            web.sort();
            ours.sort();
            assert_eq!(web, ours, "{app}");
        }
    }
}
