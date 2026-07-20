use crate::domain::Task;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OperatingSystem {
    Windows,
    MacOs,
}

impl OperatingSystem {
    #[cfg(target_os = "windows")]
    pub fn current() -> Self {
        Self::Windows
    }

    #[cfg(not(target_os = "windows"))]
    pub fn current() -> Self {
        Self::MacOs
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommandVariant {
    pub operating_system: OperatingSystem,
    pub runner: String,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "expression", rename_all = "camelCase")]
pub enum OutputValidation {
    Regex(String),
    JsonPath(String),
}

pub trait ActionExecutor {
    fn execute(&self, action: &CommandAction, task: &Task) -> StepExecution;
}

pub struct SystemActionExecutor;

impl ActionExecutor for SystemActionExecutor {
    fn execute(&self, action: &CommandAction, task: &Task) -> StepExecution {
        run_action_controlled(action, task, &CancellationToken::default())
    }
}

pub struct ControlledActionExecutor {
    cancellation: CancellationToken,
}

impl ControlledActionExecutor {
    pub fn new(cancellation: CancellationToken) -> Self {
        Self { cancellation }
    }
}

impl ActionExecutor for ControlledActionExecutor {
    fn execute(&self, action: &CommandAction, task: &Task) -> StepExecution {
        run_action_controlled(action, task, &self.cancellation)
    }
}

#[derive(Default)]
pub struct ExecutionCoordinator {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl ExecutionCoordinator {
    pub fn start<'a>(&'a self, task_id: &str) -> Result<ExecutionGuard<'a>, &'static str> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "Verrou d’exécution indisponible")?;
        if active.contains_key(task_id) {
            return Err("Une exécution est déjà active pour cette tâche");
        }
        let cancellation = CancellationToken::default();
        active.insert(task_id.to_owned(), cancellation.clone());
        Ok(ExecutionGuard {
            coordinator: self,
            task_id: task_id.to_owned(),
            cancellation,
        })
    }

    pub fn cancel(&self, task_id: &str) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.get(task_id).cloned())
            .is_some_and(|token| {
                token.cancel();
                true
            })
    }
}

pub struct ExecutionGuard<'a> {
    coordinator: &'a ExecutionCoordinator,
    task_id: String,
    cancellation: CancellationToken,
}

impl ExecutionGuard<'_> {
    pub fn executor(&self) -> ControlledActionExecutor {
        ControlledActionExecutor::new(self.cancellation.clone())
    }
}

impl Drop for ExecutionGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.coordinator.active.lock() {
            active.remove(&self.task_id);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ActionCondition {
    FieldEquals {
        field: String,
        value: String,
    },
    FieldContains {
        field: String,
        value: String,
    },
    Origin {
        origin: crate::domain::TransitionOrigin,
    },
    OperatingSystem {
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionStep {
    pub action_id: String,
    pub stop_on_failure: bool,
    pub condition: Option<ActionCondition>,
}

impl ActionStep {
    pub fn new(action_id: impl Into<String>) -> Self {
        Self {
            action_id: action_id.into(),
            stop_on_failure: true,
            condition: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionAutomation {
    pub id: String,
    pub board_id: String,
    pub name: String,
    pub from_column_id: Option<String>,
    pub to_column_id: String,
    pub origins: Vec<crate::domain::TransitionOrigin>,
    pub steps: Vec<ActionStep>,
    pub require_confirmation: bool,
    pub enabled: bool,
    #[serde(default)]
    pub notifications: NotificationOverrides,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOverrides {
    pub success: Option<bool>,
    pub failure: Option<bool>,
    pub confirmation: Option<bool>,
    pub source_blocked: Option<bool>,
}

impl TransitionAutomation {
    pub fn new(
        board_id: impl Into<String>,
        from_column_id: Option<String>,
        to_column_id: impl Into<String>,
        steps: Vec<ActionStep>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            board_id: board_id.into(),
            name: "Automatisation de transition".into(),
            from_column_id,
            to_column_id: to_column_id.into(),
            origins: vec![
                crate::domain::TransitionOrigin::User,
                crate::domain::TransitionOrigin::Source,
                crate::domain::TransitionOrigin::Plugin,
                crate::domain::TransitionOrigin::System,
            ],
            steps,
            require_confirmation: false,
            enabled: true,
            notifications: NotificationOverrides::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandAction {
    pub id: String,
    pub name: String,
    pub script: String,
    pub runner: String,
    pub working_directory: Option<String>,
    pub load_profile: bool,
    pub timeout_seconds: Option<u64>,
    pub accepted_exit_codes: Vec<i32>,
    pub stop_on_failure: bool,
    pub destructive: bool,
    pub enabled: bool,
    #[serde(default)]
    pub variants: Vec<CommandVariant>,
    #[serde(default)]
    pub stdout_validation: Option<OutputValidation>,
    #[serde(default)]
    pub secret_names: Vec<String>,
    #[serde(default)]
    pub direct_execution: bool,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default = "default_output_limit")]
    pub output_limit_bytes: usize,
}

impl CommandAction {
    pub fn shell(name: impl Into<String>, script: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            script: script.into(),
            runner: default_runner().to_owned(),
            working_directory: None,
            load_profile: false,
            timeout_seconds: Some(300),
            accepted_exit_codes: vec![0],
            stop_on_failure: true,
            destructive: false,
            enabled: true,
            variants: Vec::new(),
            stdout_validation: None,
            secret_names: Vec::new(),
            direct_execution: false,
            arguments: Vec::new(),
            output_limit_bytes: default_output_limit(),
        }
    }

    pub fn command_for(&self, operating_system: OperatingSystem) -> Option<(&str, &str)> {
        if self.variants.is_empty() {
            return Some((&self.runner, &self.script));
        }
        self.variants
            .iter()
            .find(|variant| variant.operating_system == operating_system)
            .map(|variant| (variant.runner.as_str(), variant.script.as_str()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Succeeded,
    Failed,
    TimedOut,
    Skipped,
    Cancelled,
    Incompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepExecution {
    pub action_id: String,
    pub action_name: String,
    pub status: StepStatus,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    #[serde(default)]
    pub stdout_truncated: bool,
    #[serde(default)]
    pub stderr_truncated: bool,
    #[serde(skip, default)]
    pub stdout_bytes: Vec<u8>,
    #[serde(skip, default)]
    pub stderr_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChainStatus {
    Succeeded,
    Failed,
    TimedOut,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainExecution {
    pub id: String,
    pub status: ChainStatus,
    pub failed_step: Option<usize>,
    pub steps: Vec<StepExecution>,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRecord {
    pub id: String,
    pub task_id: String,
    pub automation_ids: Vec<String>,
    pub status: crate::domain::ExecutionStatus,
    pub steps: Vec<StepExecution>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub failed_step: Option<usize>,
}

impl ExecutionRecord {
    pub fn running(
        task_id: impl Into<String>,
        automation_ids: Vec<String>,
        total_steps: u32,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            task_id: task_id.into(),
            automation_ids,
            status: crate::domain::ExecutionStatus::Running {
                step: 1,
                total: total_steps,
            },
            steps: Vec::new(),
            started_at: Utc::now(),
            finished_at: None,
            failed_step: None,
        }
    }
}

pub struct ActionChain {
    actions: Vec<CommandAction>,
}

impl ActionChain {
    pub fn new(actions: Vec<CommandAction>) -> Self {
        Self { actions }
    }

    pub fn run(&self, task: &Task, start_at: usize) -> ChainExecution {
        self.run_with_executor(task, start_at, &SystemActionExecutor)
    }

    pub fn run_with_cancellation(
        &self,
        task: &Task,
        start_at: usize,
        cancellation: &CancellationToken,
    ) -> ChainExecution {
        struct ControlledExecutor<'a>(&'a CancellationToken);
        impl ActionExecutor for ControlledExecutor<'_> {
            fn execute(&self, action: &CommandAction, task: &Task) -> StepExecution {
                run_action_controlled(action, task, self.0)
            }
        }
        self.run_with_executor(task, start_at, &ControlledExecutor(cancellation))
    }

    pub fn run_with_executor(
        &self,
        task: &Task,
        start_at: usize,
        executor: &impl ActionExecutor,
    ) -> ChainExecution {
        let started_at = Utc::now();
        let mut steps = Vec::new();
        let mut status = ChainStatus::Succeeded;
        let mut failed_step = None;

        for (index, action) in self.actions.iter().enumerate().skip(start_at) {
            if !action.enabled {
                continue;
            }
            let step = executor.execute(action, task);
            let succeeded = step.status == StepStatus::Succeeded;
            if !succeeded {
                status = match step.status {
                    StepStatus::TimedOut => ChainStatus::TimedOut,
                    StepStatus::Cancelled => ChainStatus::Cancelled,
                    _ => ChainStatus::Failed,
                };
                failed_step = Some(index);
            }
            steps.push(step);
            if !succeeded && action.stop_on_failure {
                break;
            }
        }

        ChainExecution {
            id: Uuid::new_v4().to_string(),
            status,
            failed_step,
            steps,
            started_at,
            finished_at: Utc::now(),
        }
    }
}

fn run_action_controlled(
    action: &CommandAction,
    task: &Task,
    cancellation: &CancellationToken,
) -> StepExecution {
    let started_at = Utc::now();
    if elevated_context() {
        return failed_before_start(action, started_at, "Contexte administrateur refusé");
    }
    let operating_system = OperatingSystem::current();
    let Some((runner, script)) = action.command_for(operating_system.clone()) else {
        return StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: StepStatus::Incompatible,
            exit_code: None,
            stdout: String::new(),
            stderr: "Aucune variante compatible avec ce système".into(),
            started_at,
            finished_at: Utc::now(),
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_bytes: Vec::new(),
            stderr_bytes: Vec::new(),
        };
    };
    let mut command = Command::new(runner);
    if action.direct_execution {
        command.args(&action.arguments);
    } else {
        configure_shell(&mut command, action.load_profile, script);
    }
    configure_process_group(&mut command);
    let secrets =
        match crate::secrets::resolve(&crate::secrets::OsSecretStore, &action.secret_names) {
            Ok(secrets) => secrets,
            Err(error) => return failed_before_start(action, started_at, &error.to_string()),
        };
    command
        .env("WORKONIT_TASK_ID", &task.id)
        .env("WORKONIT_TITLE", &task.title)
        .env("WORKONIT_DESCRIPTION", &task.description)
        .env("WORKONIT_COLUMN_ID", &task.column_id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (field_id, value) in &task.custom_values {
        command.env(
            format!("WORKONIT_FIELD_{}", environment_key(field_id)),
            value.text(),
        );
    }
    for (name, value) in &secrets {
        command.env(crate::secrets::environment_name(name), value);
    }
    if let Some(directory) = &action.working_directory {
        command.current_dir(directory);
    }

    let result = command.spawn();
    if let Err(error) = result {
        return StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: StepStatus::Failed,
            exit_code: None,
            stdout: String::new(),
            stderr: error.to_string(),
            started_at,
            finished_at: Utc::now(),
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_bytes: Vec::new(),
            stderr_bytes: Vec::new(),
        };
    }
    let mut child = result.expect("spawn result checked");
    if let Some(mut stdin) = child.stdin.take() {
        let task_json = serde_json::to_vec(task).unwrap_or_default();
        let _ = stdin.write_all(&task_json);
    }
    let output_limit = action.output_limit_bytes;
    let stdout = child
        .stdout
        .take()
        .map(|stream| read_stream(stream, output_limit));
    let stderr = child
        .stderr
        .take()
        .map(|stream| read_stream(stream, output_limit));
    let deadline = action
        .timeout_seconds
        .map(|seconds| Instant::now() + Duration::from_secs(seconds));
    let (mut step_status, exit_code) = loop {
        if cancellation.is_cancelled() {
            kill_process_tree(&mut child);
            break (StepStatus::Cancelled, None);
        }
        match child.try_wait() {
            Ok(Some(exit)) => {
                let code = exit.code();
                let accepted = code
                    .map(|code| action.accepted_exit_codes.contains(&code))
                    .unwrap_or(false);
                break (
                    if accepted {
                        StepStatus::Succeeded
                    } else {
                        StepStatus::Failed
                    },
                    code,
                );
            }
            Ok(None) if deadline.is_some_and(|deadline| Instant::now() >= deadline) => {
                kill_process_tree(&mut child);
                break (StepStatus::TimedOut, None);
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                return StepExecution {
                    action_id: action.id.clone(),
                    action_name: action.name.clone(),
                    status: StepStatus::Failed,
                    exit_code: None,
                    stdout: String::new(),
                    stderr: error.to_string(),
                    started_at,
                    finished_at: Utc::now(),
                    stdout_truncated: false,
                    stderr_truncated: false,
                    stdout_bytes: Vec::new(),
                    stderr_bytes: Vec::new(),
                };
            }
        }
    };
    let stdout_capture = stdout
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr_capture = stderr
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stdout_bytes = redact_bytes(stdout_capture.bytes, secrets.values());
    let stderr_bytes = redact_bytes(stderr_capture.bytes, secrets.values());
    let stdout = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_bytes).into_owned();
    if step_status == StepStatus::Succeeded {
        if let Some(validation) = &action.stdout_validation {
            if !validate_output(validation, &stdout) {
                step_status = StepStatus::Failed;
            }
        }
    }
    StepExecution {
        action_id: action.id.clone(),
        action_name: action.name.clone(),
        status: step_status,
        exit_code,
        stdout,
        stderr,
        started_at,
        finished_at: Utc::now(),
        stdout_truncated: stdout_capture.truncated,
        stderr_truncated: stderr_capture.truncated,
        stdout_bytes,
        stderr_bytes,
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(target_os = "windows")]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0000_0200);
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(child: &mut std::process::Child) {
    use wait_timeout::ChildExt;

    let process_group = format!("-{}", child.id());
    let _ = Command::new("kill")
        .args(["-TERM", &process_group])
        .status();
    if child
        .wait_timeout(std::time::Duration::from_millis(500))
        .ok()
        .flatten()
        .is_none()
    {
        let _ = Command::new("kill")
            .args(["-KILL", &process_group])
            .status();
    }
    let _ = child.wait();
}

#[cfg(target_os = "windows")]
fn kill_process_tree(child: &mut std::process::Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .status();
    let _ = child.wait();
}

fn failed_before_start(
    action: &CommandAction,
    started_at: DateTime<Utc>,
    message: &str,
) -> StepExecution {
    StepExecution {
        action_id: action.id.clone(),
        action_name: action.name.clone(),
        status: StepStatus::Failed,
        exit_code: None,
        stdout: String::new(),
        stderr: message.into(),
        started_at,
        finished_at: Utc::now(),
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_bytes: Vec::new(),
        stderr_bytes: Vec::new(),
    }
}

fn environment_key(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

fn redact_bytes<'a>(mut bytes: Vec<u8>, secrets: impl IntoIterator<Item = &'a String>) -> Vec<u8> {
    for secret in secrets {
        let needle = secret.as_bytes();
        if needle.is_empty() {
            continue;
        }
        let mut redacted = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index..].starts_with(needle) {
                redacted.extend_from_slice("••••••••".as_bytes());
                index += needle.len();
            } else {
                redacted.push(bytes[index]);
                index += 1;
            }
        }
        bytes = redacted;
    }
    bytes
}

fn validate_output(validation: &OutputValidation, stdout: &str) -> bool {
    match validation {
        OutputValidation::Regex(expression) => {
            Regex::new(expression).is_ok_and(|regex| regex.is_match(stdout))
        }
        OutputValidation::JsonPath(expression) => serde_json::from_str::<serde_json::Value>(stdout)
            .ok()
            .and_then(|value| {
                serde_json_path::JsonPath::parse(expression)
                    .ok()
                    .map(|path| !path.query(&value).is_empty())
            })
            .unwrap_or(false),
    }
}

#[cfg(target_os = "windows")]
fn elevated_context() -> bool {
    if std::env::var_os("WORKONIT_TEST_ELEVATED").is_some() {
        return true;
    }
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
        ])
        .output()
        .ok()
        .is_some_and(|output| String::from_utf8_lossy(&output.stdout).trim() == "True")
}

#[cfg(not(target_os = "windows"))]
fn elevated_context() -> bool {
    if std::env::var_os("WORKONIT_TEST_ELEVATED").is_some() {
        return true;
    }
    Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .is_some_and(|output| output.stdout == b"0\n")
}

#[derive(Default)]
struct CapturedStream {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_stream(
    stream: impl Read + Send + 'static,
    limit: usize,
) -> thread::JoinHandle<CapturedStream> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stream
            .take(limit.saturating_add(1) as u64)
            .read_to_end(&mut bytes);
        let truncated = bytes.len() > limit;
        bytes.truncate(limit);
        CapturedStream { bytes, truncated }
    })
}

fn default_output_limit() -> usize {
    10 * 1024 * 1024
}

#[cfg(target_os = "windows")]
fn configure_shell(command: &mut Command, load_profile: bool, script: &str) {
    let runner = command.get_program().to_string_lossy();
    if runner.ends_with("cmd") || runner.ends_with("cmd.exe") {
        command.args(["/C", script]);
    } else {
        if !load_profile {
            command.arg("-NoProfile");
        }
        command.args(["-NonInteractive", "-Command", script]);
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_shell(command: &mut Command, load_profile: bool, script: &str) {
    command.args(if load_profile {
        vec!["-l", "-c", script]
    } else {
        vec!["-c", script]
    });
}

#[cfg(target_os = "windows")]
fn default_runner() -> &'static str {
    "powershell"
}

#[cfg(target_os = "macos")]
fn default_runner() -> &'static str {
    "/bin/zsh"
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn default_runner() -> &'static str {
    "/bin/bash"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_command_helpers_normalize_redact_and_reject_elevation() {
        assert_eq!(environment_key("release channel-é"), "RELEASE_CHANNEL__");
        assert_eq!(
            redact_bytes(b"token=secret".to_vec(), [&"secret".to_owned()]),
            "token=••••••••".as_bytes()
        );
        assert_eq!(redact_bytes(b"plain".to_vec(), [&String::new()]), b"plain");

        let mut board = crate::domain::Board::starter("Elevated");
        board
            .add_task("Task", &board.columns[0].id.clone())
            .unwrap();
        unsafe { std::env::set_var("WORKONIT_TEST_ELEVATED", "1") };
        let step = run_action_controlled(
            &CommandAction::shell("Blocked", "ignored"),
            &board.tasks[0],
            &CancellationToken::default(),
        );
        unsafe { std::env::remove_var("WORKONIT_TEST_ELEVATED") };
        assert_eq!(step.status, StepStatus::Failed);
        assert!(step.stderr.contains("administrateur"));
    }

    #[test]
    fn shell_configuration_and_stream_capture_cover_profile_and_truncation() {
        let mut command = Command::new(default_runner());
        configure_shell(&mut command, false, "echo ok");
        assert!(!command.get_args().collect::<Vec<_>>().is_empty());
        let capture = read_stream(std::io::Cursor::new(b"abcdef".to_vec()), 3)
            .join()
            .unwrap();
        assert_eq!(capture.bytes, b"abc");
        assert!(capture.truncated);
    }
}
