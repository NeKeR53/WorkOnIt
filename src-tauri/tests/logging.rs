use chrono::Utc;
use tempfile::tempdir;
use workonit_lib::{
    automation::{StepExecution, StepStatus},
    exchange::ExportLog,
    logging::LogStore,
};

fn step(id: &str, stdout: &str) -> StepExecution {
    StepExecution {
        action_id: id.into(),
        action_name: id.into(),
        status: StepStatus::Succeeded,
        exit_code: Some(0),
        stdout: stdout.into(),
        stderr: String::new(),
        started_at: Utc::now(),
        finished_at: Utc::now(),
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_bytes: Vec::new(),
        stderr_bytes: Vec::new(),
    }
}

#[test]
fn logs_export_and_import_round_trip() {
    let source = tempdir().unwrap();
    let source_logs = LogStore::open(source.path()).unwrap();
    source_logs
        .write("run", &[step("action", "hello")], Vec::<String>::new())
        .unwrap();
    let exported = source_logs.export().unwrap();
    assert_eq!(exported[0].stdout, "hello");

    let target = tempdir().unwrap();
    let target_logs = LogStore::open(target.path()).unwrap();
    target_logs
        .import(&ExportLog {
            execution_id: "run".into(),
            stdout: exported[0].stdout.clone(),
            stderr: "warning".into(),
        })
        .unwrap();
    let imported = target_logs.read("run").unwrap();
    assert_eq!(imported.steps[0].stdout, "hello");
    assert_eq!(imported.steps[0].stderr, "warning");
}

#[test]
fn log_rotation_uses_age_ignores_other_files_and_stops_under_size_limit() {
    let directory = tempdir().unwrap();
    let logs = LogStore::open(directory.path()).unwrap();
    logs.write("old", &[step("1", "data")], Vec::<String>::new())
        .unwrap();
    std::fs::write(directory.path().join("keep.txt"), "not a log").unwrap();
    assert!(logs.prune(30, u64::MAX).unwrap().is_empty());
    std::thread::sleep(std::time::Duration::from_millis(2));
    let removed = logs.prune(0, u64::MAX).unwrap();
    assert_eq!(removed.len(), 1);
    assert!(directory.path().join("keep.txt").exists());
}

#[test]
fn invalid_log_json_returns_a_read_and_export_error() {
    let directory = tempdir().unwrap();
    let logs = LogStore::open(directory.path()).unwrap();
    std::fs::write(directory.path().join("broken.json"), "{").unwrap();
    assert!(logs.read("broken").is_err());
    assert!(logs.export().is_err());
}

#[test]
fn logs_redact_secrets_and_rotate_at_the_size_limit() {
    let directory = tempdir().unwrap();
    let logs = LogStore::open(directory.path()).unwrap();
    logs.write("first", &[step("1", "token=secret")], ["secret".into()])
        .unwrap();
    logs.write("second", &[step("2", "ordinary")], Vec::<String>::new())
        .unwrap();

    assert_eq!(
        logs.read("first").unwrap().steps[0].stdout,
        "token=••••••••"
    );
    let removed = logs.prune(30, 1).unwrap();
    assert_eq!(removed.len(), 2);
    assert!(logs.directory().exists());
}
