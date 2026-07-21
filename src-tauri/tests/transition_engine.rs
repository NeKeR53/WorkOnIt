use std::{cell::RefCell, collections::HashMap};

use chrono::Utc;
use workonit_lib::{
    automation::{
        ActionCondition, ActionExecutor, ActionStep, CommandAction, StepExecution, StepStatus,
        TransitionAutomation,
    },
    domain::{Board, ExecutionStatus, TransitionOrigin, WipPolicy},
    engine::{
        delete_column, executable_step_count, resume_transition, transition_task, ResumeRequest,
        TransitionError, TransitionRequest,
    },
};

struct RecordingExecutor {
    executed: RefCell<Vec<String>>,
    fail_action: Option<String>,
}

#[test]
fn transition_maps_timeout_and_cancellation_and_deletion_matches_target_references() {
    for (step_status, expected) in [
        (StepStatus::TimedOut, ExecutionStatus::Failed),
        (StepStatus::Cancelled, ExecutionStatus::Cancelled),
    ] {
        let mut board = Board::starter("Status");
        let from = board.columns[0].id.clone();
        let to = board.columns[1].id.clone();
        let task_id = board.add_task("Task", &from).unwrap();
        let action = CommandAction::shell("Run", "run");
        let automation = TransitionAutomation::new(
            &board.id,
            Some(from),
            &to,
            vec![ActionStep::new(&action.id)],
        );
        transition_task(
            &mut board,
            &[automation],
            &HashMap::from([(action.id.clone(), action)]),
            &StatusExecutor(step_status),
            TransitionRequest {
                task_id,
                target_column_id: to,
                origin: TransitionOrigin::User,
                confirmed: true,
            },
        )
        .unwrap();
        assert_eq!(board.tasks[0].execution_status, expected);
    }

    let mut board = Board::new("Delete");
    let removed = board.add_column("Removed", WipPolicy::None);
    let kept = board.add_column("Kept", WipPolicy::None);
    let mut automations = vec![TransitionAutomation::new(
        &board.id,
        Some(kept.clone()),
        &removed,
        Vec::new(),
    )];
    let impact = delete_column(&mut board, &mut automations, &removed, &kept).unwrap();
    assert_eq!(
        impact.disabled_automation_ids,
        vec![automations[0].id.clone()]
    );
    assert!(!automations[0].enabled);

    let mut board = Board::starter("OS");
    let from = board.columns[0].id.clone();
    let to = board.columns[1].id.clone();
    let task_id = board.add_task("Task", &from).unwrap();
    let action = CommandAction::shell("OS", "run");
    let mut step = ActionStep::new(&action.id);
    step.condition = Some(ActionCondition::OperatingSystem {
        name: std::env::consts::OS.into(),
    });
    let automation = TransitionAutomation::new(&board.id, Some(from), &to, vec![step]);
    let executor = RecordingExecutor {
        executed: RefCell::new(Vec::new()),
        fail_action: None,
    };
    transition_task(
        &mut board,
        &[automation],
        &HashMap::from([(action.id.clone(), action)]),
        &executor,
        TransitionRequest {
            task_id,
            target_column_id: to,
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(executor.executed.borrow().len(), 1);
}

struct StatusExecutor(StepStatus);

impl ActionExecutor for StatusExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: self.0.clone(),
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            started_at: Utc::now(),
            finished_at: Utc::now(),
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_bytes: Vec::new(),
            stderr_bytes: Vec::new(),
        }
    }
}

impl ActionExecutor for RecordingExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        self.executed.borrow_mut().push(action.id.clone());
        let failed = self.fail_action.as_ref() == Some(&action.id);
        StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: if failed {
                StepStatus::Failed
            } else {
                StepStatus::Succeeded
            },
            exit_code: Some(if failed { 9 } else { 0 }),
            stdout: String::new(),
            stderr: if failed { "boom".into() } else { String::new() },
            started_at: Utc::now(),
            finished_at: Utc::now(),
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_bytes: Vec::new(),
            stderr_bytes: Vec::new(),
        }
    }
}

#[test]
fn transition_guards_confirmation_lock_missing_actions_and_empty_chains() {
    let mut board = Board::starter("Guards");
    let from = board.columns[0].id.clone();
    let to = board.columns[1].id.clone();
    let task_id = board.add_task("Task", &from).unwrap();
    let action = CommandAction::shell("Danger", "danger");
    let mut automation = TransitionAutomation::new(
        &board.id,
        Some(from.clone()),
        &to,
        vec![ActionStep::new(&action.id)],
    );
    automation.require_confirmation = true;
    let actions = HashMap::from([(action.id.clone(), action)]);
    let executor = StatusExecutor(StepStatus::Succeeded);
    assert_eq!(
        transition_task(
            &mut board,
            std::slice::from_ref(&automation),
            &actions,
            &executor,
            TransitionRequest {
                task_id: task_id.clone(),
                target_column_id: to.clone(),
                origin: TransitionOrigin::User,
                confirmed: false,
            },
        )
        .unwrap_err(),
        TransitionError::ConfirmationRequired
    );
    board.tasks[0].execution_status = ExecutionStatus::Pending;
    assert_eq!(
        transition_task(
            &mut board,
            &[],
            &actions,
            &executor,
            TransitionRequest {
                task_id: task_id.clone(),
                target_column_id: to.clone(),
                origin: TransitionOrigin::User,
                confirmed: true,
            },
        )
        .unwrap_err(),
        TransitionError::TaskLocked
    );
    board.tasks[0].execution_status = ExecutionStatus::Idle;
    assert_eq!(
        transition_task(
            &mut board,
            &[automation],
            &HashMap::new(),
            &executor,
            TransitionRequest {
                task_id: task_id.clone(),
                target_column_id: to.clone(),
                origin: TransitionOrigin::User,
                confirmed: true,
            },
        )
        .unwrap_err(),
        TransitionError::ActionNotFound(actions.keys().next().unwrap().clone())
    );
    let result = transition_task(
        &mut board,
        &[],
        &actions,
        &executor,
        TransitionRequest {
            task_id,
            target_column_id: to,
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(result.execution.is_none());
}

#[test]
fn visual_conditions_select_fields_origin_os_and_skip_non_matches() {
    let mut board = Board::starter("Conditions");
    let from = board.columns[0].id.clone();
    let to = board.columns[1].id.clone();
    let task_id = board.add_task("Release stable", &from).unwrap();
    board.tasks[0].description = "ready now".into();
    board.tasks[0].priority = Some("high".into());
    board.tasks[0].source_name = Some("api".into());
    board.tasks[0].tags = vec!["release".into(), "stable".into()];
    let custom = board
        .add_custom_field("Channel", workonit_lib::domain::FieldKind::Text, false)
        .unwrap();
    board
        .set_custom_value(
            &task_id,
            &custom,
            workonit_lib::domain::CustomFieldValue::Text("stable".into()),
        )
        .unwrap();
    let action = CommandAction::shell("Run", "run");
    let actions = HashMap::from([(action.id.clone(), action.clone())]);
    let conditions = vec![
        ActionCondition::FieldEquals {
            field: "title".into(),
            value: "Release stable".into(),
        },
        ActionCondition::FieldContains {
            field: "description".into(),
            value: "ready".into(),
        },
        ActionCondition::FieldEquals {
            field: "priority".into(),
            value: "high".into(),
        },
        ActionCondition::FieldEquals {
            field: "source".into(),
            value: "api".into(),
        },
        ActionCondition::FieldContains {
            field: "tags".into(),
            value: "stable".into(),
        },
        ActionCondition::FieldEquals {
            field: custom,
            value: "stable".into(),
        },
        ActionCondition::Origin {
            origin: TransitionOrigin::User,
        },
        ActionCondition::OperatingSystem {
            name: std::env::consts::OS.into(),
        },
    ];
    let mut steps = Vec::new();
    for condition in conditions {
        let mut step = ActionStep::new(&action.id);
        step.condition = Some(condition);
        steps.push(step);
    }
    let mut skipped = ActionStep::new(&action.id);
    skipped.condition = Some(ActionCondition::FieldEquals {
        field: "title".into(),
        value: "no".into(),
    });
    steps.push(skipped);
    let mut disabled_action = CommandAction::shell("Disabled", "skip");
    disabled_action.enabled = false;
    steps.push(ActionStep::new(&disabled_action.id));
    let automation = TransitionAutomation::new(&board.id, Some(from), &to, steps);
    let mut actions = actions;
    actions.insert(disabled_action.id.clone(), disabled_action);
    assert_eq!(
        executable_step_count(
            std::slice::from_ref(&automation),
            &actions.values().cloned().collect::<Vec<_>>(),
            &board.tasks[0],
            &TransitionOrigin::User,
        )
        .unwrap(),
        8
    );
    let executor = RecordingExecutor {
        executed: RefCell::new(Vec::new()),
        fail_action: None,
    };
    transition_task(
        &mut board,
        &[automation],
        &actions,
        &executor,
        TransitionRequest {
            task_id,
            target_column_id: to,
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(executor.executed.borrow().len(), 8);
}

#[test]
fn resume_rejects_locks_missing_tasks_and_bad_steps_and_maps_terminal_statuses() {
    let mut board = Board::starter("Resume");
    let task_id = board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    let action = CommandAction::shell("Run", "run");
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[1].id,
        vec![ActionStep::new(&action.id)],
    );
    let actions = HashMap::from([(action.id.clone(), action)]);
    let request = ResumeRequest {
        task_id: task_id.clone(),
        failed_step: 1,
        automation_ids: vec![automation.id.clone()],
        origin: TransitionOrigin::System,
    };
    assert_eq!(
        resume_transition(
            &mut board,
            std::slice::from_ref(&automation),
            &actions,
            &StatusExecutor(StepStatus::Succeeded),
            request
        )
        .unwrap_err(),
        TransitionError::InvalidFailedStep
    );
    board.tasks[0].execution_status = ExecutionStatus::Running { step: 1, total: 1 };
    assert_eq!(
        resume_transition(
            &mut board,
            std::slice::from_ref(&automation),
            &actions,
            &StatusExecutor(StepStatus::Succeeded),
            ResumeRequest {
                task_id: task_id.clone(),
                failed_step: 0,
                automation_ids: vec![automation.id.clone()],
                origin: TransitionOrigin::System
            }
        )
        .unwrap_err(),
        TransitionError::TaskLocked
    );
    board.tasks[0].execution_status = ExecutionStatus::Failed;
    for (status, expected) in [
        (StepStatus::TimedOut, ExecutionStatus::Failed),
        (StepStatus::Cancelled, ExecutionStatus::Cancelled),
    ] {
        resume_transition(
            &mut board,
            std::slice::from_ref(&automation),
            &actions,
            &StatusExecutor(status),
            ResumeRequest {
                task_id: task_id.clone(),
                failed_step: 0,
                automation_ids: vec![automation.id.clone()],
                origin: TransitionOrigin::System,
            },
        )
        .unwrap();
        assert_eq!(board.tasks[0].execution_status, expected);
        board.tasks[0].execution_status = ExecutionStatus::Failed;
    }
    assert!(matches!(
        resume_transition(
            &mut board,
            &[automation],
            &actions,
            &StatusExecutor(StepStatus::Succeeded),
            ResumeRequest {
                task_id: "missing".into(),
                failed_step: 0,
                automation_ids: vec![],
                origin: TransitionOrigin::System
            }
        ),
        Err(TransitionError::Domain(
            workonit_lib::domain::DomainError::TaskNotFound
        ))
    ));
}

#[test]
fn transition_executes_bound_actions_and_keeps_failed_task_in_target() {
    let mut board = Board::new("Release");
    let todo = board.add_column("À faire", WipPolicy::None);
    let done = board.add_column("Terminé", WipPolicy::None);
    let task_id = board.add_task("Publier", &todo).unwrap();
    let first = CommandAction::shell("Préparer", "prepare");
    let second = CommandAction::shell("Publier", "publish");
    let actions = HashMap::from([
        (first.id.clone(), first.clone()),
        (second.id.clone(), second.clone()),
    ]);
    let automation = TransitionAutomation::new(
        &board.id,
        Some(todo.clone()),
        &done,
        vec![ActionStep::new(&first.id), ActionStep::new(&second.id)],
    );
    let automation_id = automation.id.clone();
    let executor = RecordingExecutor {
        executed: RefCell::new(Vec::new()),
        fail_action: Some(second.id.clone()),
    };

    let result = transition_task(
        &mut board,
        std::slice::from_ref(&automation),
        &actions,
        &executor,
        TransitionRequest {
            task_id: task_id.clone(),
            target_column_id: done.clone(),
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .expect("transition accepted");

    let task = board.tasks.iter().find(|task| task.id == task_id).unwrap();
    assert_eq!(task.column_id, done);
    assert_eq!(task.execution_status, ExecutionStatus::Failed);
    assert_eq!(result.execution.unwrap().failed_step, Some(1));
    assert_eq!(
        executor.executed.into_inner(),
        vec![first.id, second.id.clone()]
    );

    let retry_executor = RecordingExecutor {
        executed: RefCell::new(Vec::new()),
        fail_action: None,
    };
    let retry = resume_transition(
        &mut board,
        &[automation],
        &actions,
        &retry_executor,
        ResumeRequest {
            task_id: task_id.clone(),
            failed_step: 1,
            automation_ids: vec![automation_id],
            origin: TransitionOrigin::User,
        },
    )
    .expect("failed step resumes");
    assert_eq!(retry.failed_step, None);
    assert_eq!(retry_executor.executed.into_inner(), vec![second.id]);
    assert_eq!(
        board
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .unwrap()
            .execution_status,
        ExecutionStatus::Succeeded
    );
}
