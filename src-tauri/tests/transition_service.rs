use std::cell::Cell;

use chrono::Utc;
use workonit_lib::{
    automation::{
        ActionExecutor, ActionStep, CommandAction, StepExecution, StepStatus, TransitionAutomation,
    },
    domain::{Board, ExecutionStatus, TransitionOrigin},
    engine::TransitionRequest,
    service::{
        abandon_execution, apply_source_with_transitions, execute_transition, resume_execution,
    },
    sources::{apply_source_preview, preview, FieldMapping, SourceDefinition, SourceFormat},
    storage::Store,
};

struct SuccessExecutor {
    calls: Cell<u32>,
}

#[test]
fn source_moves_use_transition_automations_and_leave_blocked_moves_pending() {
    let store = Store::in_memory().unwrap();
    let mut board = Board::starter("Sources");
    let from = board.columns[0].id.clone();
    let to = board.columns[1].id.clone();
    let mapping = FieldMapping {
        title: "$.title".into(),
        description: None,
        external_key: Some("$.id".into()),
        column: Some("$.state".into()),
    };
    let mut source = SourceDefinition::new(
        &board.id,
        "Tickets",
        "ignored",
        SourceFormat::Json,
        mapping.clone(),
        &from,
    );
    source.move_existing_tasks = true;
    source.column_mapping.insert("done".into(), to.clone());
    let initial = preview(
        SourceFormat::Json,
        r#"[{"id":"1","title":"Ship","state":"open"}]"#,
        &mapping,
        None,
    );
    apply_source_preview(&mut board, &source, &initial).unwrap();
    store.save_board(&board).unwrap();
    let action = CommandAction::shell("Notify", "notify");
    store.save_action(&action).unwrap();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(from.clone()),
        &to,
        vec![ActionStep::new(&action.id)],
    );
    store.save_transition_automation(&automation).unwrap();
    let updated = preview(
        SourceFormat::Json,
        r#"[{"id":"1","title":"Ship","state":"done"}]"#,
        &mapping,
        None,
    );
    let executor = SuccessExecutor {
        calls: Cell::new(0),
    };

    let summary = apply_source_with_transitions(&store, &executor, &source, &updated).unwrap();

    assert_eq!(summary.pending_moves, 0);
    assert_eq!(executor.calls.get(), 1);
    assert_eq!(
        store.get_board(&board.id).unwrap().unwrap().tasks[0].column_id,
        to
    );
}

struct FailureExecutor;
impl ActionExecutor for FailureExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: StepStatus::Failed,
            exit_code: Some(7),
            stdout: String::new(),
            stderr: "failed".into(),
            started_at: Utc::now(),
            finished_at: Utc::now(),
            stdout_truncated: false,
            stderr_truncated: false,
            stdout_bytes: Vec::new(),
            stderr_bytes: Vec::new(),
        }
    }
}

struct StatusExecutor(StepStatus);
impl ActionExecutor for StatusExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        let mut step = FailureExecutor.execute(action, _task);
        step.status = self.0.clone();
        step
    }
}

impl ActionExecutor for SuccessExecutor {
    fn execute(&self, action: &CommandAction, _task: &workonit_lib::domain::Task) -> StepExecution {
        self.calls.set(self.calls.get() + 1);
        StepExecution {
            action_id: action.id.clone(),
            action_name: action.name.clone(),
            status: StepStatus::Succeeded,
            exit_code: Some(0),
            stdout: "ok".into(),
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

#[test]
fn failed_execution_can_resume_from_failed_step_or_be_abandoned() {
    let store = Store::in_memory().unwrap();
    let mut board = Board::starter("Service");
    let task_id = board
        .add_task("Ship", &board.columns[0].id.clone())
        .unwrap();
    store.save_board(&board).unwrap();
    let action = CommandAction::shell("Ship", "ship");
    store.save_action(&action).unwrap();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[2].id,
        vec![ActionStep::new(&action.id)],
    );
    store.save_transition_automation(&automation).unwrap();
    execute_transition(
        &store,
        &FailureExecutor,
        &board.id,
        TransitionRequest {
            task_id: task_id.clone(),
            target_column_id: board.columns[2].id.clone(),
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .unwrap();
    let record = store.list_executions().unwrap().remove(0);
    assert_eq!(record.failed_step, Some(0));

    resume_execution(
        &store,
        &SuccessExecutor {
            calls: Cell::new(0),
        },
        &board.id,
        &record.id,
        false,
    )
    .unwrap();
    assert_eq!(
        store.get_execution(&record.id).unwrap().unwrap().status,
        ExecutionStatus::Succeeded
    );

    abandon_execution(&store, &board.id, &record.id).unwrap();
    assert_eq!(
        store.get_execution(&record.id).unwrap().unwrap().status,
        ExecutionStatus::Cancelled
    );
    assert_eq!(
        store.get_board(&board.id).unwrap().unwrap().tasks[0].execution_status,
        ExecutionStatus::Cancelled
    );
}

#[test]
fn transition_service_loads_binding_and_persists_board_and_execution() {
    let store = Store::in_memory().unwrap();
    let mut board = Board::starter("Service");
    let task_id = board
        .add_task("Ship", &board.columns[0].id.clone())
        .unwrap();
    store.save_board(&board).unwrap();
    let action = CommandAction::shell("Ship", "ship");
    store.save_action(&action).unwrap();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[2].id,
        vec![ActionStep::new(&action.id)],
    );
    store.save_transition_automation(&automation).unwrap();
    let executor = SuccessExecutor {
        calls: Cell::new(0),
    };

    execute_transition(
        &store,
        &executor,
        &board.id,
        TransitionRequest {
            task_id: task_id.clone(),
            target_column_id: board.columns[2].id.clone(),
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .unwrap();

    assert_eq!(executor.calls.get(), 1);
    assert_eq!(store.list_executions().unwrap().len(), 1);
    assert_eq!(
        store
            .get_board(&board.id)
            .unwrap()
            .unwrap()
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .unwrap()
            .execution_status,
        ExecutionStatus::Succeeded
    );
}

#[test]
fn service_maps_cancelled_transitions_and_restart_all_resume_paths() {
    let store = Store::in_memory().unwrap();
    let mut board = Board::starter("Status");
    let task_id = board
        .add_task("Task", &board.columns[0].id.clone())
        .unwrap();
    store.save_board(&board).unwrap();
    let action = CommandAction::shell("Run", "run");
    store.save_action(&action).unwrap();
    let automation = TransitionAutomation::new(
        &board.id,
        Some(board.columns[0].id.clone()),
        &board.columns[1].id,
        vec![ActionStep::new(&action.id)],
    );
    store.save_transition_automation(&automation).unwrap();
    execute_transition(
        &store,
        &StatusExecutor(StepStatus::Cancelled),
        &board.id,
        TransitionRequest {
            task_id: task_id.clone(),
            target_column_id: board.columns[1].id.clone(),
            origin: TransitionOrigin::User,
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(
        store.list_executions().unwrap()[0].status,
        ExecutionStatus::Cancelled
    );

    let mut record = store.list_executions().unwrap().remove(0);
    record.status = ExecutionStatus::Failed;
    record.failed_step = Some(0);
    store.save_execution(&record).unwrap();
    store.get_board(&board.id).unwrap().unwrap();
    resume_execution(
        &store,
        &StatusExecutor(StepStatus::TimedOut),
        &board.id,
        &record.id,
        true,
    )
    .unwrap();
    assert_eq!(
        store.get_execution(&record.id).unwrap().unwrap().status,
        ExecutionStatus::Failed
    );
}

#[test]
fn service_reports_missing_board_execution_and_source_records() {
    let store = Store::in_memory().unwrap();
    assert!(execute_transition(
        &store,
        &SuccessExecutor {
            calls: Cell::new(0)
        },
        "missing",
        TransitionRequest {
            task_id: "missing".into(),
            target_column_id: "missing".into(),
            origin: TransitionOrigin::User,
            confirmed: true
        },
    )
    .is_err());
    assert!(resume_execution(
        &store,
        &SuccessExecutor {
            calls: Cell::new(0)
        },
        "missing",
        "missing",
        false
    )
    .is_err());
    assert!(abandon_execution(&store, "missing", "missing").is_err());
    let source = SourceDefinition::new(
        "missing",
        "Missing",
        "run",
        SourceFormat::Json,
        FieldMapping {
            title: "$.title".into(),
            description: None,
            external_key: None,
            column: None,
        },
        "missing",
    );
    assert!(apply_source_with_transitions(
        &store,
        &SuccessExecutor {
            calls: Cell::new(0)
        },
        &source,
        &workonit_lib::sources::SourcePreview::default(),
    )
    .is_err());
}
