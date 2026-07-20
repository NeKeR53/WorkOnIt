use chrono::Datelike;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    cell::{Cell, RefCell},
    collections::{HashMap, HashSet},
    path::Path,
};
use thiserror::Error;

use crate::{
    automation::{
        ActionExecutor, ChainExecution, ChainStatus, CommandAction, ExecutionRecord, StepExecution,
    },
    domain::ExecutionStatus,
    engine::{
        resume_transition, transition_task, ResumeRequest, TransitionError, TransitionRequest,
        TransitionResult,
    },
    exchange::{apply_import, ConflictDecision, ExportBundle},
    scheduler::{process_due_triggers, ScheduleError, SchedulerEvent},
    sources::{
        apply_source_preview, planned_source_moves, run_source_controlled, SourceCoordinator,
        SourceDefinition, SourceError, SourceExecutor, SourcePreview, SourceRunRequest,
    },
    storage::{BackupKind, StorageError, Store},
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SchedulerTickResult {
    pub ran_source_ids: Vec<String>,
    pub missed_source_ids: Vec<String>,
    pub skipped_active_source_ids: Vec<String>,
}

const SCHEDULER_JOURNAL_KEY: &str = "scheduler.journal";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerJournalEntry {
    pub id: String,
    pub source_id: String,
    pub kind: String,
    pub occurred_at: DateTime<Utc>,
}

pub fn list_scheduler_journal(store: &Store) -> Result<Vec<SchedulerJournalEntry>, ServiceError> {
    Ok(store
        .get_setting(SCHEDULER_JOURNAL_KEY)?
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

fn journal_scheduler_event(store: &Store, source_id: &str, kind: &str, now: DateTime<Utc>) {
    let Ok(mut entries) = list_scheduler_journal(store) else {
        return;
    };
    entries.push(SchedulerJournalEntry {
        id: uuid::Uuid::new_v4().to_string(),
        source_id: source_id.to_owned(),
        kind: kind.to_owned(),
        occurred_at: now,
    });
    if entries.len() > 500 {
        entries.drain(..entries.len() - 500);
    }
    if let Ok(value) = serde_json::to_string(&entries) {
        let _ = store.set_setting(SCHEDULER_JOURNAL_KEY, &value);
    }
}

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("{0}")]
    Storage(#[from] StorageError),
    #[error("{0}")]
    Schedule(#[from] ScheduleError),
    #[error("{0}")]
    Source(#[from] SourceError),
    #[error("{0}")]
    Transition(#[from] TransitionError),
    #[error("{0}")]
    Exchange(#[from] crate::exchange::ExchangeError),
}

pub fn export_all(store: &Store) -> Result<ExportBundle, ServiceError> {
    let boards = store.list_boards()?;
    let mut automations = Vec::new();
    for board in &boards {
        automations.extend(store.list_transition_automations(&board.id)?);
    }
    Ok(ExportBundle {
        boards,
        actions: store.list_actions()?,
        automations,
        sources: store.list_all_sources()?,
        triggers: store.list_all_triggers()?,
        execution_history: store.list_executions()?,
        logs: Vec::new(),
    })
}

pub fn export_selected(
    store: &Store,
    board_ids: &[String],
    include_actions: bool,
    include_sources: bool,
    include_triggers: bool,
) -> Result<ExportBundle, ServiceError> {
    let selected_boards: HashSet<&str> = board_ids.iter().map(String::as_str).collect();
    let mut bundle = export_all(store)?;
    bundle
        .boards
        .retain(|board| selected_boards.contains(board.id.as_str()));
    bundle
        .automations
        .retain(|automation| selected_boards.contains(automation.board_id.as_str()));
    if !include_actions {
        bundle.actions.clear();
        bundle.automations.clear();
    } else {
        let action_ids: HashSet<&str> = bundle
            .automations
            .iter()
            .flat_map(|automation| automation.steps.iter().map(|step| step.action_id.as_str()))
            .collect();
        bundle
            .actions
            .retain(|action| action_ids.contains(action.id.as_str()));
    }
    let selected_source_ids: HashSet<&str> = bundle
        .boards
        .iter()
        .flat_map(|board| board.source_ids.iter().map(String::as_str))
        .collect();
    bundle
        .sources
        .retain(|source| include_sources && selected_source_ids.contains(source.id.as_str()));
    let source_ids: HashSet<&str> = bundle
        .sources
        .iter()
        .map(|source| source.id.as_str())
        .collect();
    bundle
        .triggers
        .retain(|trigger| include_triggers && source_ids.contains(trigger.source_id.as_str()));
    let task_ids: HashSet<&str> = bundle
        .boards
        .iter()
        .flat_map(|board| board.tasks.iter().map(|task| task.id.as_str()))
        .collect();
    bundle
        .execution_history
        .retain(|execution| task_ids.contains(execution.task_id.as_str()));
    Ok(bundle)
}

pub fn apply_import_to_store(
    store: &Store,
    backup_directory: &Path,
    imported: &ExportBundle,
    decisions: &[ConflictDecision],
) -> Result<ExportBundle, ServiceError> {
    store.create_backup(backup_directory, BackupKind::PreImport)?;
    let mut merged = apply_import(&export_all(store)?, imported, decisions)?;
    for source in &mut merged.sources {
        if let Some(board) = merged
            .boards
            .iter_mut()
            .find(|board| board.id == source.board_id)
        {
            if !board.source_ids.contains(&source.id) {
                board.source_ids.push(source.id.clone());
            }
        }
        source.board_id.clear();
    }
    for board in &merged.boards {
        store.save_board(board)?;
    }
    for action in &merged.actions {
        store.save_action(action)?;
    }
    for automation in &merged.automations {
        store.save_transition_automation(automation)?;
    }
    for source in &merged.sources {
        store.save_source(source)?;
    }
    for trigger in &merged.triggers {
        store.save_trigger(trigger)?;
    }
    for execution in &merged.execution_history {
        store.save_execution(execution)?;
    }
    Ok(merged)
}

pub fn maintain_backups(
    store: &Store,
    directory: &Path,
    now: DateTime<Utc>,
) -> Result<Vec<std::path::PathBuf>, ServiceError> {
    let mut created = Vec::new();
    let daily_key = now.format("%Y-%m-%d").to_string();
    if store.get_setting("backup.last_daily")?.as_deref() != Some(&daily_key) {
        created.push(store.create_backup(directory, BackupKind::Daily)?);
        store.set_setting("backup.last_daily", &daily_key)?;
    }
    let iso_week = now.iso_week();
    let weekly_key = format!("{}-{:02}", iso_week.year(), iso_week.week());
    if now.weekday().number_from_monday() == 1
        && store.get_setting("backup.last_weekly")?.as_deref() != Some(&weekly_key)
    {
        created.push(store.create_backup(directory, BackupKind::Weekly)?);
        store.set_setting("backup.last_weekly", &weekly_key)?;
    }
    Store::prune_backups(directory, 7, 4)?;
    Ok(created)
}

pub fn execute_transition(
    store: &Store,
    executor: &impl ActionExecutor,
    board_id: &str,
    request: TransitionRequest,
) -> Result<TransitionResult, ServiceError> {
    let mut board = store
        .get_board(board_id)?
        .ok_or(crate::domain::DomainError::BoardNotFound)
        .map_err(TransitionError::from)?;
    let automations = store.list_transition_automations(board_id)?;
    let actions: HashMap<String, CommandAction> = store
        .list_actions()?
        .into_iter()
        .map(|action| (action.id.clone(), action))
        .collect();
    let automation_ids: Vec<String> = automations
        .iter()
        .filter(|automation| automation.enabled)
        .map(|automation| automation.id.clone())
        .collect();
    let total_steps = automations
        .iter()
        .filter(|automation| automation.enabled)
        .map(|automation| automation.steps.len() as u32)
        .sum();
    let recording = PersistingActionExecutor {
        store,
        inner: executor,
        started: Cell::new(false),
        record: RefCell::new(ExecutionRecord::running(
            &request.task_id,
            automation_ids,
            total_steps,
        )),
    };
    let mut result = transition_task(&mut board, &automations, &actions, &recording, request)?;
    store.save_board(&board)?;
    if let Some(execution) = &result.execution {
        let mut record = recording.record.borrow_mut();
        let mut execution = execution.clone();
        execution.id = record.id.clone();
        record.status = match execution.status {
            ChainStatus::Succeeded => ExecutionStatus::Succeeded,
            ChainStatus::Failed | ChainStatus::TimedOut => ExecutionStatus::Failed,
            ChainStatus::Cancelled => ExecutionStatus::Cancelled,
        };
        record.steps = execution.steps.clone();
        record.failed_step = execution.failed_step;
        record.finished_at = Some(execution.finished_at);
        store.save_execution(&record)?;
        result.execution = Some(execution);
    }
    Ok(result)
}

pub fn apply_source_with_transitions(
    store: &Store,
    executor: &impl ActionExecutor,
    source: &SourceDefinition,
    preview: &SourcePreview,
) -> Result<crate::sources::ImportSummary, ServiceError> {
    let mut board = store
        .get_board(&source.board_id)?
        .ok_or(crate::domain::DomainError::BoardNotFound)
        .map_err(TransitionError::from)?;
    let mut without_moves = source.clone();
    without_moves.move_existing_tasks = false;
    let mut summary = apply_source_preview(&mut board, &without_moves, preview)?;
    store.save_board(&board)?;
    summary.pending_moves = execute_source_moves(store, executor, source, preview)?;
    Ok(summary)
}

pub fn execute_source_moves(
    store: &Store,
    executor: &impl ActionExecutor,
    source: &SourceDefinition,
    preview: &SourcePreview,
) -> Result<usize, ServiceError> {
    let board = store
        .get_board(&source.board_id)?
        .ok_or(crate::domain::DomainError::BoardNotFound)
        .map_err(TransitionError::from)?;
    let moves = planned_source_moves(&board, source, preview);
    let mut pending_moves = 0;
    for movement in moves {
        if execute_transition(
            store,
            executor,
            &source.board_id,
            TransitionRequest {
                task_id: movement.task_id,
                target_column_id: movement.target_column_id,
                origin: crate::domain::TransitionOrigin::Source,
                confirmed: false,
            },
        )
        .is_err()
        {
            pending_moves += 1;
        }
    }
    Ok(pending_moves)
}

pub fn resume_execution(
    store: &Store,
    executor: &impl ActionExecutor,
    board_id: &str,
    execution_id: &str,
    restart_all: bool,
) -> Result<ChainExecution, ServiceError> {
    let mut record = store
        .get_execution(execution_id)?
        .ok_or_else(|| StorageError::MissingRecord(execution_id.to_owned()))?;
    let mut board = store
        .get_board(board_id)?
        .ok_or(crate::domain::DomainError::BoardNotFound)
        .map_err(TransitionError::from)?;
    let automations = store.list_transition_automations(board_id)?;
    let actions: HashMap<String, CommandAction> = store
        .list_actions()?
        .into_iter()
        .map(|action| (action.id.clone(), action))
        .collect();
    let start_at = if restart_all {
        0
    } else {
        record.failed_step.unwrap_or(record.steps.len())
    };
    let execution = resume_transition(
        &mut board,
        &automations,
        &actions,
        executor,
        ResumeRequest {
            task_id: record.task_id.clone(),
            failed_step: start_at,
            automation_ids: record.automation_ids.clone(),
            origin: crate::domain::TransitionOrigin::System,
        },
    )?;
    record.steps.extend(execution.steps.clone());
    record.failed_step = execution.failed_step;
    record.status = match execution.status {
        ChainStatus::Succeeded => ExecutionStatus::Succeeded,
        ChainStatus::Failed | ChainStatus::TimedOut => ExecutionStatus::Failed,
        ChainStatus::Cancelled => ExecutionStatus::Cancelled,
    };
    record.finished_at = Some(execution.finished_at);
    store.save_board(&board)?;
    store.save_execution(&record)?;
    Ok(execution)
}

pub fn abandon_execution(
    store: &Store,
    board_id: &str,
    execution_id: &str,
) -> Result<(), ServiceError> {
    let mut record = store
        .get_execution(execution_id)?
        .ok_or_else(|| StorageError::MissingRecord(execution_id.to_owned()))?;
    record.status = ExecutionStatus::Cancelled;
    record.finished_at = Some(Utc::now());
    let mut board = store
        .get_board(board_id)?
        .ok_or(crate::domain::DomainError::BoardNotFound)
        .map_err(TransitionError::from)?;
    if let Some(task) = board
        .tasks
        .iter_mut()
        .find(|task| task.id == record.task_id)
    {
        task.execution_status = ExecutionStatus::Cancelled;
        task.updated_at = Utc::now();
    }
    store.save_board(&board)?;
    store.save_execution(&record)?;
    Ok(())
}

struct PersistingActionExecutor<'a, E> {
    store: &'a Store,
    inner: &'a E,
    started: Cell<bool>,
    record: RefCell<ExecutionRecord>,
}

impl<E: ActionExecutor> ActionExecutor for PersistingActionExecutor<'_, E> {
    fn execute(&self, action: &CommandAction, task: &crate::domain::Task) -> StepExecution {
        if !self.started.replace(true) {
            let _ = self.store.save_execution(&self.record.borrow());
        }
        let step = self.inner.execute(action, task);
        let mut record = self.record.borrow_mut();
        record.steps.push(step.clone());
        let total = match record.status {
            ExecutionStatus::Running { total, .. } => total,
            _ => record.steps.len() as u32,
        };
        record.status = ExecutionStatus::Running {
            step: (record.steps.len() as u32 + 1).min(total),
            total,
        };
        let _ = self.store.save_execution(&record);
        step
    }
}

pub fn run_scheduler_tick(
    store: &Store,
    coordinator: &SourceCoordinator,
    executor: &impl SourceExecutor,
    now: DateTime<Utc>,
    woke_from_sleep: bool,
) -> Result<SchedulerTickResult, ServiceError> {
    let mut triggers = store.list_all_triggers()?;
    let events = process_due_triggers(&mut triggers, now, woke_from_sleep)?;
    for trigger in &triggers {
        store.save_trigger(trigger)?;
    }
    let mut result = SchedulerTickResult::default();
    for event in events {
        match event {
            SchedulerEvent::Missed { source_id } => {
                journal_scheduler_event(store, &source_id, "missed", now);
                result.missed_source_ids.push(source_id);
            }
            SchedulerEvent::RunSource { source_id } => {
                let Some(source) = store.get_source(&source_id)? else {
                    continue;
                };
                if !source.enabled {
                    continue;
                }
                let guard = match coordinator.start(&source.id) {
                    Ok(guard) => guard,
                    Err(SourceError::AlreadyActive) => {
                        journal_scheduler_event(store, &source.id, "alreadyActive", now);
                        result.skipped_active_source_ids.push(source.id.clone());
                        continue;
                    }
                    Err(error) => return Err(error.into()),
                };
                let Some(mut board) = store.get_board(&source.board_id)? else {
                    continue;
                };
                let mut execution_source = source.clone();
                execution_source.move_existing_tasks = false;
                let source_result = run_source_controlled(
                    &mut board,
                    &execution_source,
                    executor,
                    SourceRunRequest::automatic(),
                    guard.cancellation(),
                )?;
                store.save_board(&board)?;
                execute_source_moves(
                    store,
                    &crate::automation::SystemActionExecutor,
                    &source,
                    &source_result.preview,
                )?;
                result.ran_source_ids.push(source.id.clone());
                drop(guard);
            }
        }
    }
    Ok(result)
}
