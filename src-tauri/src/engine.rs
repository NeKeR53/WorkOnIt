use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    automation::{
        ActionChain, ActionCondition, ActionExecutor, ChainExecution, ChainStatus, CommandAction,
        TransitionAutomation,
    },
    domain::{Board, DomainError, ExecutionStatus, Task, TransitionOrigin},
};

#[derive(Debug, Clone)]
pub struct TransitionRequest {
    pub task_id: String,
    pub target_column_id: String,
    pub origin: TransitionOrigin,
    pub confirmed: bool,
}

#[derive(Debug, Clone)]
pub struct ResumeRequest {
    pub task_id: String,
    pub failed_step: usize,
    pub automation_ids: Vec<String>,
    pub origin: TransitionOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionResult {
    pub automation_ids: Vec<String>,
    pub execution: Option<ChainExecution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDeletionImpact {
    pub moved_task_ids: Vec<String>,
    pub disabled_automation_ids: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransitionError {
    #[error("{0}")]
    Domain(#[from] DomainError),
    #[error("La tâche est verrouillée pendant son exécution")]
    TaskLocked,
    #[error("Une confirmation est requise avant cette transition")]
    ConfirmationRequired,
    #[error("Action introuvable : {0}")]
    ActionNotFound(String),
    #[error("Étape de reprise invalide")]
    InvalidFailedStep,
}

pub fn transition_task(
    board: &mut Board,
    automations: &[TransitionAutomation],
    actions: &HashMap<String, CommandAction>,
    executor: &impl ActionExecutor,
    request: TransitionRequest,
) -> Result<TransitionResult, TransitionError> {
    let task = board
        .tasks
        .iter()
        .find(|task| task.id == request.task_id)
        .ok_or(DomainError::TaskNotFound)?;
    if matches!(
        task.execution_status,
        ExecutionStatus::Pending | ExecutionStatus::Running { .. }
    ) {
        return Err(TransitionError::TaskLocked);
    }
    let from_column_id = task.column_id.clone();
    let matching: Vec<&TransitionAutomation> = automations
        .iter()
        .filter(|automation| {
            automation.enabled
                && automation.board_id == board.id
                && automation.to_column_id == request.target_column_id
                && automation
                    .from_column_id
                    .as_ref()
                    .is_none_or(|from| from == &from_column_id)
                && automation.origins.contains(&request.origin)
        })
        .collect();

    let selected_actions = resolve_actions(&matching, actions, task, &request.origin)?;
    let confirmation_required = matching
        .iter()
        .any(|automation| automation.require_confirmation)
        || selected_actions.iter().any(|action| action.destructive);
    if confirmation_required && !request.confirmed {
        return Err(TransitionError::ConfirmationRequired);
    }

    board.move_task(&request.task_id, &request.target_column_id, request.origin)?;
    if selected_actions.is_empty() {
        return Ok(TransitionResult {
            automation_ids: matching
                .iter()
                .map(|automation| automation.id.clone())
                .collect(),
            execution: None,
        });
    }

    set_task_status(
        board,
        &request.task_id,
        ExecutionStatus::Running {
            step: 1,
            total: selected_actions.len() as u32,
        },
    );
    let task_snapshot = board
        .tasks
        .iter()
        .find(|task| task.id == request.task_id)
        .expect("moved task remains in board")
        .clone();
    let execution =
        ActionChain::new(selected_actions).run_with_executor(&task_snapshot, 0, executor);
    let status = match execution.status {
        ChainStatus::Succeeded => ExecutionStatus::Succeeded,
        ChainStatus::Failed => ExecutionStatus::Failed,
        ChainStatus::TimedOut => ExecutionStatus::Failed,
        ChainStatus::Cancelled => ExecutionStatus::Cancelled,
    };
    set_task_status(board, &request.task_id, status);
    Ok(TransitionResult {
        automation_ids: matching
            .iter()
            .map(|automation| automation.id.clone())
            .collect(),
        execution: Some(execution),
    })
}

pub fn resume_transition(
    board: &mut Board,
    automations: &[TransitionAutomation],
    actions: &HashMap<String, CommandAction>,
    executor: &impl ActionExecutor,
    request: ResumeRequest,
) -> Result<ChainExecution, TransitionError> {
    let task = board
        .tasks
        .iter()
        .find(|task| task.id == request.task_id)
        .ok_or(DomainError::TaskNotFound)?;
    if matches!(
        task.execution_status,
        ExecutionStatus::Pending | ExecutionStatus::Running { .. }
    ) {
        return Err(TransitionError::TaskLocked);
    }
    let selected_automations: Vec<&TransitionAutomation> = automations
        .iter()
        .filter(|automation| {
            automation.enabled
                && automation.board_id == board.id
                && request.automation_ids.contains(&automation.id)
        })
        .collect();
    let selected_actions = resolve_actions(&selected_automations, actions, task, &request.origin)?;
    if request.failed_step >= selected_actions.len() {
        return Err(TransitionError::InvalidFailedStep);
    }
    set_task_status(
        board,
        &request.task_id,
        ExecutionStatus::Running {
            step: request.failed_step as u32 + 1,
            total: selected_actions.len() as u32,
        },
    );
    let task_snapshot = board
        .tasks
        .iter()
        .find(|task| task.id == request.task_id)
        .expect("task remains in board")
        .clone();
    let execution = ActionChain::new(selected_actions).run_with_executor(
        &task_snapshot,
        request.failed_step,
        executor,
    );
    let status = match execution.status {
        ChainStatus::Succeeded => ExecutionStatus::Succeeded,
        ChainStatus::Failed | ChainStatus::TimedOut => ExecutionStatus::Failed,
        ChainStatus::Cancelled => ExecutionStatus::Cancelled,
    };
    set_task_status(board, &request.task_id, status);
    Ok(execution)
}

pub fn delete_column(
    board: &mut Board,
    automations: &mut [TransitionAutomation],
    column_id: &str,
    destination_id: &str,
) -> Result<ColumnDeletionImpact, TransitionError> {
    let moved_task_ids = board.migrate_and_remove_column(column_id, destination_id)?;
    let mut disabled_automation_ids = Vec::new();
    for automation in automations.iter_mut().filter(|automation| {
        automation.board_id == board.id
            && (automation.from_column_id.as_deref() == Some(column_id)
                || automation.to_column_id == column_id)
    }) {
        automation.enabled = false;
        disabled_automation_ids.push(automation.id.clone());
    }
    Ok(ColumnDeletionImpact {
        moved_task_ids,
        disabled_automation_ids,
    })
}

fn resolve_actions(
    automations: &[&TransitionAutomation],
    actions: &HashMap<String, CommandAction>,
    task: &Task,
    origin: &TransitionOrigin,
) -> Result<Vec<CommandAction>, TransitionError> {
    let mut selected = Vec::new();
    for automation in automations {
        for step in &automation.steps {
            if step
                .condition
                .as_ref()
                .is_some_and(|condition| !condition_matches(condition, task, origin))
            {
                continue;
            }
            let mut action = actions
                .get(&step.action_id)
                .cloned()
                .ok_or_else(|| TransitionError::ActionNotFound(step.action_id.clone()))?;
            action.stop_on_failure = step.stop_on_failure;
            selected.push(action);
        }
    }
    Ok(selected)
}

pub fn executable_step_count(
    automations: &[TransitionAutomation],
    actions: &[CommandAction],
    task: &Task,
    origin: &TransitionOrigin,
) -> Result<u32, TransitionError> {
    let action_map = actions
        .iter()
        .cloned()
        .map(|action| (action.id.clone(), action))
        .collect::<HashMap<_, _>>();
    let automation_refs = automations.iter().collect::<Vec<_>>();
    Ok(
        resolve_actions(&automation_refs, &action_map, task, origin)?
            .into_iter()
            .filter(|action| action.enabled)
            .count() as u32,
    )
}

fn condition_matches(condition: &ActionCondition, task: &Task, origin: &TransitionOrigin) -> bool {
    match condition {
        ActionCondition::FieldEquals { field, value } => {
            task_field(task, field) == Some(value.clone())
        }
        ActionCondition::FieldContains { field, value } => {
            task_field(task, field).is_some_and(|candidate| candidate.contains(value))
        }
        ActionCondition::Origin { origin: expected } => expected == origin,
        ActionCondition::OperatingSystem { name } => {
            name.eq_ignore_ascii_case(std::env::consts::OS)
                || (std::env::consts::OS == "macos" && name.eq_ignore_ascii_case("macOs"))
        }
    }
}

fn task_field(task: &Task, field: &str) -> Option<String> {
    match field {
        "title" => Some(task.title.clone()),
        "description" => Some(task.description.clone()),
        "priority" => task.priority.clone(),
        "source" => task.source_name.clone(),
        "tags" => Some(task.tags.join(",")),
        custom => task.custom_values.get(custom).map(|value| value.text()),
    }
}

fn set_task_status(board: &mut Board, task_id: &str, status: ExecutionStatus) {
    if let Some(task) = board.tasks.iter_mut().find(|task| task.id == task_id) {
        task.execution_status = status;
        task.updated_at = chrono::Utc::now();
    }
}
