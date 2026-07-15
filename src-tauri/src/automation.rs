use crate::domain::Task;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use uuid::Uuid;
use wait_timeout::ChildExt;

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
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus {
    Succeeded,
    Failed,
    TimedOut,
    Skipped,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChainStatus {
    Succeeded,
    Failed,
    TimedOut,
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

pub struct ActionChain {
    actions: Vec<CommandAction>,
}

impl ActionChain {
    pub fn new(actions: Vec<CommandAction>) -> Self {
        Self { actions }
    }

    pub fn run(&self, task: &Task, start_at: usize) -> ChainExecution {
        let started_at = Utc::now();
        let mut steps = Vec::new();
        let mut status = ChainStatus::Succeeded;
        let mut failed_step = None;

        for (index, action) in self.actions.iter().enumerate().skip(start_at) {
            if !action.enabled {
                continue;
            }
            let step = run_action(action, task);
            let succeeded = step.status == StepStatus::Succeeded;
            if !succeeded {
                status = if step.status == StepStatus::TimedOut {
                    ChainStatus::TimedOut
                } else {
                    ChainStatus::Failed
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

fn run_action(action: &CommandAction, task: &Task) -> StepExecution {
    let started_at = Utc::now();
    let mut command = Command::new(&action.runner);
    configure_shell(&mut command, action);
    command
        .env("WORKONIT_TASK_ID", &task.id)
        .env("WORKONIT_TITLE", &task.title)
        .env("WORKONIT_DESCRIPTION", &task.description)
        .env("WORKONIT_COLUMN_ID", &task.column_id)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
        };
    }
    let mut child = result.expect("spawn result checked");
    if let Some(mut stdin) = child.stdin.take() {
        let task_json = serde_json::to_vec(task).unwrap_or_default();
        let _ = stdin.write_all(&task_json);
    }
    let stdout = child.stdout.take().map(read_stream);
    let stderr = child.stderr.take().map(read_stream);
    let timeout = action.timeout_seconds.map(Duration::from_secs);
    let wait_result = match timeout {
        Some(timeout) => child.wait_timeout(timeout),
        None => child.wait().map(Some),
    };
    let (step_status, exit_code) = match wait_result {
        Ok(Some(exit)) => {
            let code = exit.code();
            let accepted = code
                .map(|code| action.accepted_exit_codes.contains(&code))
                .unwrap_or(false);
            (
                if accepted {
                    StepStatus::Succeeded
                } else {
                    StepStatus::Failed
                },
                code,
            )
        }
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            (StepStatus::TimedOut, None)
        }
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
            };
        }
    };
    StepExecution {
        action_id: action.id.clone(),
        action_name: action.name.clone(),
        status: step_status,
        exit_code,
        stdout: stdout
            .and_then(|reader| reader.join().ok())
            .unwrap_or_default(),
        stderr: stderr
            .and_then(|reader| reader.join().ok())
            .unwrap_or_default(),
        started_at,
        finished_at: Utc::now(),
    }
}

fn read_stream(stream: impl Read + Send + 'static) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stream.take(10 * 1024 * 1024 + 1).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes[..bytes.len().min(10 * 1024 * 1024)]).into_owned()
    })
}

#[cfg(target_os = "windows")]
fn configure_shell(command: &mut Command, action: &CommandAction) {
    if action.runner.ends_with("cmd") || action.runner.ends_with("cmd.exe") {
        command.args(["/C", &action.script]);
    } else {
        command.args(["-NoProfile", "-NonInteractive", "-Command", &action.script]);
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_shell(command: &mut Command, action: &CommandAction) {
    command.args(if action.load_profile {
        vec!["-l", "-c", &action.script]
    } else {
        vec!["-c", &action.script]
    });
}

#[cfg(target_os = "windows")]
fn default_runner() -> &'static str {
    "powershell"
}

#[cfg(not(target_os = "windows"))]
fn default_runner() -> &'static str {
    "/bin/zsh"
}
