//! `aarogyam erase`: the erasure job (docs/decisions.md, "Erasure job"). A dry run unless
//! `--apply --clinic <slug> --log-file <path>`; `--replay <path>` erases again the patients a log
//! names, after a restore from backup. Logs ids and counts, never names.

use std::io::{BufRead as _, Write as _};
use std::path::{Path, PathBuf};

use aarogyam_app::erasure::{self, Erased};
use anyhow::Context;
use sakalya_db::Db;

/// What to do.
#[derive(Debug, Clone)]
pub(crate) struct EraseArgs {
    pub(crate) clinic: Option<String>,
    pub(crate) apply: bool,
    pub(crate) log_file: Option<PathBuf>,
    pub(crate) replay: Option<PathBuf>,
}

pub(crate) async fn run(db: &Db, args: EraseArgs) -> anyhow::Result<()> {
    if let Some(path) = &args.replay {
        anyhow::ensure!(!args.apply, "--replay and --apply are separate runs");
        return replay(db, path).await;
    }
    let now = time::OffsetDateTime::now_utc();
    let clinic = match &args.clinic {
        Some(slug) => Some(
            erasure::clinic(db, slug)
                .await?
                .with_context(|| format!("no clinic with the slug {slug}"))?,
        ),
        None => None,
    };
    if !args.apply {
        for group in erasure::plan(db, now, clinic).await? {
            tracing::info!(
                event = "erasure.planned",
                clinic = %group.slug,
                years = group.years,
                patients = group.patients.len(),
                held = group.held,
                "dry run: these would be erased; nothing was changed"
            );
        }
        return Ok(());
    }
    let clinic =
        clinic.context("--apply needs --clinic <slug>: erasure runs one clinic at a time")?;
    let path = args.log_file.context(
        "--apply needs --log-file <path>: keep it outside the database to replay after a restore",
    )?;
    let mut log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("could not open {}", path.display()))?;
    let run_id = uuid::Uuid::now_v7();
    let erased = erasure::apply(db, now, clinic, run_id, |entry| {
        let line = serde_json::to_string(&entry).map_err(std::io::Error::other)?;
        writeln!(log, "{line}")?;
        log.sync_data()
    })
    .await?;
    tracing::info!(
        event = "retention.applied",
        clinic = args.clinic.as_deref().unwrap_or_default(),
        run_id = %run_id,
        patients = erased,
        "patients past retention erased"
    );
    Ok(())
}

async fn replay(db: &Db, path: &Path) -> anyhow::Result<()> {
    let file =
        std::fs::File::open(path).with_context(|| format!("could not open {}", path.display()))?;
    let mut entries = Vec::new();
    for (number, line) in std::io::BufReader::new(file).lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let entry: Erased = serde_json::from_str(&line)
            .with_context(|| format!("line {} is not an erasure log entry", number + 1))?;
        entries.push(entry);
    }
    let changed = erasure::replay(db, &entries).await?;
    tracing::info!(
        event = "erasure.replayed",
        entries = entries.len(),
        changed,
        "erasure log replayed"
    );
    Ok(())
}
