use crate::{
    automation::{StepExecution, StepStatus},
    exchange::ExportLog,
    secrets::redact,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionLog {
    pub execution_id: String,
    pub created_at: DateTime<Utc>,
    pub steps: Vec<StepExecution>,
}

pub struct LogStore {
    directory: PathBuf,
}

impl LogStore {
    pub fn open(directory: impl Into<PathBuf>) -> io::Result<Self> {
        let directory = directory.into();
        fs::create_dir_all(&directory)?;
        Ok(Self { directory })
    }

    pub fn write(
        &self,
        execution_id: &str,
        steps: &[StepExecution],
        known_secrets: impl IntoIterator<Item = String> + Clone,
    ) -> io::Result<PathBuf> {
        let mut steps = steps.to_vec();
        let secret_values: Vec<String> = known_secrets.into_iter().collect();
        for step in &mut steps {
            step.stdout = redact(&step.stdout, secret_values.clone());
            step.stderr = redact(&step.stderr, secret_values.clone());
        }
        let log = ExecutionLog {
            execution_id: execution_id.into(),
            created_at: Utc::now(),
            steps,
        };
        let path = self.directory.join(format!("{execution_id}.json"));
        fs::write(
            &path,
            serde_json::to_vec_pretty(&log).map_err(io::Error::other)?,
        )?;
        Ok(path)
    }

    pub fn read(&self, execution_id: &str) -> io::Result<ExecutionLog> {
        let bytes = fs::read(self.directory.join(format!("{execution_id}.json")))?;
        serde_json::from_slice(&bytes).map_err(io::Error::other)
    }

    pub fn export(&self) -> io::Result<Vec<ExportLog>> {
        let mut logs = Vec::new();
        for file in log_files(&self.directory)? {
            let log: ExecutionLog =
                serde_json::from_slice(&fs::read(file.path)?).map_err(io::Error::other)?;
            logs.push(ExportLog {
                execution_id: log.execution_id,
                stdout: log
                    .steps
                    .iter()
                    .map(|step| step.stdout.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
                stderr: log
                    .steps
                    .iter()
                    .map(|step| step.stderr.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
            });
        }
        Ok(logs)
    }

    pub fn import(&self, log: &ExportLog) -> io::Result<PathBuf> {
        let now = Utc::now();
        self.write(
            &log.execution_id,
            &[StepExecution {
                action_id: "import".into(),
                action_name: "Log importé".into(),
                status: StepStatus::Succeeded,
                exit_code: None,
                stdout: log.stdout.clone(),
                stderr: log.stderr.clone(),
                started_at: now,
                finished_at: now,
                stdout_truncated: false,
                stderr_truncated: false,
                stdout_bytes: Vec::new(),
                stderr_bytes: Vec::new(),
            }],
            Vec::<String>::new(),
        )
    }

    pub fn prune(&self, retention_days: i64, max_bytes: u64) -> io::Result<Vec<PathBuf>> {
        let mut files = log_files(&self.directory)?;
        let cutoff = Utc::now() - Duration::days(retention_days.max(0));
        let mut removed = Vec::new();
        for file in &files {
            let modified: DateTime<Utc> = file.modified.into();
            if modified < cutoff {
                fs::remove_file(&file.path)?;
                removed.push(file.path.clone());
            }
        }
        files.retain(|file| !removed.contains(&file.path));
        let mut total: u64 = files.iter().map(|file| file.bytes).sum();
        for file in files {
            if total <= max_bytes {
                break;
            }
            fs::remove_file(&file.path)?;
            total = total.saturating_sub(file.bytes);
            removed.push(file.path);
        }
        Ok(removed)
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }
}

struct LogFile {
    path: PathBuf,
    bytes: u64,
    modified: SystemTime,
}

fn log_files(directory: &Path) -> io::Result<Vec<LogFile>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = entry.metadata()?;
        files.push(LogFile {
            path: entry.path(),
            bytes: metadata.len(),
            modified: metadata.modified()?,
        });
    }
    files.sort_by_key(|file| file.modified);
    Ok(files)
}
